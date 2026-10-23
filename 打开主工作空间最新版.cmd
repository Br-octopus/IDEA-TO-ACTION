@echo off
setlocal
set "SCRIPT=%~dp0launch-latest.ps1"
if not exist "%SCRIPT%" (
  echo Launcher script not found: %SCRIPT%
  pause
  exit /b 1
)
pwsh.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
if errorlevel 1 pause
