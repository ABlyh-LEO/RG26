@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 24, then reopen this launcher.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit((major===22&&minor>=12)||major===23||major===24?0:1)"
if errorlevel 1 (
  echo Unsupported or unavailable Node.js version:
  node --version
  echo Supported: Node.js 22.12 or newer, below 25. Node.js 24 is recommended.
  pause
  exit /b 1
)
git --version >nul 2>nul
if errorlevel 1 (
  echo Git was not found or could not run. Install Git for Windows and add Git to PATH.
  echo Reopen this launcher after installing Git.
  pause
  exit /b 1
)
if not exist node_modules\tsx\package.json (
  echo Installing locked dependencies...
  call npm ci
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
call npm run operator
if errorlevel 1 pause
