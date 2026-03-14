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
set BINARY_URL=https://github.com/llabcoltd/llab-qrview/releases/download/v1.0.0/qrview-server-win.exe

echo [%date% %time%] Setup/Update started > "%LOG%"

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
taskkill /f /im "qrview-server.exe" >nul 2>&1
taskkill /f /im "qrview-server-win.exe" >nul 2>&1
if %errorLevel% == 0 (
    echo  [OK] Process stopped.
) else (
    echo  [OK] No running process found.
)
timeout /t 1 /nobreak >nul

:: ── Clean up old autostart entries ───────────────────────────────────────────
echo  [2/5] Cleaning up old autostart entries...
schtasks /delete /tn "QRViewServer" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v QRViewServer /f >nul 2>&1
echo  [OK] Old entries removed (if any existed).

:: ── Reset install flag ───────────────────────────────────────────────────────
echo  [3/5] Resetting install flag...
if exist "%FLAG%" (
    del /f "%FLAG%" >nul 2>&1
    echo  [OK] Flag deleted — will re-register autostart on first run.
) else (
    echo  [OK] Fresh install detected.
)

:: ── Download latest binary ───────────────────────────────────────────────────
echo  [4/5] Downloading latest QR-VIEW Agent...
echo [%date% %time%] Downloading from %BINARY_URL% >> "%LOG%"

where curl >nul 2>&1
if %errorLevel% neq 0 (
    echo  [ERROR] curl not found. Please update Windows or install curl.
    echo [%date% %time%] ERROR curl not found >> "%LOG%"
    echo.
    pause
    exit /b 1
)

if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

curl -L --progress-bar "%BINARY_URL%" -o "%EXE_DEST%" >> "%LOG%" 2>&1
if %errorLevel% neq 0 (
    echo  [ERROR] Download failed. Check your internet connection.
    echo [%date% %time%] ERROR download failed >> "%LOG%"
    echo  See log: %LOG%
    echo.
    pause
    exit /b 1
)
echo  [OK] Downloaded to %EXE_DEST%
echo [%date% %time%] Download complete >> "%LOG%"

:: ── Start new version ────────────────────────────────────────────────────────
echo  [5/5] Starting QR-VIEW Agent...
echo [%date% %time%] Starting binary >> "%LOG%"
start "" /B "%EXE_DEST%"

:: Wait up to 10 seconds for health check
set STARTED=0
for /l %%i in (1,1,10) do (
    timeout /t 1 /nobreak >nul
    curl -sf --max-time 2 "http://localhost:%PORT%/health" >nul 2>&1
    if !errorLevel! == 0 (
        set STARTED=1
        goto :CHECK_DONE
    )
)
:CHECK_DONE

echo.
if "%STARTED%"=="1" (
    echo  ==========================================
    echo   [OK] QR-VIEW Agent is running!
    echo   http://localhost:%PORT%
    echo   Auto-starts with Windows.
    echo  ==========================================
    echo [%date% %time%] SUCCESS agent running on port %PORT% >> "%LOG%"
) else (
    echo  [WARN] Agent started but health check timed out.
    echo  Check log: %USERPROFILE%\qrview-server.log
    echo [%date% %time%] WARN health check timed out >> "%LOG%"
)

echo.
echo  Log file: %LOG%
echo.
pause
