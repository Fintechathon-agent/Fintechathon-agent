@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:4175/ in your browser after the server starts.
echo Keep this window open. Press Ctrl+C to stop the server.
node server.js
pause
