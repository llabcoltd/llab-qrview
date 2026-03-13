@echo off
:: ══════════════════════════════════════════════════════════════════════════════
::  QR-VIEW Agent Setup — Windows
::  Place this file in the same folder as qrview-server-win.exe and double-click.
:: ══════════════════════════════════════════════════════════════════════════════
title QR-VIEW Agent Setup

:: ── Keep window open on any early exit ───────────────────────────────────────
setlocal

set PORT=3535
set INSTALL_DIR=%APPDATA%\QRViewAgent
set SCRIPT_DIR=%~dp0
set EXE_NAME=qrview-server-win.exe
set EXE_SRC=%SCRIPT_DIR%%EXE_NAME%
set EXE_DEST=%INSTALL_DIR%\%EXE_NAME%

echo.
echo  ==========================================
echo   QR-VIEW Agent Setup - Windows
echo  ==========================================
echo.

:: ── Check exe is next to this bat ─────────────────────────────────────────────
if not exist "%EXE_SRC%" (
  echo  [ERROR] Cannot find %EXE_NAME% in:
  echo          %SCRIPT_DIR%
  echo.
  echo  Please place setup.bat and %EXE_NAME% in the same folder.
  echo.
  pause
  exit /b 1
)

:: ── Check if already running ──────────────────────────────────────────────────
curl -sf "http://localhost:%PORT%/health" >nul 2>&1
if %errorLevel% == 0 (
  echo  [OK] QR-VIEW Agent is already running on http://localhost:%PORT%
  echo.
  echo  To check status:  curl http://localhost:%PORT%/health
  echo  Log file:         %USERPROFILE%\qrview-server.log
  echo.
  pause
  exit /b 0
)

:: ── Copy exe to install dir ───────────────────────────────────────────────────
echo  [1/2] Installing to %INSTALL_DIR% ...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"
copy /Y "%EXE_SRC%" "%EXE_DEST%" >nul
if %errorLevel% neq 0 (
  echo  [ERROR] Failed to copy exe. Check permissions.
  echo.
  pause
  exit /b 1
)
echo  [OK] Copied to %EXE_DEST%

:: ── Start the agent ───────────────────────────────────────────────────────────
echo.
echo  [2/2] Starting QR-VIEW Agent...
start "" "%EXE_DEST%"

:: Wait up to 10 seconds for agent to start
set STARTED=0
for /l %%i in (1,1,10) do (
  timeout /t 1 /nobreak >nul
  curl -sf "http://localhost:%PORT%/health" >nul 2>&1
  if not errorlevel 1 (
    set STARTED=1
    goto :CHECK_DONE
  )
)
:CHECK_DONE

echo.
if "%STARTED%"=="1" (
  echo  ==========================================
  echo   [OK] QR-VIEW Agent is running!
  echo        http://localhost:%PORT%
  echo.
  echo   Auto-start registered — starts on every login.
  echo   Log file: %USERPROFILE%\qrview-server.log
  echo  ==========================================
) else (
  echo  [WARN] Agent did not respond in time.
  echo.
  echo  Check the log for errors:
  echo    %USERPROFILE%\qrview-server.log
  echo.
  echo  Or open a new terminal and run:
  echo    curl http://localhost:%PORT%/health
)

echo.
pause
