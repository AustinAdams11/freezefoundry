@echo off
rem Opens Freeze Foundry straight from this folder, no install needed. Close any installed copy first.
if not exist "%~dp0node_modules\electron\dist\electron.exe" (
  echo Run "npm install" in this folder first.
  pause
  exit /b 1
)
start "" "%~dp0node_modules\electron\dist\electron.exe" "%~dp0."
