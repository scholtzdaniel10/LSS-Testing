@echo off
rem ============================================================================
rem desktop-login.bat -- rebuild + launch the LSS Maintenance System desktop app
rem in LOGIN mode (DSK-login).
rem
rem Two launchers exist at the repo root:
rem
rem   desktop.bat        AUTO-TOKEN mode. Runs `php artisan desktop:token` and
rem                      injects the result as LSS_API_TOKEN, so the app opens
rem                      already signed in as desktop@lss.local. Good for a
rem                      single-user dev box.
rem
rem   desktop-login.bat  LOGIN mode (this file). Does NOT issue or inject any
rem                      token. It sets LSS_EXTERNAL_API=1 so Electron proxies
rem                      to the API started here instead of booting its own
rem                      self-contained API (which would auto-issue a token and
rem                      skip login). The web app's auth gate therefore lands on
rem                      /login and the user signs in with email + password.
rem
rem Both launchers start a `php artisan queue:listen` worker in its own window.
rem Link / analyze jobs are queued; without a worker they stay at "queued 0%%".
rem
rem Double-click from anywhere; the script cds to its own directory first.
rem ============================================================================

setlocal
cd /d %~dp0

rem ----------------------------------------------------------------------------
rem DSK-3: per-launch local-link session token. Inherited by the API window and
rem the Electron process; the API middleware rejects local-folder-linking calls
rem that lack it.
rem ----------------------------------------------------------------------------
for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "LSS_LOCAL_LINK_TOKEN=%%i"

rem ----------------------------------------------------------------------------
rem Phase 1: install Electron deps (one-time, skipped when node_modules exist)
rem ----------------------------------------------------------------------------
if not exist apps\desktop\node_modules (
    echo [desktop-login.bat] Installing Electron dependencies ^(first run^)...
    call npm --prefix apps\desktop install
    if errorlevel 1 (
        echo [desktop-login.bat] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

rem ----------------------------------------------------------------------------
rem Phase 2: build the web app
rem ----------------------------------------------------------------------------
echo [desktop-login.bat] Building web app...
call npm --prefix apps\web run build
if errorlevel 1 (
    echo [desktop-login.bat] ERROR: Web build failed. Check output above.
    pause
    exit /b 1
)

rem ----------------------------------------------------------------------------
rem Phase 3: migrate DB. Deliberately NO desktop:token here -- login mode.
rem ----------------------------------------------------------------------------
echo [desktop-login.bat] Running database migrations...
pushd apps\api
php artisan migrate --force
if errorlevel 1 (
    popd
    echo [desktop-login.bat] ERROR: Database migration failed. Check Laravel output above.
    pause
    exit /b 1
)
popd

rem Make sure nothing inherited from the calling shell can short-circuit login.
set "LSS_API_TOKEN="

rem ----------------------------------------------------------------------------
rem Phase 4: ensure the API is running on 127.0.0.1:8000
rem ----------------------------------------------------------------------------
echo [desktop-login.bat] Checking API on 127.0.0.1:8000...
for /f %%i in ('powershell -NoProfile -Command "([bool](New-Object Net.Sockets.TcpClient).ConnectAsync('127.0.0.1',8000).Wait(200))"') do set API_UP=%%i

if /i "%API_UP%"=="True" (
    echo [desktop-login.bat] WARNING: API is already running ^(externally started^).
    echo [desktop-login.bat]   An externally-started API will not have this launch's session
    echo [desktop-login.bat]   token, so local-folder linking may be rejected until you
    echo [desktop-login.bat]   restart the API via desktop-login.bat.
    goto queue
)

echo [desktop-login.bat] API not detected -- starting Laravel in a new window...
start "LSS API" cmd /k "cd /d %~dp0apps\api && php artisan serve"

echo [desktop-login.bat] Waiting for API (up to ~15 s)...
set /a TRIES=0
:wait_loop
powershell -NoProfile -Command "Start-Sleep -Milliseconds 400" > nul
for /f %%i in ('powershell -NoProfile -Command "([bool](New-Object Net.Sockets.TcpClient).ConnectAsync('127.0.0.1',8000).Wait(200))"') do set API_UP=%%i
if /i "%API_UP%"=="True" goto api_ready
set /a TRIES+=1
if %TRIES% LEQ 20 goto wait_loop

echo [desktop-login.bat] ERROR: API did not start within 15 s. Check the Laravel window.
pause
exit /b 1

:api_ready
echo [desktop-login.bat] API is up.

rem ----------------------------------------------------------------------------
rem Phase 5: ensure a queue worker is running (required for Link/analyze progress)
rem ----------------------------------------------------------------------------
:queue
echo [desktop-login.bat] Checking for a running queue worker...
for /f %%i in ('powershell -NoProfile -Command "[bool](Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'php.exe' -and $_.CommandLine -like '*artisan*queue:*' })"') do set QUEUE_UP=%%i

if /i "%QUEUE_UP%"=="True" (
    echo [desktop-login.bat] Queue worker already running -- reusing it.
) else (
    echo [desktop-login.bat] Starting queue worker in a new window...
    start "LSS Queue" cmd /k "cd /d %~dp0apps\api && php artisan queue:listen --tries=1 --timeout=660"
)

rem ----------------------------------------------------------------------------
rem Phase 6: launch Electron in external-API mode (no token, so it lands on /login)
rem ----------------------------------------------------------------------------
set "LSS_EXTERNAL_API=1"
echo [desktop-login.bat] Launching desktop app ^(login mode^)...
call npm --prefix apps\desktop start
