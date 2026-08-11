@echo off
setlocal
cd /d "%~dp0"
if not exist "node_modules\.bin\electron.cmd" (
  echo Dependencies not installed. Run: npm install
  pause
  exit /b 1
)
call "node_modules\.bin\electron.cmd" . %*
