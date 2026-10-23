$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcherRoot = Join-Path $env:LOCALAPPDATA 'ForwardStep/MainWorkspaceLauncher'
$statePath = Join-Path $launcherRoot 'launch-state.json'
$browserProfile = Join-Path $launcherRoot 'browser-profile'

function Stop-PreviousLaunch {
    if (Test-Path $statePath) {
        try {
            $stateJson = (Get-Content -Raw $statePath).TrimStart([char]0xFEFF)
            $previous = ConvertFrom-Json -InputObject $stateJson
            if ($previous.serverPid -and $previous.serverScript) {
                $previousServer = Get-CimInstance Win32_Process -Filter "ProcessId = $([int]$previous.serverPid)" -ErrorAction SilentlyContinue
                if ($previousServer.Name -eq 'node.exe' -and
                    $previousServer.CommandLine -and
                    $previousServer.CommandLine.IndexOf([string]$previous.serverScript, [StringComparison]::OrdinalIgnoreCase) -ge 0) {
                    Stop-Process -Id ([int]$previous.serverPid) -Force -ErrorAction SilentlyContinue
                }
            }
        }
        catch {
            Write-Host '旧启动记录无法读取，将继续检查专用浏览器窗口。' -ForegroundColor Yellow
        }
    }

    # 仅匹配此脚本专用的浏览器配置目录，不会关闭用户日常浏览器窗口。
    $profileMarker = "--user-data-dir=`"$browserProfile`""
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -in @('msedge.exe', 'chrome.exe') -and
            $_.CommandLine -and
            $_.CommandLine.IndexOf($profileMarker, [StringComparison]::OrdinalIgnoreCase) -ge 0
        } |
        ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}

try {
    New-Item -ItemType Directory -Force -Path $launcherRoot | Out-Null
    Stop-PreviousLaunch

    $nodePath = (Get-Command node -ErrorAction Stop).Source
    if (-not (Test-Path (Join-Path $projectRoot 'server.js'))) {
        throw "找不到项目服务入口：$projectRoot/server.js"
    }

    $browserPath = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft/Edge/Application/msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft/Edge/Application/msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google/Chrome/Application/chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google/Chrome/Application/chrome.exe')
    ) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
    if (-not $browserPath) {
        throw '找不到 Microsoft Edge 或 Google Chrome，无法安全地只重开本脚本的浏览器窗口。'
    }

    # 每次启动独立的新服务，避免浏览器连到旧版本或其他占用 4173 的项目。
    $port = 4173
    while ($port -le 4199) {
        $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $port)
        try {
            $listener.Start()
            $listener.Stop()
            break
        }
        catch {
            $listener.Stop()
            $port++
        }
    }
    if ($port -gt 4199) {
        throw '4173–4199 端口都被占用，请先关闭不需要的本地服务。'
    }

    $previousPort = $env:PORT
    $previousHost = $env:HOST
    try {
        $env:PORT = "$port"
        $env:HOST = '127.0.0.1'
        $server = Start-Process -FilePath $nodePath `
            -ArgumentList ('"{0}"' -f (Join-Path $projectRoot 'server.js')) `
            -WorkingDirectory $projectRoot `
            -WindowStyle Hidden `
            -PassThru
    }
    finally {
        $env:PORT = $previousPort
        $env:HOST = $previousHost
    }

    $url = "http://127.0.0.1:$port"
    $ready = $false
    for ($attempt = 0; $attempt -lt 40; $attempt++) {
        if ($server.HasExited) {
            throw "项目服务启动失败（退出代码 $($server.ExitCode)）。"
        }
        try {
            $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) {
                $ready = $true
                break
            }
        }
        catch {
            Start-Sleep -Milliseconds 500
        }
    }
    if (-not $ready) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
        throw '等待项目服务超时，请检查 Node.js 依赖后重试。'
    }

    $browserArgs = @(
        "--user-data-dir=`"$browserProfile`"",
        "--app=$url"
    )
    $browser = Start-Process -FilePath $browserPath -ArgumentList $browserArgs -PassThru
    [PSCustomObject]@{
        serverPid = $server.Id
        serverScript = Join-Path $projectRoot 'server.js'
        port = $port
        browserPid = $browser.Id
        browserProfile = $browserProfile
        projectRoot = $projectRoot
    } | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
    Write-Host "已从主工作空间启动最新版：$url" -ForegroundColor Green
}
catch {
    Write-Host "启动失败：$($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
