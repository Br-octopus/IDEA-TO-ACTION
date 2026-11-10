import * as React from 'react'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'

export type MigrationRemote = {
  beginArchiveImport(input: { sourceName: string; size: number }): Promise<RemoteResult<{ uploadId: string; chunkBytes: number }>>
  appendArchiveImportChunk(input: { uploadId: string; index: number; dataBase64: string }): Promise<RemoteResult<{ nextChunk: number; bytes: number }>>
  previewArchiveImport(input: { uploadId: string; size: number }): Promise<RemoteResult<any>>
  commitArchiveImport(input: { uploadId: string; selectedCategories: string[]; eventId: string }): Promise<RemoteResult<any>>
  cancelArchiveImport(input: { uploadId: string }): Promise<RemoteResult<{ cancelled: boolean }>>
  previewImport(input: { backupJson: string; sourceName?: string }): Promise<RemoteResult<any>>
  commitImport(input: { backupJson: string; selectedCategories: string[]; eventId: string }): Promise<RemoteResult<any>>
  listImportReceipts(): Promise<RemoteResult<{ receipts: any[] }>>
  deleteImportReceipt(input: { receiptId: string; eventId: string }): Promise<RemoteResult<{ deleted: boolean; revision: number }>>
}

const { createElement: h, useEffect, useRef, useState } = React

function unwrap<T>(result: RemoteResult<T>): T {
  if (result.ok) return result.value
  throw result.error
}

function base64(bytes: Uint8Array): string {
  let binary = ''
  for (let cursor = 0; cursor < bytes.length; cursor += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(cursor, Math.min(cursor + 0x8000, bytes.length)))
  }
  return btoa(binary)
}

export function MigrationPanel({ remote }: { remote: MigrationRemote }) {
  const [backupJson, setBackupJson] = useState('')
  const [archiveFile, setArchiveFile] = useState<File | null>(null)
  const [archiveUploadId, setArchiveUploadId] = useState('')
  const [sourceName, setSourceName] = useState('')
  const [preview, setPreview] = useState<any>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [receipt, setReceipt] = useState<any>(null)
  const [receipts, setReceipts] = useState<any[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const cancelledUploads = useRef(new Set<string>())

  useEffect(() => {
    let active = true
    void remote.listImportReceipts().then(result => {
      const value = unwrap(result)
      if (active) setReceipts(value.receipts)
    }).catch(error => {
      if (active) setMessage(`读取迁移收据失败：${error instanceof Error ? error.message : String(error)}`)
    })
    return () => { active = false }
  }, [remote])

  async function selectFile(event: any) {
    const file = event.target.files?.[0] as File | undefined
    setPreview(null)
    setReceipt(null)
    setSelected([])
    if (archiveUploadId) { cancelledUploads.current.add(archiveUploadId); void remote.cancelArchiveImport({ uploadId: archiveUploadId }) }
    setArchiveUploadId('')
    if (!file) return
    const isArchive = /\.zip$/i.test(file.name)
    if (file.size > (isArchive ? 2 * 1024 * 1024 * 1024 : 20 * 1024 * 1024)) {
      setBackupJson('')
      setArchiveFile(null)
      setMessage(isArchive ? 'ZIP 文件超过 2 GiB 限额。' : 'JSON 文件超过 20 MiB 限额。')
      return
    }
    if (isArchive) {
      setBackupJson('')
      setArchiveFile(file)
      setSourceName(file.name)
      setMessage(`已选择 ${file.name}，生成预览时将分块上传；尚未写入插件数据。`)
      return
    }
    try {
      const content = await file.text()
      setBackupJson(content)
      setArchiveFile(null)
      setSourceName(file.name)
      setMessage(`已读取 ${file.name}，尚未写入插件数据。`)
    } catch (error) {
      setBackupJson('')
      setMessage(`读取文件失败：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  async function makePreview() {
    setBusy(true)
    setReceipt(null)
    let uploadIdToCancel = ''
    try {
      let result: any
      if (archiveFile) {
        const started = unwrap(await remote.beginArchiveImport({ sourceName: archiveFile.name, size: archiveFile.size }))
        setArchiveUploadId(started.uploadId)
        uploadIdToCancel = started.uploadId
        const chunkBytes = Math.min(started.chunkBytes, 72 * 1024)
        let index = 0
        for (let offset = 0; offset < archiveFile.size; offset += chunkBytes) {
          if (cancelledUploads.current.has(started.uploadId)) throw new Error('上传已取消')
          const chunk = new Uint8Array(await archiveFile.slice(offset, Math.min(offset + chunkBytes, archiveFile.size)).arrayBuffer())
          unwrap(await remote.appendArchiveImportChunk({ uploadId: started.uploadId, index, dataBase64: base64(chunk) }))
          index += 1
          if (index % 32 === 0 || offset + chunkBytes >= archiveFile.size) setMessage(`正在上传 ZIP：${Math.min(offset + chunkBytes, archiveFile.size)} / ${archiveFile.size} 字节`)
        }
        result = unwrap(await remote.previewArchiveImport({ uploadId: started.uploadId, size: archiveFile.size }))
      } else {
        result = unwrap(await remote.previewImport({ backupJson, sourceName }))
      }
      const ready = Object.entries(result.categories ?? {}).filter(([, item]: [string, any]) => item.status === 'ready').map(([name]) => name)
      setPreview(result)
      setSelected(ready)
      setMessage('预览完成。尚未导入任何数据。')
    } catch (error) {
      if (uploadIdToCancel) {
        if (!cancelledUploads.current.has(uploadIdToCancel)) void remote.cancelArchiveImport({ uploadId: uploadIdToCancel })
        cancelledUploads.current.delete(uploadIdToCancel)
        setArchiveUploadId('')
      }
      setPreview(null)
      setSelected([])
      setMessage(`预览失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function commit() {
    if (!preview || selected.length === 0) return
    setBusy(true)
    try {
      const result = archiveUploadId
        ? unwrap(await remote.commitArchiveImport({ uploadId: archiveUploadId, selectedCategories: selected, eventId: globalThis.crypto.randomUUID() }))
        : unwrap(await remote.commitImport({ backupJson, selectedCategories: selected, eventId: globalThis.crypto.randomUUID() }))
      setReceipt(result.receipt ? { ...result.receipt, revision: result.revision } : null)
      const completed = result.receipt?.status === 'completed'
      if (archiveUploadId && completed) { cancelledUploads.current.delete(archiveUploadId); setArchiveUploadId(''); setArchiveFile(null); setPreview(null); setSelected([]) }
      setReceipts(unwrap(await remote.listImportReceipts()).receipts)
      setMessage(completed ? '导入已提交。' : '部分类别未提交；已保存失败收据，可检查依赖后重试。')
    } catch (error) {
      setMessage(`导入未完成：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  async function deleteReceipt(receiptId: string) {
    setBusy(true)
    try {
      const result = unwrap(await remote.deleteImportReceipt({ receiptId, eventId: globalThis.crypto.randomUUID() }))
      setReceipts(current => current.filter(item => item.receiptId !== receiptId))
      if (receipt?.receiptId === receiptId) setReceipt(null)
      setMessage(result.deleted ? '收据已删除；已导入数据保持不变。' : '该收据已不存在。')
    } catch (error) {
      setMessage(`删除收据失败：${error instanceof Error ? error.message : String(error)}`)
    } finally { setBusy(false) }
  }

  function cancel() {
    if (archiveUploadId) { cancelledUploads.current.add(archiveUploadId); void remote.cancelArchiveImport({ uploadId: archiveUploadId }) }
    setArchiveUploadId('')
    setArchiveFile(null)
    setPreview(null)
    setReceipt(null)
    setSelected([])
    setMessage('已取消预览；插件数据未更改。')
  }

  const pickedFile = archiveFile ?? (backupJson ? { size: new TextEncoder().encode(backupJson).byteLength } : null)
  return h('section', { 'aria-label': '显式迁移' },
    h('h2', { style: { fontSize: '17px', margin: '0' } }, '从工作区备份迁移'),
    h('p', null, '选择 JSON 或完整 ZIP 备份。ZIP 将按小块传输；预览和取消不会写入工作区数据，只有确认后才会导入所选类别。'),
    h('label', null, '备份文件 ', h('input', { type: 'file', accept: '.json,.zip,application/json,application/zip', disabled: busy, onChange: selectFile })),
    pickedFile ? h('div', null,
      h('span', null, `${sourceName} · ${(pickedFile.size / 1024).toFixed(1)} KiB`),
      h('button', { type: 'button', disabled: busy, onClick: makePreview }, '生成只读预览')) : null,
    busy && archiveUploadId ? h('button', { type: 'button', onClick: cancel }, '取消上传') : null,
    preview ? h('div', { 'data-testid': 'migration-preview' },
      h('p', null, `格式：${preview.source?.format ?? '未知'} v${preview.source?.formatVersion ?? '?'} · 范围：${preview.mode} · 排除敏感字段 ${preview.excludedSensitiveCount ?? 0} 项`),
      preview.attachments?.payloadIncluded ? h('p', null, `ZIP 附件：${preview.attachments.count} 项。导入附件必须同时选择附件索引及关联任务；仅选择插件中已有的关联任务时无需重复导入任务。`) : null,
      ...Object.entries(preview.categories ?? {}).map(([name, item]: [string, any]) => h('label', { key: name },
        h('input', { type: 'checkbox', checked: selected.includes(name), disabled: busy || item.status !== 'ready' || (preview.attachments?.count > 0 && name === 'researchAttachments'), onChange: (event: any) => setSelected(current => event.target.checked ? [...current, name] : current.filter(value => value !== name)) }),
        `${name} · 来源 ${item.sourceCount} · ID 冲突 ${item.conflict} · 重复 ${item.duplicate} · 无效 ${item.invalid}`)),
      preview.sourceCoverage?.length ? h('details', { 'data-testid': 'migration-source-coverage' },
        h('summary', null, `来源覆盖情况（${preview.sourceCoverage.filter((item: any) => item.sourceIncluded).length}/${preview.sourceCoverage.length} 类含有来源数据）`),
        ...preview.sourceCoverage.map((item: any) => {
          const status = item.status === 'included' ? '来源含有'
            : item.status === 'not_in_scope' ? '此范围不支持'
              : item.status === 'not_exported_by_source_backup' ? '运行时存在但备份未导出'
                : '来源未包含'
          return h('p', { key: item.category }, `${item.category} · ${status} · ${item.count} 项`)
        })) : null,
      preview.unsupportedFields?.length ? h('p', null, `未知字段（不会导入）：${preview.unsupportedFields.join(', ')}`) : null,
      preview.unsupportedStructures?.length ? h('p', { role: 'status' }, `不支持或无效的已知结构（不会导入）：${preview.unsupportedStructures.map((item: any) => `${item.category} ${item.count} 项`).join('；')}`) : null,
      ...((preview.notIncludedCategories ?? []).map((item: any) => h('p', { key: `not-included-${item.category}`, role: 'status' }, `${item.category}：来源备份未包含此数据，本次不会导入。`))),
      preview.settings ? h('div', { 'aria-label': '设置迁移状态', 'data-testid': 'migration-settings' },
        h('h3', null, '设置与凭证'),
        h('p', null, '旧应用设置：来源备份不包含，需在插件或 DSH 中重新配置。'),
        h('p', null, '插件偏好：由插件管理；来源迁移不会覆盖。'),
        h('p', null, '插件服务配置：由插件管理；独立备份时需显式选择导出。'),
        h('p', null, 'DSH 宿主配置：由 DSH 管理，不随来源备份迁移。'),
        h('p', null, `凭证：排除 ${preview.settings.credentials?.count ?? preview.excludedSensitiveCount ?? 0} 项；不会迁移。`)) : null,
      h('div', null, h('button', { type: 'button', disabled: busy || selected.length === 0, onClick: commit }, '确认导入所选类别'), h('button', { type: 'button', disabled: false, onClick: cancel }, busy ? '取消上传' : '取消')),
    ) : null,
    receipt ? h('details', { open: true, 'data-testid': 'migration-receipt' },
      h('summary', null, `导入收据 ${receipt.receiptId}`),
      h('p', null, `状态：${receipt.status} · 修订：${receipt.revision ?? '已保存'}`),
      ...(receipt.categoryResults ?? []).map((item: any) => h('p', { key: item.category }, `${item.category}：${item.count} 项，${item.status}${item.errorCode ? `（${item.errorCode}）` : ''}`)),
      ...(receipt.attachmentResults ?? []).map((item: any) => h('p', { key: item.sourceId }, `附件 ${item.sourceId}：${item.verified ? '摘要校验通过' : item.status}`)),
      receipt.idMappings?.length ? h('p', null, `来源 ID 映射：${receipt.idMappings.length} 项`) : null) : null,
    receipts.length ? h('details', null,
      h('summary', null, `历史收据（${receipts.length}）`),
      ...receipts.map(item => h('div', { key: item.receiptId },
        h('span', null, `${new Date(item.createdAt).toLocaleString()} · ${item.status} · ${item.categoryResults?.length ?? 0} 类`),
        h('button', { type: 'button', disabled: busy, onClick: () => void deleteReceipt(item.receiptId) }, '删除收据')))) : null,
    h('p', { role: 'status', 'aria-live': 'polite' }, message),
  )
}
