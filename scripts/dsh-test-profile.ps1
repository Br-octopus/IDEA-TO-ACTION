[CmdletBinding()]
param(
  [ValidateSet('Inspect','Backup','Install','Restore')]
  [string]$Action = 'Inspect',
  [string]$BackupPath
)

$ErrorActionPreference = 'Stop'
$profileRoot = [IO.Path]::GetFullPath('C:/Users/Alarm/.dsh/profiles/forward-step-test')
$workspaceRoot = [IO.Path]::GetFullPath('D:/VScode/项目/提示词工具/.dsh-workspace')
$backupRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'docs/acceptance/forward-step-dsh/local-profile-backups'))
$pluginRoot = [IO.Path]::GetFullPath((Join-Path $workspaceRoot 'dsh-plugin/forward-step-dsh'))
$cli = 'D:/deepseek/resources/runtime/cli/bin/dsh.cmd'
$relativeFiles = @('package.json','pnpm-lock.yaml','pnpm-workspace.yaml','cordis.yml','cordis.patch.yml')
$directoryNames = @('.plugin-manager')

function Assert-PathWithin([string]$Path, [string]$Root, [string]$Label) {
  $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\','/')
  $fullRoot = [IO.Path]::GetFullPath($Root).TrimEnd('\','/')
  if (-not $fullPath.StartsWith($fullRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$Label 必须位于固定目录内: $fullPath"
  }
}

function Get-Inventory([string]$Root) {
  $items = @()
  foreach ($relative in $relativeFiles) {
    $path = Join-Path $Root $relative
    if (Test-Path -LiteralPath $path -PathType Leaf) {
      $items += [pscustomobject]@{ path=$relative; kind='file'; existed=$true; sha256=(Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
    } else {
      $items += [pscustomobject]@{ path=$relative; kind='file'; existed=$false; sha256=$null }
    }
  }
  foreach ($relative in $directoryNames) {
    $path = Join-Path $Root $relative
    if (Test-Path -LiteralPath $path -PathType Container) {
      $children = @(Get-ChildItem -LiteralPath $path -File -Recurse -Force | ForEach-Object {
        [pscustomobject]@{ path=$_.FullName.Substring($path.Length).TrimStart('\','/').Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
      })
      $items += [pscustomobject]@{ path=$relative; kind='directory'; existed=$true; files=$children }
    } else {
      $items += [pscustomobject]@{ path=$relative; kind='directory'; existed=$false; files=@() }
    }
  }
  return $items
}

function Read-BackupManifest([string]$Path) {
  $backup = [IO.Path]::GetFullPath($Path)
  Assert-PathWithin $backup $backupRoot '备份路径'
  $manifestPath = Join-Path $backup 'manifest.json'
  if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw "找不到 profile 备份清单: $manifestPath" }
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if ($manifest.profile -ne 'forward-step-test' -or $manifest.profileRoot -ne $profileRoot -or $manifest.version -ne 1) { throw '备份清单不匹配' }
  foreach ($entry in $manifest.items | Where-Object { $_.kind -eq 'file' -and $_.existed }) {
    if ((Get-FileHash -LiteralPath (Join-Path $backup $entry.path) -Algorithm SHA256).Hash -ne $entry.sha256) { throw "备份文件哈希不匹配: $($entry.path)" }
  }
  return @{ path=$backup; manifest=$manifest }
}

if (-not (Test-Path -LiteralPath $profileRoot -PathType Container)) { throw "测试 profile 不存在: $profileRoot" }
if (-not (Test-Path -LiteralPath $pluginRoot -PathType Container)) { throw "副本插件目录不存在: $pluginRoot" }
if (-not (Test-Path -LiteralPath $cli -PathType Leaf)) { throw "DSH CLI 不存在: $cli" }

switch ($Action) {
  'Inspect' {
    $package = Get-Content -LiteralPath (Join-Path $profileRoot 'package.json') -Raw | ConvertFrom-Json
    [pscustomobject]@{ action='Inspect'; profile='forward-step-test'; profileRoot=$profileRoot; pluginDependency=$package.dependencies.'@local/forward-step-dsh'; pluginRoot=$pluginRoot; writes=$false } | ConvertTo-Json -Depth 4
  }
  'Backup' {
    $target = if ($BackupPath) { [IO.Path]::GetFullPath($BackupPath) } else { Join-Path $backupRoot (Get-Date -Format 'yyyyMMdd-HHmmss') }
    Assert-PathWithin $target $backupRoot '备份路径'
    if (Test-Path -LiteralPath $target) { throw "备份目录已存在，拒绝覆盖: $target" }
    $inventory = Get-Inventory $profileRoot
    New-Item -ItemType Directory -Path $target -Force | Out-Null
    foreach ($entry in $inventory) {
      if (-not $entry.existed) { continue }
      $source = Join-Path $profileRoot $entry.path
      $destination = Join-Path $target $entry.path
      if ($entry.kind -eq 'file') {
        New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
        Copy-Item -LiteralPath $source -Destination $destination
      } else {
        Copy-Item -LiteralPath $source -Destination $destination -Recurse
      }
    }
    $manifest = [pscustomobject]@{ version=1; profile='forward-step-test'; createdAt=[DateTime]::UtcNow.ToString('o'); profileRoot=$profileRoot; items=$inventory }
    $manifest | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8NoBOM
    $readBack = Get-Content -LiteralPath (Join-Path $target 'manifest.json') -Raw | ConvertFrom-Json
    if ($readBack.profile -ne 'forward-step-test' -or $readBack.items.Count -ne $inventory.Count) { throw '备份清单回读校验失败' }
    [pscustomobject]@{ action='Backup'; profile='forward-step-test'; backupPath=$target; itemCount=$inventory.Count; verified=$true } | ConvertTo-Json -Depth 4
  }
  'Install' {
    if (-not $BackupPath) { throw '-BackupPath 必须指定刚创建的备份' }
    $backup = Read-BackupManifest $BackupPath
    $profilePackagePath = Join-Path $profileRoot 'package.json'
    $profilePackage = Get-Content -LiteralPath $profilePackagePath -Raw | ConvertFrom-Json
    if ($profilePackage.dependencies.'@local/forward-step-dsh') {
      & $cli 'plugin' '--profile' 'forward-step-test' 'remove' '@local/forward-step-dsh'
      if ($LASTEXITCODE -ne 0) { throw "移除旧测试入口失败，CLI 退出码 $LASTEXITCODE" }
    }
    & $cli 'plugin' '--profile' 'forward-step-test' 'add' "@local/forward-step-dsh@file:$pluginRoot"
    if ($LASTEXITCODE -ne 0) { throw "测试插件安装失败，CLI 退出码 $LASTEXITCODE" }
    $schemaText = (& $cli '--profile' 'forward-step-test' '--dump-config-schema' | Out-String)
    if ($LASTEXITCODE -ne 0) { throw "安装后 profile schema 命令失败，CLI 退出码 $LASTEXITCODE" }
    $schema = $schemaText | ConvertFrom-Json
    if ($schema.'x-cordis'.diagnostics.Count -ne 0) { throw '安装后 profile schema 有诊断' }
    $installedPackagePath = Join-Path $profileRoot 'node_modules/@local/forward-step-dsh/package.json'
    $installedClientPath = Join-Path $profileRoot 'node_modules/@local/forward-step-dsh/client.js'
    if (-not (Test-Path -LiteralPath $installedPackagePath -PathType Leaf) -or -not (Test-Path -LiteralPath $installedClientPath -PathType Leaf)) { throw '安装后实际入口缺少副本 package/client 文件' }
    $installedPackage = Get-Content -LiteralPath $installedPackagePath -Raw | ConvertFrom-Json
    $lock = Get-Content -LiteralPath (Join-Path $profileRoot 'pnpm-lock.yaml') -Raw
    $normalizedPluginRoot = $pluginRoot.Replace('\','/')
    if ($installedPackage.name -ne '@local/forward-step-dsh' -or $installedPackage.dsh.client.platform -ne 'web' -or $installedPackage.exports.'./client' -ne './client.js' -or -not $lock.Replace('\','/').Contains($normalizedPluginRoot)) { throw '安装后的 package、client export 或 lockfile 未指向副本' }
    [pscustomobject]@{ action='Install'; profile='forward-step-test'; pluginRoot=$pluginRoot; schemaDiagnostics=$schema.'x-cordis'.diagnostics.Count; installedClient=$true; lockMatchesCopy=$true; verified=$true } | ConvertTo-Json -Depth 4
  }
  'Restore' {
    if (-not $BackupPath) { throw '-BackupPath 必须指定已验证备份' }
    $backup = Read-BackupManifest $BackupPath
    $manifest = $backup.manifest
    foreach ($entry in $manifest.items) {
      $destination = Join-Path $profileRoot $entry.path
      if ($entry.kind -eq 'file') {
        if ($entry.existed) {
          New-Item -ItemType Directory -Path (Split-Path -Parent $destination) -Force | Out-Null
          Copy-Item -LiteralPath (Join-Path $backup.path $entry.path) -Destination $destination -Force
        } elseif (Test-Path -LiteralPath $destination -PathType Leaf) {
          Remove-Item -LiteralPath $destination -Force
        }
      } elseif ($entry.kind -eq 'directory') {
        if (Test-Path -LiteralPath $destination -PathType Container) {
          $resolved = (Resolve-Path -LiteralPath $destination).Path
          if ($resolved -ne [IO.Path]::GetFullPath((Join-Path $profileRoot '.plugin-manager')).TrimEnd('\','/')) { throw '拒绝清理非插件管理器目录' }
          Remove-Item -LiteralPath $destination -Recurse -Force
        }
        if ($entry.existed) { Copy-Item -LiteralPath (Join-Path $backup.path $entry.path) -Destination $destination -Recurse }
      }
    }

    $packagePath = Join-Path $profileRoot 'package.json'
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    $dependency = $package.dependencies.'@local/forward-step-dsh'
    if (-not $dependency -or $dependency -match [regex]::Escape($pluginRoot)) { throw '还原清单未恢复原插件依赖来源' }
    if ($dependency -notmatch '^file:(.+)$') { throw '恢复器只支持备份中的本地 file: 插件依赖' }
    $sourceRoot = $Matches[1]
    $sourcePackagePath = Join-Path $sourceRoot 'package.json'
    if (-not (Test-Path -LiteralPath $sourcePackagePath -PathType Leaf)) { throw "原插件来源不存在: $sourceRoot" }
    $installed = Join-Path $profileRoot 'node_modules/@local/forward-step-dsh/package.json'
    if (Test-Path -LiteralPath $installed -PathType Leaf) {
      & $cli 'plugin' '--profile' 'forward-step-test' 'remove' '@local/forward-step-dsh'
      if ($LASTEXITCODE -ne 0) { throw "移除待还原插件失败，CLI 退出码 $LASTEXITCODE" }
    }
    & $cli 'plugin' '--profile' 'forward-step-test' 'add' "@local/forward-step-dsh@$dependency"
    if ($LASTEXITCODE -ne 0) { throw "按备份依赖重新安装插件失败，CLI 退出码 $LASTEXITCODE" }

    # CLI add 会重写清单；最后恢复备份字节，保留重装后的实际 node_modules。
    foreach ($entry in $manifest.items | Where-Object { $_.kind -eq 'file' }) {
      $destination = Join-Path $profileRoot $entry.path
      if ($entry.existed) { Copy-Item -LiteralPath (Join-Path $backup.path $entry.path) -Destination $destination -Force }
      elseif (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
    }
    $package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
    foreach ($entry in $manifest.items | Where-Object { $_.kind -eq 'file' }) {
      $destination = Join-Path $profileRoot $entry.path
      if ($entry.existed) {
        $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
        if ($actual -ne $entry.sha256) { throw "还原后文件哈希不匹配: $($entry.path)" }
      } elseif (Test-Path -LiteralPath $destination -PathType Leaf) { throw "还原后意外存在文件: $($entry.path)" }
    }
    if (-not (Test-Path -LiteralPath $installed -PathType Leaf)) { throw '重装后缺少插件入口' }
    $installedPackage = Get-Content -LiteralPath $installed -Raw | ConvertFrom-Json
    $sourceHash = (Get-FileHash -LiteralPath $sourcePackagePath -Algorithm SHA256).Hash
    $installedHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
    if ($installedPackage.name -ne '@local/forward-step-dsh' -or $installedHash -ne $sourceHash) { throw '恢复后 node_modules 未与备份依赖来源一致' }
    [pscustomobject]@{ action='Restore'; profile='forward-step-test'; pluginDependency=$package.dependencies.'@local/forward-step-dsh'; packageContentMatchesSource=$true; restoredFileHashes=$true; installedClient=(Test-Path (Join-Path (Split-Path -Parent $installed) 'client.js')); resolvedPackage=(Resolve-Path -LiteralPath (Split-Path -Parent $installed)).Path; verified=$true; note='配置文件哈希已还原；node_modules 已从原 file: 来源刷新' } | ConvertTo-Json -Depth 4
  }
}
