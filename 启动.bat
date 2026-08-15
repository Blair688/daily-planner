@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 set "PATH=%PATH%;C:\Program Files\nodejs"

if not exist node_modules (
  echo 首次运行，正在安装依赖...
  call npm install
)

start "" http://localhost:3000
node server.js
pause
