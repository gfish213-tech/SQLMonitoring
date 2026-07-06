@echo off
setlocal
cd /d "%~dp0"

if not exist "server\node_modules" (
  echo First-time setup: installing dependencies, this can take a few minutes...
  call npm run install:all
  if errorlevel 1 (
    echo.
    echo Dependency install failed. See errors above.
    pause
    exit /b 1
  )
)

echo Starting SQL Performance Monitor...
start "SQL Performance Monitor - keep this window open" cmd /k npm run serve

echo Waiting for the server to come up...
set /a attempts=0

:waitloop
set /a attempts+=1
powershell -NoProfile -Command "try { Invoke-WebRequest -Uri http://localhost:4000 -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 goto ready

if %attempts% geq 90 (
  echo.
  echo Still waiting after 90 seconds - check the "SQL Performance Monitor" window for build/start errors.
  goto ready
)

timeout /t 1 /nobreak >nul
goto waitloop

:ready
start "" http://localhost:4000
exit
