@echo off
rem Start the Mars viewer (http://localhost:8080; another port: set PORT=9000 && start-viewer.bat).
rem Installs the web dependencies on first run. Full setup: setup.bat
setlocal
cd /d "%~dp0web"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Run setup.bat, or install Node.js 18 or newer from https://nodejs.org
  pause
  exit /b 1
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 18 (
  echo Node.js 18 or newer is required. Run setup.bat to upgrade it.
  pause
  exit /b 1
)

if not exist "node_modules\cesium\Build\Cesium\Cesium.js" (
  echo Installing the CesiumJS dependency...
  if exist package-lock.json (
    call npm ci --no-audit --no-fund
  ) else (
    call npm install --no-audit --no-fund
  )
  if errorlevel 1 (
    echo npm failed. Check your internet connection and run this again.
    pause
    exit /b 1
  )
)

node serve.mjs %*
pause
