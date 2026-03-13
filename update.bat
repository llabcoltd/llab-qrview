@echo off
:: ══════════════════════════════════════════════════════════════════════════════
::  QR-VIEW Agent Updater — Windows
::  Place this file in the same folder as qrview-server-win.exe and double-click.
:: ══════════════════════════════════════════════════════════════════════════════
title QR-VIEW Agent Update
setlocal

set INSTALL_DIR=%APPDATA%\QRViewAgent
set SCRIPT_DIR=%~dp0
set EXE_NAME=qrview-server-win.exe
set EXE_SRC=%SCRIPT_DIR%%EXE_NAME%
set EXE_DEST=%INSTALL_DIR%\%EXE_NAME%
set FLAG=%USERPROFILE%\.qrview_installed

echo.
echo  ==========================================
echo   QR-VIEW Agent Updater
echo  ==========================================
echo.

:: ── Check new exe is present ──────────────────────────────────────────────────
if not exist "%EXE_SRC%" (
  echo  [ERROR] Cannot find %EXE_NAME% in:
  echo          %SCRIPT_DIR%
  echo  Place update.bat and the new %EXE_NAME% in the same folder.
  echo.
  pause
  exit /b 1
)

:: ── Stop running process ──────────────────────────────────────────────────────
echo  [1/5] Stopping old process...
taskkill /f /im "%EXE_NAME%" >nul 2>&1
if %errorLevel% == 0 (
  echo  [OK] Process stopped.
) else (
  echo  [OK] Process was not running.
)
timeout /t 1 /nobreak >nul

:: ── Remove old schtasks entry (v1.0.0 used this, may or may not exist) ────────
echo  [2/5] Cleaning up old autostart entries...
schtasks /delete /tn "QRViewServer" /f >nul 2>&1
reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v QRViewServer /f >nul 2>&1
echo  [OK] Old entries removed (if any existed).

:: ── Delete install flag so new version re-registers autostart ────────────────
echo  [3/5] Resetting install flag...
if exist "%FLAG%" (
  del /f "%FLAG%" >nul 2>&1
  echo  [OK] Flag deleted — new version will re-register autostart on first run.
) else (
  echo  [OK] No flag found (clean install).
)

:: ── Copy new exe ──────────────────────────────────────────────────────────────
echo  [4/5] Installing new version...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%EXE_SRC%" "%EXE_DEST%" >nul
if %errorLevel% neq 0 (
  echo  [ERROR] Failed to copy exe. Is the old process still running?
  echo          Try running this updater as Administrator.
  echo.
  pause
  exit /b 1
)
echo  [OK] Copied to %EXE_DEST%

:: ── Start new version ─────────────────────────────────────────────────────────
echo  [5/5] Starting new version...
start "" "%EXE_DEST%"

:: Wait up to 10 seconds
set STARTED=0
for /l %%i in (1,1,10) do (
  timeout /t 1 /nobreak >nul
  curl -sf "http://localhost:3535/health" >nul 2>&1
  if not errorlevel 1 (
    set STARTED=1
    goto :CHECK_DONE
  )
)
:CHECK_DONE

echo.
if "%STARTED%"=="1" (
  echo  ==========================================
  echo   [OK] Updated and running!
  echo        http://localhost:3535/health
  echo.
  echo   Log file: %USERPROFILE%\qrview-server.log
  echo  ==========================================
) else (
  echo  [WARN] Agent did not respond. Check log:
  echo         %USERPROFILE%\qrview-server.log
)

echo.
pause
