@echo off
setlocal EnableExtensions
title CutCap Installer

set "APPDIR=%LOCALAPPDATA%\CutCap"
set "NPMBIN=%APPDATA%\npm"
set "AUTOEDITOR_URL=https://github.com/WyattBlue/auto-editor/releases/download/31.6.0/auto-editor-windows-x86_64.exe"

echo.
echo CutCap - one command silence cutter to editable CapCut timeline
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [1/4] Installing Node.js LTS...
  where winget >nul 2>nul
  if errorlevel 1 (
    echo Node.js is required and winget was not found.
    echo Install Node.js LTS, then run install.cmd again.
    pause
    exit /b 1
  )
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  if errorlevel 1 exit /b 1
  set "PATH=C:\Program Files\nodejs;%PATH%"
) else (
  echo [1/4] Node.js OK.
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found after installing Node.js. Reopen this installer.
  pause
  exit /b 1
)

echo [2/4] Installing capcut-cli 0.26.0...
call npm install -g capcut-cli@0.26.0
if errorlevel 1 exit /b 1

echo [3/4] Installing Auto-Editor 31.6.0...
if not exist "%APPDIR%" mkdir "%APPDIR%"
copy /Y "%~dp0cutcap.js" "%APPDIR%\cutcap.js" >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing '%AUTOEDITOR_URL%' -OutFile '%APPDIR%\auto-editor.exe'"
if errorlevel 1 exit /b 1

echo [4/4] Creating the cutcap command...
if not exist "%NPMBIN%" mkdir "%NPMBIN%"
>"%NPMBIN%\cutcap.cmd" echo @echo off
>>"%NPMBIN%\cutcap.cmd" echo node "%%LOCALAPPDATA%%\CutCap\cutcap.js" %%*

"%APPDIR%\auto-editor.exe" --version >nul 2>nul
if errorlevel 1 (
  echo Auto-Editor verification failed.
  pause
  exit /b 1
)

echo.
echo Done.
echo.
echo Close CapCut, then use:
echo   cutcap "D:\video.mp4"
echo.
pause

