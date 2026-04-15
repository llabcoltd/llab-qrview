@echo off
setlocal enabledelayedexpansion

:: ── Log everything so we can debug if window closes ──────────────────────────
set LOG=%USERPROFILE%\qrview-setup.log
echo [%date% %time%] Setup started > "%LOG%"

:: ── Elevation check: are we already admin? ───────────────────────────────────
whoami /groups | find "S-1-16-12288" >nul 2>&1
if %errorLevel% neq 0 (
    echo [%date% %time%] Requesting admin elevation... >> "%LOG%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [%date% %time%] Running as administrator >> "%LOG%"

set INSTALL_DIR=%APPDATA%\QRViewAgent
set PORT=3535
set BINARY_URL=https://github.com/llabcoltd/llab-qrview/releases/latest/download/qrview-server-win.exe

echo [%date% %time%] Using URL %BINARY_URL% >> "%LOG%"

echo.
echo ==========================================
echo   QR-VIEW Agent Setup - Windows
echo ==========================================
echo.

echo [%date% %time%] Checking if already running... >> "%LOG%"

:: ── Already running? ─────────────────────────────────────────────────────────
curl -sf --max-time 3 "http://localhost:%PORT%/health" >nul 2>&1
if %errorLevel% == 0 (
    echo [OK] Already running on http://localhost:%PORT%
    echo [%date% %time%] Already running - nothing to do >> "%LOG%"
    echo.
    pause
    exit /b 0
)

:: ── Check curl available ─────────────────────────────────────────────────────
where curl >nul 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] curl not found. Please update Windows or install curl.
    echo [%date% %time%] ERROR curl not found >> "%LOG%"
    echo.
    pause
    exit /b 1
)

:: ── Download binary ──────────────────────────────────────────────────────────
echo [1/3] Downloading QR-VIEW Agent...
echo [%date% %time%] Downloading from %BINARY_URL% >> "%LOG%"

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

curl -L --progress-bar "%BINARY_URL%" -o "%INSTALL_DIR%\qrview-server.exe" >> "%LOG%" 2>&1
if %errorLevel% neq 0 (
    echo [ERROR] Download failed. Check your internet connection.
    echo [%date% %time%] ERROR download failed >> "%LOG%"
    echo See log: %LOG%
    echo.
    pause
    exit /b 1
)

echo [OK] Downloaded to %INSTALL_DIR%\qrview-server.exe
echo [%date% %time%] Download complete >> "%LOG%"

:: ── Delete install flag so autostart re-registers on first run ───────────────
if exist "%USERPROFILE%\.qrview_installed" (
    del /f "%USERPROFILE%\.qrview_installed" >nul 2>&1
    echo [%date% %time%] Install flag deleted >> "%LOG%"
)

:: ── Start agent ──────────────────────────────────────────────────────────────
echo.
echo [2/3] Starting agent...
echo [%date% %time%] Starting binary >> "%LOG%"

powershell -NoProfile -Command "Start-Process -FilePath '%INSTALL_DIR%\qrview-server.exe' -WindowStyle Hidden"

:: ── Verify ───────────────────────────────────────────────────────────────────
echo.
echo [3/3] Verifying...

set STARTED=0
for /l %%i in (1,1,10) do (
    timeout 1 /nobreak >nul
    curl -sf --max-time 2 "http://localhost:%PORT%/health" >nul 2>&1
    if !errorLevel! == 0 (
        set STARTED=1
        goto :VERIFY_DONE
    )
)

:VERIFY_DONE

echo.
if "%STARTED%"=="1" (
    echo ==========================================
    echo   [OK] QR-VIEW Agent is running!
    echo   http://localhost:%PORT%
    echo   Auto-starts with Windows.
    echo ==========================================
    echo [%date% %time%] SUCCESS agent running on port %PORT% >> "%LOG%"
) else (
    echo [WARN] Agent started but health check timed out.
    echo Check log: %LOG%
    echo [%date% %time%] WARN health check timed out >> "%LOG%"
)

echo.
echo Log file: %LOG%
echo.
pause
