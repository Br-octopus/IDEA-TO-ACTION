import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type BackupRemote = {
  exportPluginBackup(input: { includePreferences: boolean; includeServiceConfig: boolean }): Promise<RemoteResult<{ backupJson: string; sha256: string; byteLength: number }>>
  beginPluginBackupExport(input: { includePreferences: boolean; includeServiceConfig: boolean }): Promise<RemoteResult<{ exportId: string; chunkBytes: number; byteLength: number; attachmentCount: number; sha256: string }>>
  readPluginBackupExportChunk(input: { exportId: string; offset: number; length: number }): Promise<RemoteResult<{ offset: number; dataBase64: string; nextOffset: number; byteLength: number; sha256: string; done: boolean }>>
  cancelPluginBackupExport(input: { exportId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  beginPluginBackupImport(input: { sourceName: string; size: number }): Promise<RemoteResult<{ uploadId: string; chunkBytes: number }>>
  appendPluginBackupImportChunk(input: { uploadId: string; index: number; dataBase64: string }): Promise<RemoteResult<{ nextChunk: number; bytes: number }>>
  previewPluginBackupImport(input: { uploadId: string; mode: 'replace' | 'merge' }): Promise<RemoteResult<any>>
  restorePluginBackupArchive(input: { uploadId: string; mode: 'replace' | 'merge'; expectedSha256: string; expectedRevision: number; confirmed: boolean; eventId: string }): Promise<RemoteResult<any>>
  cancelPluginBackupImport(input: { uploadId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  finishPluginBackupImport(input: { uploadId: string }): Promise<RemoteResult<{ finished: boolean }>>
  previewPluginRestore(input: { backupJson: string; mode: 'replace' | 'merge' }): Promise<RemoteResult<any>>
  restorePluginBackup(input: { backupJson: string; mode: 'replace' | 'merge'; expectedSha256: string; expectedRevision: number; confirmed: boolean; eventId: string }): Promise<RemoteResult<any>>
}

const { createElement: h, useRef, useState } = React
const MAX_JSON_BYTES = 20 * 1024 * 1024
const MAX_ARCHIVE_BYTES = 2 * 1024 * 1024 * 1024
const MAX_BUFFERED_ARCHIVE_BYTES = 256 * 1024 * 1024

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let cursor = 0; cursor < bytes.length; cursor += 0x8000) binary += String.fromCharCode(...bytes.subarray(cursor, Math.min(cursor + 0x8000, bytes.length)))
  return btoa(binary)
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function download(name: string, chunks: BlobPart[], type: string) {
  const blob = new Blob(chunks, { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function BackupPanel({ remote }: { remote: BackupRemote }) {
  const [includePreferences, setIncludePreferences] = useState(false)
  const [includeServiceConfig, setIncludeServiceConfig] = useState(false)
  const [mode, setMode] = useState<'replace' | 'merge'>('replace')
  const [backupJson, setBackupJson] = useState('')
  const [archiveFile, setArchiveFile] = useState<File | null>(null)
  const [archiveUploadId, setArchiveUploadId] = useState('')
  const [archiveUploaded, setArchiveUploaded] = useState(false)
  const [sourceName, setSourceName] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [cancellable, setCancellable] = useState(false)
  const [message, setMessage] = useState('')
  const [receipt, setReceipt] = useState<any>(null)
  const cancelled = useRef(new Set<string>())
  const activeExport = useRef('')

  async function exportJson() {
    setBusy(true)
    try {
      const result = unwrap(await remote.exportPluginBackup({ includePreferences, includeServiceConfig }))
      download(`forward-step-dsh-${new Date().toISOString().slice(0, 10)}.json`, [result.backupJson], 'application/json;charset=utf-8')
      setMessage(`JSON 备份已生成（不含附件）· ${result.byteLength} 字节 · SHA-256 ${result.sha256.slice(0, 12)}`)
    } catch (error) { setMessage(`导出失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function exportArchive() {
    setBusy(true)
    let exportId = ''
    const chunks: BlobPart[] = []
    let writable: FileSystemWritableFileStream | undefined
    try {
      const started = unwrap(await remote.beginPluginBackupExport({ includePreferences, includeServiceConfig }))
      exportId = started.exportId
      activeExport.current = exportId
      setCancellable(true)
      const picker = (globalThis as any).showSaveFilePicker as undefined | ((options: any) => Promise<any>)
      if (picker && started.byteLength > MAX_BUFFERED_ARCHIVE_BYTES) {
        const target = await picker({ suggestedName: `forward-step-dsh-${new Date().toISOString().slice(0, 10)}.zip`, types: [{ description: '插件完整备份', accept: { 'application/zip': ['.zip'] } }] })
        writable = await target.createWritable()
      } else if (!picker && started.byteLength > MAX_BUFFERED_ARCHIVE_BYTES) {
        throw new Error('当前浏览器不支持大文件流式保存；请在支持文件保存 API 的 DSH 桌面环境中导出，或先减小附件总量至 256 MiB。')
      }
      let offset = 0
      let index = 0
      while (offset < started.byteLength) {
        if (cancelled.current.has(exportId)) throw new Error('导出已取消')
        const part = unwrap(await remote.readPluginBackupExportChunk({ exportId, offset, length: started.chunkBytes }))
        if (part.offset !== offset || part.byteLength !== started.byteLength || part.sha256 !== started.sha256) throw new Error('Host 返回的 ZIP 分块不连续')
        const bytes = decodeBase64(part.dataBase64)
        if (bytes.length < 1 || part.nextOffset !== offset + bytes.length || part.done !== (part.nextOffset === started.byteLength)) throw new Error('Host 返回的 ZIP 分块长度无效')
        if (writable) await writable.write(bytes)
        else chunks.push(bytes)
        offset = part.nextOffset
        index += 1
        if (index % 32 === 0 || part.done) setMessage(`正在下载完整 ZIP：${offset} / ${started.byteLength} 字节`)
      }
      if (offset !== started.byteLength) throw new Error('ZIP 下载未完整结束')
      if (writable) await writable.close()
      else download(`forward-step-dsh-${new Date().toISOString().slice(0, 10)}.zip`, chunks, 'application/zip')
      setMessage(`完整 ZIP 备份已生成 · ${started.attachmentCount} 个附件 · ${started.byteLength} 字节 · SHA-256 ${started.sha256.slice(0, 12)}`)
      exportId = ''
    } catch (error) {
      try { await writable?.abort() } catch {}
      setMessage(`ZIP 导出失败：${error instanceof Error ? error.message : String(error)}`)
    }
    finally {
      if (exportId) void remote.cancelPluginBackupExport({ exportId })
      const finishedExport = activeExport.current
      activeExport.current = ''
      if (finishedExport) cancelled.current.delete(finishedExport)
      setCancellable(false)
      setBusy(false)
    }
  }

  async function selectFile(event: any) {
    const file = event.target.files?.[0] as File | undefined
    setPreview(null)
    setReceipt(null)
    setConfirmed(false)
    setBackupJson('')
    setArchiveFile(null)
    setArchiveUploaded(false)
    if (archiveUploadId) void remote.cancelPluginBackupImport({ uploadId: archiveUploadId })
    setArchiveUploadId('')
    if (!file) return
    if (/\.zip$/i.test(file.name)) {
      if (file.size > MAX_ARCHIVE_BYTES) { setMessage('插件完整 ZIP 超过 2 GiB 限额。'); return }
      setArchiveFile(file)
      setArchiveUploaded(false)
      setSourceName(file.name)
      setMessage(`已选择完整 ZIP ${file.name}；预览时会分块上传，尚未更改插件数据。`)
      return
    }
    if (file.size > MAX_JSON_BYTES) { setMessage('插件 JSON 备份超过 20 MiB 限额。'); return }
    try {
      setBackupJson(await file.text())
      setSourceName(file.name)
      setMessage(`已读取 ${file.name}；JSON 备份不包含附件，尚未更改插件数据。`)
    } catch (error) { setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`) }
  }

  async function makePreview() {
    setBusy(true)
    setPreview(null)
    setReceipt(null)
    setConfirmed(false)
    let newUploadId = ''
    try {
      let result: any
      if (archiveFile) {
        if (archiveUploadId && archiveUploaded) {
          newUploadId = archiveUploadId
        } else {
          const started = unwrap(await remote.beginPluginBackupImport({ sourceName: archiveFile.name, size: archiveFile.size }))
          newUploadId = started.uploadId
          setArchiveUploadId(newUploadId)
          setCancellable(true)
          const chunkBytes = Math.min(started.chunkBytes, 72 * 1024)
          for (let offset = 0, index = 0; offset < archiveFile.size; offset += chunkBytes, index += 1) {
            if (cancelled.current.has(newUploadId)) throw new Error('上传已取消')
            const chunk = new Uint8Array(await archiveFile.slice(offset, Math.min(offset + chunkBytes, archiveFile.size)).arrayBuffer())
            const ack = unwrap(await remote.appendPluginBackupImportChunk({ uploadId: newUploadId, index, dataBase64: base64(chunk) }))
            if (ack.nextChunk !== index + 1 || ack.bytes !== Math.min(offset + chunk.length, archiveFile.size)) throw new Error('Host 未确认连续 ZIP 分块')
            if (index % 32 === 0 || offset + chunkBytes >= archiveFile.size) setMessage(`正在上传完整 ZIP：${Math.min(offset + chunk.length, archiveFile.size)} / ${archiveFile.size} 字节`)
          }
          setArchiveUploaded(true)
        }
        setCancellable(false)
        result = unwrap(await remote.previewPluginBackupImport({ uploadId: newUploadId, mode }))
      } else result = unwrap(await remote.previewPluginRestore({ backupJson, mode }))
      setPreview(result)
      setCancellable(false)
      setMessage(`恢复预览完成${result.attachmentCount !== undefined ? ` · ${result.attachmentCount} 个附件` : ''}；确认前不会写入数据。`)
    } catch (error) {
      if (newUploadId && !cancelled.current.has(newUploadId)) void remote.cancelPluginBackupImport({ uploadId: newUploadId })
      if (newUploadId) setArchiveUploadId('')
      if (newUploadId) setArchiveUploaded(false)
      setPreview(null)
      setMessage(`预览失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { if (newUploadId) cancelled.current.delete(newUploadId); setCancellable(false); setBusy(false) }
  }

  async function restore() {
    if (!preview || !confirmed || preview.conflicts?.length) return
    setBusy(true)
    try {
      if (archiveUploadId) {
        const result = unwrap(await remote.restorePluginBackupArchive({ uploadId: archiveUploadId, mode, expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: true, eventId: globalThis.crypto.randomUUID() }))
        setReceipt(result.receipt ?? null)
        if (!result.restored) {
          setPreview(null)
          setConfirmed(false)
          setMessage(`恢复未完成（${result.errorCode ?? 'restore_failed'}）；收据已保留，可重新预览后重试。`)
          return
        }
        setArchiveUploadId('')
        setArchiveFile(null)
        setArchiveUploaded(false)
        await remote.finishPluginBackupImport({ uploadId: archiveUploadId })
        setPreview(null)
        setConfirmed(false)
        setMessage(`插件数据及 ${result.receipt?.attachmentResults?.length ?? 0} 个附件已恢复 · 修订 ${result.revision} · 收据 ${result.receipt?.receiptId ?? ''}`)
        return
      }
      const result = unwrap(await remote.restorePluginBackup({ backupJson, mode, expectedSha256: preview.sha256, expectedRevision: preview.currentRevision, confirmed: true, eventId: globalThis.crypto.randomUUID() }))
      setPreview(null)
      setConfirmed(false)
      setMessage(`插件 JSON 数据已${mode === 'replace' ? '替换恢复' : '合并恢复'} · 修订 ${result.revision}`)
    } catch (error) { setMessage(`恢复失败：${error instanceof Error ? error.message : String(error)}`) }
    finally { setBusy(false) }
  }

  async function cancel() {
    const uploadId = archiveUploadId
    const exportId = activeExport.current
    if (uploadId) { cancelled.current.add(uploadId); await remote.cancelPluginBackupImport({ uploadId }); setArchiveUploadId(''); setArchiveUploaded(false) }
    if (exportId) { cancelled.current.add(exportId); await remote.cancelPluginBackupExport({ exportId }); activeExport.current = '' }
    setCancellable(false)
    setPreview(null)
    setConfirmed(false)
    setMessage('已取消当前操作；未确认的恢复不会更改插件数据。')
  }

  const canPreview = Boolean(archiveFile || backupJson)
  return h('section', { 'aria-label': '插件备份与恢复' },
    h('h2', { style: { fontSize: '17px', margin: '0' } }, '插件备份与恢复'),
    h('p', null, 'JSON 仅包含插件状态和设置，不含附件。完整 ZIP 包含附件字节与摘要，并与原应用工作区 JSON/ZIP 完全分离；大于 256 MiB 时需要浏览器支持流式保存。'),
    h('label', null, h('input', { type: 'checkbox', checked: includePreferences, disabled: busy, onChange: (event: any) => setIncludePreferences(event.target.checked) }), ' 包含非敏感插件偏好'),
    h('label', null, h('input', { type: 'checkbox', checked: includeServiceConfig, disabled: busy, onChange: (event: any) => setIncludeServiceConfig(event.target.checked) }), ' 包含过滤凭证后的服务配置'),
    h('button', { type: 'button', disabled: busy, onClick: exportJson }, '导出 JSON（不含附件）'),
    h('button', { type: 'button', disabled: busy, onClick: exportArchive }, '导出完整 ZIP（含附件）'),
    h('hr'),
    h('label', null, '恢复文件 ', h('input', { type: 'file', accept: '.json,.zip,application/json,application/zip', disabled: busy, onChange: selectFile })),
    sourceName ? h('p', null, sourceName) : null,
    h('label', null, '恢复方式 ', h('select', { value: mode, disabled: busy, onChange: (event: any) => { setMode(event.target.value); setPreview(null); setConfirmed(false) } },
      h('option', { value: 'replace' }, '替换当前插件数据'), h('option', { value: 'merge' }, '合并到当前插件数据'))),
    canPreview ? h('button', { type: 'button', disabled: busy, onClick: makePreview }, '生成只读恢复预览') : null,
    busy && cancellable ? h('button', { type: 'button', onClick: cancel }, '取消') : null,
    preview ? h('div', { 'data-testid': 'plugin-backup-preview' },
      h('p', null, `格式 ${preview.format} v${preview.formatVersion} · ${mode === 'replace' ? '替换' : '合并'} · ${(preview.byteLength / 1024).toFixed(1)} KiB · 附件 ${preview.attachmentCount ?? '不含'}`),
      h('ul', null, ...Object.entries(preview.counts).map(([key, count]: [string, any]) => h('li', { key }, `${key}：${count}`))),
      preview.preferencesIncluded ? h('p', null, '备份包含经过敏感字段过滤的插件偏好。') : null,
      preview.serviceConfigIncluded ? h('p', null, '备份包含经过敏感字段过滤的服务配置。') : null,
      preview.conflicts?.length ? h('p', { role: 'alert' }, `存在 ${preview.conflicts.length} 项 ID 冲突，无法合并恢复。`) : null,
      h('label', null, h('input', { type: 'checkbox', checked: confirmed, disabled: busy || preview.conflicts?.length > 0, onChange: (event: any) => setConfirmed(event.target.checked) }), ` 我已检查 ${sourceName} 的恢复内容并确认继续`),
      h('button', { type: 'button', disabled: busy || !confirmed || preview.conflicts?.length > 0, onClick: restore }, '确认恢复'),
      h('button', { type: 'button', disabled: busy, onClick: cancel }, '取消预览')) : null,
    receipt ? h('details', { open: true, 'data-testid': 'plugin-backup-receipt' },
      h('summary', null, `恢复收据 ${receipt.receiptId} · ${receipt.status}`),
      ...(receipt.attachmentResults ?? []).map((item: any) => h('p', { key: item.sourceId }, `附件 ${item.sourceId}：${item.verified ? '校验通过' : `${item.status} ${item.errorCode ?? ''}`}`))) : null,
    h('p', { role: 'status', 'aria-live': 'polite' }, message))
}
