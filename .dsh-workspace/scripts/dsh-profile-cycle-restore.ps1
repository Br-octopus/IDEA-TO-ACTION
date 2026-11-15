$ErrorActionPreference = 'Stop'
$homeRoot = 'D:/VScode/项目/提示词工具/.dsh-workspace/.verification/profile-cycle-20261102'
$profileName = 'forward-step-profile-cycle-20261102'
$profileRoot = Join-Path $homeRoot 'profiles/forward-step-profile-cycle-20261102'
$backupRoot = 'D:/VScode/项目/提示词工具/.dsh-workspace/docs/acceptance/forward-step-dsh/local-profile-backups/profile-cycle-20261102'
$cli = 'D:/deepseek/resources/runtime/cli/bin/dsh.cmd'
$sourceRoot = 'D:/VScode/项目/提示词工具/dsh-plugin/forward-step-dsh'
if ((Resolve-Path $profileRoot).Path -ne [IO.Path]::GetFullPath($profileRoot)) { throw '临时 profile 路径不一致' }
if ((Resolve-Path $backupRoot).Path -notlike 'D:\VScode\项目\提示词工具\.dsh-workspace\docs\acceptance\forward-step-dsh\local-profile-backups\profile-cycle-20261102') { throw '备份路径不匹配' }
$manifest = Get-Content (Join-Path $backupRoot 'manifest.json') -Raw | ConvertFrom-Json
if ($manifest.profile -ne $profileName) { throw 'profile manifest 不匹配' }
$env:DSH_HOME = $homeRoot
& $cli plugin --profile $profileName remove '@local/forward-step-dsh'
if ($LASTEXITCODE -ne 0) { throw "remove failed: $LASTEXITCODE" }
& $cli plugin --profile $profileName add '@local/forward-step-dsh@file:D:/VScode/项目/提示词工具/dsh-plugin/forward-step-dsh'
if ($LASTEXITCODE -ne 0) { throw "restore add failed: $LASTEXITCODE" }
foreach ($entry in $manifest.items | Where-Object { $_.kind -eq 'file' }) {
  $destination = Join-Path $profileRoot $entry.path
  if ($entry.existed) { Copy-Item -LiteralPath (Join-Path $backupRoot $entry.path) -Destination $destination -Force }
  elseif (Test-Path -LiteralPath $destination -PathType Leaf) { Remove-Item -LiteralPath $destination -Force }
}
$checks = @()
foreach ($entry in $manifest.items | Where-Object { $_.kind -eq 'file' }) {
  $destination = Join-Path $profileRoot $entry.path
  if ($entry.existed) {
    $actual = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash
    $checks += [pscustomobject]@{ path=$entry.path; expected=$entry.sha256; actual=$actual; match=($actual -eq $entry.sha256) }
  }
}
$installed = Join-Path $profileRoot 'node_modules/@local/forward-step-dsh/package.json'
$sourcePackage = Join-Path $sourceRoot 'package.json'
$installedHash = (Get-FileHash -LiteralPath $installed -Algorithm SHA256).Hash
$sourceHash = (Get-FileHash -LiteralPath $sourcePackage -Algorithm SHA256).Hash
if (@($checks | Where-Object { -not $_.match }).Count -gt 0) { throw '备份文件哈希校验失败' }
if ($installedHash -ne $sourceHash) { throw '安装后包与原来源哈希不一致' }
$result = [pscustomobject]@{ restoredDependency=(Get-Content (Join-Path $profileRoot 'package.json') -Raw | ConvertFrom-Json).dependencies.'@local/forward-step-dsh'; fileHashChecks=$checks; installedPackageHash=$installedHash; originalPackageHash=$sourceHash; packageMatchesSource=($installedHash -eq $sourceHash); restoredClientPresent=(Test-Path (Join-Path (Split-Path $installed) 'client.js')); verified=$true }
$result | ConvertTo-Json -Depth 8 | Set-Content 'D:/VScode/项目/提示词工具/.dsh-workspace/docs/acceptance/forward-step-dsh/profile-cycle-restore.json' -Encoding utf8NoBOM
$result | ConvertTo-Json -Depth 8
