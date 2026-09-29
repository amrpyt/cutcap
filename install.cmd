@echo off
setlocal EnableExtensions EnableDelayedExpansion
title CutCap Installer

set "APPDIR=%LOCALAPPDATA%\CutCap"
set "NPMBIN=%APPDATA%\npm"
set "AUTOEDITOR_URL=https://github.com/WyattBlue/auto-editor/releases/download/31.6.0/auto-editor-windows-x86_64.exe"
set "YTDLP_URL=https://github.com/yt-dlp/yt-dlp/releases/download/2026.08.19/yt-dlp.exe"

echo.
echo CutCap - video automation CLI for CapCut and YouTube
echo.

where winget >nul 2>nul
if errorlevel 1 (
  echo WinGet is required.
  echo Install "App Installer" from Microsoft Store, then run install.cmd again.
  pause
  exit /b 1
)

set "NEED_NODE=0"
where node >nul 2>nul
if errorlevel 1 (
  set "NEED_NODE=1"
) else (
  for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set "NODE_MAJOR=%%V"
  if not defined NODE_MAJOR set "NEED_NODE=1"
  if defined NODE_MAJOR if !NODE_MAJOR! LSS 22 set "NEED_NODE=1"
)

if "%NEED_NODE%"=="1" (
  echo [1/6] Installing or updating Node.js LTS...
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements --force
  if errorlevel 1 exit /b 1
  set "PATH=C:\Program Files\nodejs;%PATH%"
) else (
  echo [1/6] Node.js 22+ OK.
)

where npm >nul 2>nul
if errorlevel 1 (
  echo npm was not found after installing Node.js. Reopen this installer.
  pause
  exit /b 1
)

if not exist "%APPDIR%" mkdir "%APPDIR%"

echo [2/6] Installing capcut-cli 0.26.0...
call npm install -g capcut-cli@0.26.0 --no-fund --no-audit
if errorlevel 1 exit /b 1

echo [3/6] Installing bundled FFmpeg 6.1.1...
call npm install --prefix "%APPDIR%" ffmpeg-static@5.3.0 --no-fund --no-audit
if errorlevel 1 exit /b 1

echo [4/6] Installing Auto-Editor 31.6.0...
copy /Y "%~dp0cutcap.js" "%APPDIR%\cutcap.js" >nul
copy /Y "%~dp0youtube.js" "%APPDIR%\youtube.js" >nul
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing '%AUTOEDITOR_URL%' -OutFile '%APPDIR%\auto-editor.exe'"
if errorlevel 1 exit /b 1

echo [5/6] Installing yt-dlp 2026.08.19...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; Invoke-WebRequest -UseBasicParsing '%YTDLP_URL%' -OutFile '%APPDIR%\yt-dlp.exe'"
if errorlevel 1 exit /b 1

echo [6/6] Creating the global cutcap command...
if not exist "%NPMBIN%" mkdir "%NPMBIN%"
>"%NPMBIN%\cutcap.cmd" echo @echo off
>>"%NPMBIN%\cutcap.cmd" echo node "%%LOCALAPPDATA%%\CutCap\cutcap.js" %%*

"%APPDIR%\auto-editor.exe" --version >nul 2>nul
if errorlevel 1 (
  echo Auto-Editor verification failed.
  pause
  exit /b 1
)

"%APPDIR%\yt-dlp.exe" --version >nul 2>nul
if errorlevel 1 (
  echo yt-dlp verification failed.
  pause
  exit /b 1
)

if not exist "%APPDIR%\node_modules\ffmpeg-static\ffmpeg.exe" (
  echo FFmpeg verification failed.
  pause
  exit /b 1
)

echo.
echo Done.
echo.
echo Run:
echo   cutcap
echo.
echo Or keep using the original command:
echo   cutcap "D:\video.mp4"
echo.
pause
