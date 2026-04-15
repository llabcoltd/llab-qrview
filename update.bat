@echo off
:: ══════════════════════════════════════════════════════════════════════════════
::  QR-VIEW Agent Installer / Updater — Windows
::  Downloads the latest version, installs, and starts it.
::  Works for both fresh installs and updates.
:: ══════════════════════════════════════════════════════════════════════════════
title QR-VIEW Agent Setup
setlocal enabledelayedexpansion

set INSTALL_DIR=%APPDATA%\QRViewAgent
set EXE_NAME=qrview-server.exe
set EXE_DEST=%INSTALL_DIR%\%EXE_NAME%
set FLAG=%USERPROFILE%\.qrview_installed
set LOG=%USERPROFILE%\qrview-setup.log
set PORT=3535
set BINARY_URL=https://github.com/llabcoltd/llab-qrview/releases/latest/download/qrview-server-win.exe

echo [%date% %time%] ================================================ > "%LOG%"
echo [%date% %time%] Setup/Update started >> "%LOG%"
echo [%date% %time%] Install dir: %INSTALL_DIR% >> "%LOG%"
echo [%date% %time%] Binary URL: %BINARY_URL% >> "%LOG%"

:: ── Elevation check ──────────────────────────────────────────────────────────
whoami /groups | find "S-1-16-12288" >nul 2>&1
if %errorLevel% neq 0 (
    echo [%date% %time%] Requesting admin elevation... >> "%LOG%"
    powershell -NoProfile -ExecutionPolicy Bypass -Command ^
        "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [%date% %time%] Running as administrator >> "%LOG%"

echo.
echo  ==========================================
echo   QR-VIEW Agent Setup / Updater
echo  ==========================================
echo.

:: ── Stop running process (if any) ────────────────────────────────────────────
echo  [1/5] Stopping old process...
echo [%date% %time%] Step 1: Stopping old processes >> "%LOG%"

tasklist /FI "IMAGENAME eq qrview-server.exe" 2>nul | find /i "qrview-server.exe" >nul 2>&1
if %errorLevel% == 0 (
    echo [%date% %time%] Found qrview-server.exe running, killing... >> "%LOG%"
    taskkill /f /im "qrview-server.exe" >> "%LOG%" 2>&1
    echo  [OK] qrview-server.exe stopped.
) else (
    echo [%date% %time%] qrview-server.exe not running >> "%LOG%"
)

tasklist /FI "IMAGENAME eq qrview-server-win.exe" 2>nul | find /i "qrview-server-win.exe" >nul 2>&1
if %errorLevel% == 0 (
    echo [%date% %time%] Found qrview-server-win.exe running, killing... >> "%LOG%"
    taskkill /f /im "qrview-server-win.exe" >> "%LOG%" 2>&1
    echo  [OK] qrview-server-win.exe stopped.
) else (
    echo [%date% %time%] qrview-server-win.exe not running >> "%LOG%"
)

:: Also kill anything on our port
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":%PORT% "') do (
    echo [%date% %time%] Killing PID %%a on port %PORT% >> "%LOG%"
    taskkill /f /pid %%a >nul 2>&1
)

timeout /t 2 /nobreak >nul
echo [%date% %time%] Step 1 done >> "%LOG%"

:: ── Clean up old autostart entries ───────────────────────────────────────────
echo  [2/5] Cleaning up old autostart entries...
echo [%date% %time%] Step 2: Cleaning autostart entries >> "%LOG%"
schtasks /delete /tn "QRViewServer" /f >nul 2>&1
if %errorLevel% == 0 (
    echo [%date% %time%] Removed scheduled task QRViewServer >> "%LOG%"
) else (
    echo [%date% %time%] No scheduled task to remove >> "%LOG%"
)
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v QRViewServer /f >nul 2>&1
if %errorLevel% == 0 (
    echo [%date% %time%] Removed registry Run key >> "%LOG%"
) else (
    echo [%date% %time%] No registry Run key to remove >> "%LOG%"
)
echo  [OK] Old entries removed (if any existed).
echo [%date% %time%] Step 2 done >> "%LOG%"

:: ── Reset install flag ───────────────────────────────────────────────────────
echo  [3/5] Resetting install flag...
echo [%date% %time%] Step 3: Resetting install flag >> "%LOG%"
if exist "%FLAG%" (
    del /f "%FLAG%" >nul 2>&1
    echo [%date% %time%] Flag deleted: %FLAG% >> "%LOG%"
    echo  [OK] Flag deleted — will re-register autostart on first run.
) else (
    echo [%date% %time%] No flag file found (fresh install) >> "%LOG%"
    echo  [OK] Fresh install detected.
)
echo [%date% %time%] Step 3 done >> "%LOG%"

:: ── Download latest binary ───────────────────────────────────────────────────
echo  [4/5] Downloading latest QR-VIEW Agent...
echo [%date% %time%] Step 4: Downloading binary >> "%LOG%"

where curl >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERROR] curl not found. Please update Windows or install curl.
    echo [%date% %time%] ERROR: curl not found >> "%LOG%"
    echo.
    pause
    exit /b 1
)

if not exist "%INSTALL_DIR%" (
    mkdir "%INSTALL_DIR%"
    echo [%date% %time%] Created install dir: %INSTALL_DIR% >> "%LOG%"
)

:: Remove old binary first to avoid caching issues
if exist "%EXE_DEST%" (
    del /f "%EXE_DEST%" >nul 2>&1
    echo [%date% %time%] Deleted old binary >> "%LOG%"
)

echo [%date% %time%] Downloading from %BINARY_URL% >> "%LOG%"
curl -L --progress-bar -o "%EXE_DEST%" "%BINARY_URL%" >> "%LOG%" 2>&1
if %errorLevel% neq 0 (
    echo  [ERROR] Download failed. Check your internet connection.
    echo [%date% %time%] ERROR: curl download failed with errorLevel %errorLevel% >> "%LOG%"
    echo  See log: %LOG%
    echo.
    pause
    exit /b 1
)

:: Verify download
if not exist "%EXE_DEST%" (
    echo  [ERROR] Binary not found after download.
    echo [%date% %time%] ERROR: %EXE_DEST% does not exist after download >> "%LOG%"
    echo.
    pause
    exit /b 1
)

for %%F in ("%EXE_DEST%") do set FILE_SIZE=%%~zF
echo [%date% %time%] Downloaded file size: %FILE_SIZE% bytes >> "%LOG%"

if %FILE_SIZE% LSS 10000 (
    echo  [ERROR] Downloaded file is too small (%FILE_SIZE% bytes) — likely a 404 page.
    echo [%date% %time%] ERROR: file too small, probably not a valid binary >> "%LOG%"
    type "%EXE_DEST%" >> "%LOG%" 2>&1
    echo  See log: %LOG%
    echo.
    pause
    exit /b 1
)

echo  [OK] Downloaded to %EXE_DEST% (%FILE_SIZE% bytes)
echo [%date% %time%] Step 4 done >> "%LOG%"

:: ── Start new version ────────────────────────────────────────────────────────
echo.
echo  [5/5] Starting QR-VIEW Agent...
echo [%date% %time%] Step 5: Starting binary >> "%LOG%"
echo [%date% %time%] Launching: %EXE_DEST% >> "%LOG%"

powershell -NoProfile -Command "Start-Process -FilePath '%EXE_DEST%' -WindowStyle Hidden"

:: Wait up to 10 seconds for health check
echo [%date% %time%] Waiting for health check on port %PORT%... >> "%LOG%"
set STARTED=0
for /l %%i in (1,1,10) do (
    timeout /t 1 /nobreak >nul
    curl -sf --max-time 2 "http://localhost:%PORT%/health" >nul 2>&1
    if !errorLevel! == 0 (
        set STARTED=1
        goto :CHECK_DONE
    )
    echo [%date% %time%] Health check attempt %%i failed >> "%LOG%"
)

:CHECK_DONE
echo [%date% %time%] Health check result: STARTED=%STARTED% >> "%LOG%"

:: Get full health response for the log
if "%STARTED%"=="1" (
    echo [%date% %time%] Health response: >> "%LOG%"
    curl -s "http://localhost:%PORT%/health" >> "%LOG%" 2>&1
    echo. >> "%LOG%"
)

echo.
if "%STARTED%"=="1" (
    echo  ==========================================
    echo   [OK] QR-VIEW Agent is running!
    echo   http://localhost:%PORT%
    echo   Auto-starts with Windows.
    echo  ==========================================
    echo [%date% %time%] SUCCESS: agent running on port %PORT% >> "%LOG%"
) else (
    echo  [WARN] Agent started but health check timed out.
    echo  Check logs:
    echo    Setup log: %LOG%
    echo    Server log: %USERPROFILE%\qrview-server.log
    echo [%date% %time%] WARN: health check timed out after 10 attempts >> "%LOG%"
)

echo.
echo  Setup log: %LOG%
echo  Server log: %USERPROFILE%\qrview-server.log
echo.
pause
