@echo off
rem desktop.bat -- one-click rebuild + launch for LSS Maintenance System desktop app
rem Double-click from anywhere; the script cds to its own directory first.

cd /d %~dp0

rem -- Phase 1: install Electron deps (one-time) ------------------------------
if not exist apps\desktop\node_modules (
    echo [desktop.bat] Installing Electron dependencies (first run)...
    npm --prefix apps\desktop install
    if errorlevel 1 (
        echo [desktop.bat] ERROR: npm install failed.
        pause
        exit /b 1
    )
)

rem -- Phase 2: build the web app ---------------------------------------------
echo [desktop.bat] Building web app...
call npm --prefix apps\web run build
if errorlevel 1 (
    echo [desktop.bat] ERROR: Web build failed. Check output above.
    pause
    exit /b 1
)

rem -- Phase 3: ensure the API is running ------------------------------------
echo [desktop.bat] Checking API on 127.0.0.1:8000...
for /f %%i in ('powershell -NoProfile -Command "(Test-NetConnection 127.0.0.1 -Port 8000 -WarningAction SilentlyContinue).TcpTestSucceeded"') do set API_UP=%%i
if /i not "%API_UP%"=="True" (
    echo [desktop.bat] API not detected -- starting Laravel in a new window...
    start "LSS API" cmd /k "cd /d %~dp0apps\api && php artisan serve"
    echo [desktop.bat] Waiting 5 s for API to boot...
    timeout /t 5 /nobreak > nul
)

rem -- Phase 4: launch Electron -----------------------------------------------
echo [desktop.bat] Launching desktop app...
call npm --prefix apps\desktop start
