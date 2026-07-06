@echo off
setlocal
cd /d "%~dp0"

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo Not a git repository - skipping update check.
) else (
  echo Checking for updates...

  git diff --quiet HEAD
  set HASLOCAL=%errorlevel%
  if not "%HASLOCAL%"=="0" (
    echo Local changes detected ^(e.g. edits to server\config\servers.json^) - stashing them before updating...
    git stash push -m "start.bat auto-stash" >nul
  )

  git pull
  if errorlevel 1 (
    echo.
    echo git pull failed - continuing with the current local version.
  )

  if not "%HASLOCAL%"=="0" (
    echo Restoring local changes...
    git stash pop
    if errorlevel 1 (
      echo.
      echo Could not automatically restore your local changes.
      echo Run "git stash list" and "git stash pop" manually to recover them.
      pause
    )
  )
)

echo Installing / updating dependencies...
call npm run install:all
if errorlevel 1 (
  echo.
  echo Dependency install failed. See errors above.
  pause
  exit /b 1
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
