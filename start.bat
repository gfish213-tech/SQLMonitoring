@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set REPO_URL=https://github.com/gfish213-tech/SQLMonitoring.git
set BRANCH=claude/sql-performance-monitor-ui-tcteaq
set REPO_DIR=SQLMonitoring

rem Self-bootstrap: if this copy of start.bat isn't already sitting inside the project (e.g. it
rem was handed to someone as a single file), clone the repo into a subfolder next to it and
rem continue from there, so this one file is all that's needed to get started.
if not exist "server\package.json" (
  if exist "%REPO_DIR%\server\package.json" (
    cd /d "%REPO_DIR%"
  ) else (
    echo First-time setup: cloning SQL Performance Monitor into ".\%REPO_DIR%"...
    git clone --branch %BRANCH% %REPO_URL% "%REPO_DIR%"
    if errorlevel 1 (
      echo.
      echo Clone failed. Make sure Git is installed and you have access to the repository.
      pause
      exit /b 1
    )
    cd /d "%REPO_DIR%"
  )
)

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo Not a git repository - skipping update check.
) else (
  echo Checking for updates...

  rem Detect whether "git stash push" actually created a stash (rather than trusting "git diff"
  rem to predict it, which can false-positive on Windows from CRLF normalization and stash
  rem nothing, leaving a later "git stash pop" to fail with "No stash entries found").
  set STASH_BEFORE=
  for /f "delims=" %%i in ('git rev-parse -q --verify refs/stash 2^>nul') do set STASH_BEFORE=%%i

  git stash push -m "start.bat auto-stash" >nul

  set STASH_AFTER=
  for /f "delims=" %%i in ('git rev-parse -q --verify refs/stash 2^>nul') do set STASH_AFTER=%%i

  set DID_STASH=0
  if not "!STASH_BEFORE!"=="!STASH_AFTER!" (
    set DID_STASH=1
    echo Local changes detected ^(e.g. edits to server\config\servers.json^) - stashed before updating.
  )

  git fetch origin %BRANCH% >nul 2>&1

  rem Always make sure we're on %BRANCH% - this is where every update gets pushed, regardless
  rem of which branch this checkout happened to be on (e.g. master with no tracking set up).
  git rev-parse --verify %BRANCH% >nul 2>&1
  if errorlevel 1 (
    git checkout -t origin/%BRANCH%
  ) else (
    git checkout %BRANCH%
  )
  if errorlevel 1 (
    echo.
    echo Could not switch to %BRANCH% - continuing with the current local version.
  ) else (
    git pull origin %BRANCH%
    if errorlevel 1 (
      echo.
      echo git pull failed - continuing with the current local version.
    )
  )

  if "!DID_STASH!"=="1" (
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

rem Some environments (e.g. a corporate npm policy) gate install scripts behind an approval
rem step - without it, msnodesqlv8's node-gyp rebuild never runs and the native SQL Server
rem driver never gets compiled, so Connect/Test Connection fails later with "native msnodesqlv8
rem driver is not built on this host" even though install otherwise looked fine. Best-effort:
rem plain npm doesn't have this subcommand, so ignore failures here rather than aborting.
if exist "server\package.json" (
  pushd server
  call npm approve-scripts --allow-scripts-pending 2>nul
  popd
)
if exist "client\package.json" (
  pushd client
  call npm approve-scripts --allow-scripts-pending 2>nul
  popd
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
