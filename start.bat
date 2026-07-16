@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set REPO_URL=https://github.com/gfish213-tech/SQLMonitoring.git
set BRANCH=claude/sql-performance-monitor-ui-tcteaq
set REPO_DIR=SQLMonitoring

echo Checking prerequisites...

rem Fail fast with a specific, named reason instead of letting a missing tool surface later as a
rem generic "install failed" wrapped around whatever cryptic error npm/git/node-gyp produced.
where git >nul 2>&1
if errorlevel 1 (
  echo.
  echo Git is not installed, or not on PATH. Install it from https://git-scm.com/downloads and
  echo run start.bat again.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo.
  echo Node.js is not installed, or not on PATH. Install Node.js 18+ from https://nodejs.org and
  echo run start.bat again.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo.
  echo npm was not found even though Node.js appears to be installed - this usually means a broken
  echo Node.js install. Reinstall Node.js from https://nodejs.org and run start.bat again.
  pause
  exit /b 1
)

rem Best-effort, non-fatal: the ODBC driver is a runtime dependency (npm install succeeds without
rem it), so this is a heads-up rather than a hard stop - the app's own Connect/Test Connection
rem error is already clear if this check has a false negative on some Windows/installer version.
reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Driver 18 for SQL Server" >nul 2>&1
if errorlevel 1 (
  reg query "HKLM\SOFTWARE\ODBC\ODBCINST.INI\ODBC Driver 17 for SQL Server" >nul 2>&1
  if errorlevel 1 (
    echo.
    echo Warning: could not detect "ODBC Driver 17 for SQL Server" or "18 for SQL Server"
    echo installed. The app will still start, but Connect / Test Connection will fail until one
    echo is installed - search Microsoft's "ODBC Driver for SQL Server" download page if that
    echo happens.
    echo.
  )
)

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

rem Defaults to "always rebuild" (the previous, safe-but-slower behavior) - only set to 0 below
rem once we've actually confirmed nothing that could affect the build changed.
set NEED_REBUILD=1

git rev-parse --is-inside-work-tree >nul 2>&1
if errorlevel 1 (
  echo Not a git repository - skipping update check.
) else (
  echo Checking for updates...

  rem Captured so we can tell below whether git pull actually moved HEAD - a full client+server
  rem rebuild takes several seconds even when nothing changed, and on a repeat run (the common
  rem case: same machine, checking again later) that's several seconds wasted every single time.
  set BEFORE_HEAD=
  for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set BEFORE_HEAD=%%i

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

  rem Skip the rebuild only when we're confident nothing that affects it changed: HEAD didn't
  rem move (no new commits pulled), no local changes were stashed/restored (they could have
  rem touched source, not just config - can't cheaply tell which from here, so treat any stash
  rem as "must rebuild" to stay safe), and a previous build actually exists to fall back on.
  set AFTER_HEAD=
  for /f "delims=" %%i in ('git rev-parse HEAD 2^>nul') do set AFTER_HEAD=%%i

  if "!DID_STASH!"=="0" if "!BEFORE_HEAD!"=="!AFTER_HEAD!" if exist "client\dist\index.html" if exist "server\dist\index.js" (
    set NEED_REBUILD=0
  )
)

rem Some environments (e.g. a corporate npm policy) gate install scripts behind an approval
rem step - without it, msnodesqlv8's node-gyp rebuild never runs and the native SQL Server
rem driver never gets compiled, so Connect/Test Connection fails later with "native msnodesqlv8
rem driver is not built on this host" even though install otherwise looked fine.
rem "--allow-scripts-pending" turned out to just re-list pending scripts, not approve them -
rem the actual mechanism is per-package by name. Best-effort: plain npm doesn't have this
rem subcommand at all, so ignore failures here rather than aborting.
rem Only needed when something could have changed (package.json only changes via a commit, the
rem same signal NEED_REBUILD already tracks) - otherwise these are guaranteed no-op subprocess
rem calls that just add time to every run.
if "!NEED_REBUILD!"=="1" (
  if exist "server\package.json" (
    pushd server
    call npm approve-scripts msnodesqlv8 2>nul
    call npm approve-scripts esbuild 2>nul
    popd
  )
  if exist "client\package.json" (
    pushd client
    call npm approve-scripts esbuild 2>nul
    popd
  )
)

echo Installing / updating dependencies...
call npm run install:all
if errorlevel 1 (
  echo.
  echo Dependency install failed. See errors above for the exact cause - the most common one is a
  echo missing C++ build toolchain or Python, both required by node-gyp to compile the native
  echo msnodesqlv8 SQL Server driver. On Windows, install "Visual Studio Build Tools" with the
  echo "Desktop development with C++" workload, plus Python 3, then run start.bat again.
  pause
  exit /b 1
)

echo Starting SQL Performance Monitor...
if "!NEED_REBUILD!"=="0" (
  echo No code changes since the last run - skipping the rebuild and starting directly.
  start "SQL Performance Monitor - keep this window open" cmd /k npm start
) else (
  start "SQL Performance Monitor - keep this window open" cmd /k npm run serve
)

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
