@echo off
rem desktop.bat -- one-click rebuild + launch for LSS Maintenance System desktop app
rem Double-click from anywhere; the script cds to its own directory first.

setlocal
cd /d %~dp0

rem ============================================================================
rem DSK-3: generate a per-launch session token.
rem Both the API cmd window (started below) and the Electron process inherit
rem LSS_LOCAL_LINK_TOKEN automatically via the environment. The API middleware
rem rejects local-folder-linking calls that lack this token, so a rogue page
rem cannot trigger local disk reads outside this launch session.
rem ============================================================================
for /f %%i in ('powershell -NoProfile -Command "[guid]::NewGuid().ToString('N')"') do set "LSS_LOCAL_LINK_TOKEN=%%i"

rem ============================================================================
rem Phase 1: install Electron deps ^(one-time, skipped when node_modules exist^)
rem ============================================================================
if not exist apps\desktop\node_modules (
    echo [desktop.bat] Installing Electron dependencies ^(first run^)...
    call npm --prefix apps\desktop install
    if errorlevel 1 (
        echo [desktop.bat] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

rem ============================================================================
rem Phase 2: build the web app
rem ============================================================================
echo [desktop.bat] Building web app...
call npm --prefix apps\web run build
if errorlevel 1 (
    echo [desktop.bat] ERROR: Web build failed. Check output above.
    pause
    exit /b 1
)

rem ============================================================================
rem Phase 3: migrate DB and provision Sanctum token for this launch.
rem SQLite is file-based so this works before the API HTTP server starts.
rem The token is injected into the Electron process via LSS_API_TOKEN.
rem ============================================================================
echo [desktop.bat] Running database migrations...
pushd apps\api
php artisan migrate --force
if errorlevel 1 (
    popd
    echo [desktop.bat] ERROR: Database migration failed. Check Laravel output above.
    pause
    exit /b 1
)

echo [desktop.bat] Provisioning desktop API token...
for /f "delims=" %%i in ('php artisan desktop:token') do set "LSS_API_TOKEN=%%i"
popd

if not defined LSS_API_TOKEN (
    echo [desktop.bat] ERROR: desktop:token returned an empty token. Check Laravel output above.
    pause
    exit /b 1
)
echo [desktop.bat] Desktop token issued.

rem ============================================================================
rem Phase 4: ensure the API is running on 127.0.0.1:8000
rem ============================================================================
echo [desktop.bat] Checking API on 127.0.0.1:8000...
for /f %%i in ('powershell -NoProfile -Command "(Test-NetConnection 127.0.0.1 -Port 8000 -WarningAction SilentlyContinue).TcpTestSucceeded"') do set API_UP=%%i

if /i "%API_UP%"=="True" (
    echo [desktop.bat] WARNING: API is already running ^(externally started^).
    echo [desktop.bat]   An externally-started API will not have this launch's session
    echo [desktop.bat]   token, so local-folder linking may be rejected until you
    echo [desktop.bat]   restart the API via desktop.bat.
    goto launch
)

echo [desktop.bat] API not detected -- starting Laravel in a new window...
start "LSS API" cmd /k "cd /d %~dp0apps\api && php artisan serve"

echo [desktop.bat] Waiting for API to become available ^(up to 15 s^)...
set /a TRIES=0
:wait_loop
timeout /t 1 /nobreak > nul
for /f %%i in ('powershell -NoProfile -Command "(Test-NetConnection 127.0.0.1 -Port 8000 -WarningAction SilentlyContinue).TcpTestSucceeded"') do set API_UP=%%i
if /i "%API_UP%"=="True" goto api_ready
set /a TRIES+=1
if %TRIES% lss 15 goto wait_loop

echo [desktop.bat] ERROR: API did not start within 15 s. Check the Laravel window.
pause
exit /b 1

:api_ready
echo [desktop.bat] API is up.

rem ============================================================================
rem Phase 5: launch Electron
rem ============================================================================
:launch
echo [desktop.bat] Launching desktop app...
call npm --prefix apps\desktop start
