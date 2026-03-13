@echo off
:: ══════════════════════════════════════════════════════════════════════════════
::  QR-VIEW Agent Setup — Windows
::  Double-click this file to install. That's it.
::  After install the server auto-starts with Windows — never run again.
:: ══════════════════════════════════════════════════════════════════════════════
title QR-VIEW Agent Setup

:: ── Self-elevate to Administrator ────────────────────────────────────────────
:: Checks if already admin; if not, re-launches itself elevated via PowerShell
net session >nul 2>&1
if %errorLevel% == 0 goto :ADMIN
echo Requesting administrator permission...
powershell -Command "Start-Process cmd -ArgumentList '/c \"%~f0\"' -Verb RunAs"
exit /b

:ADMIN
:: ── Now running as Administrator ─────────────────────────────────────────────
echo.
echo  ==========================================
echo   QR-VIEW Agent Setup - Windows
echo  ==========================================
echo.

set INSTALL_DIR=%APPDATA%\QRViewAgent
set SCRIPT_DIR=%~dp0
set PORT=3535

:: ── Check if already running ──────────────────────────────────────────────────
curl -sf "http://localhost:%PORT%/health" >nul 2>&1
if %errorLevel% == 0 (
  echo  [OK] QR-VIEW Agent is already running on http://localhost:%PORT%
  echo.
  pause
  exit /b 0
)

:: ── Check Node.js ─────────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorLevel% neq 0 (
  echo  [ERROR] Node.js not found.
  echo.
  echo  Please install Node.js from https://nodejs.org
  echo  Then double-click this file again.
  echo.
  pause
  exit /b 1
)

for /f "tokens=*" %%v in ('node -e "process.stdout.write(process.version)"') do set NODE_VER=%%v
echo  [OK] Node.js %NODE_VER% found.

:: ── Install npm dependencies ──────────────────────────────────────────────────
echo.
echo  [1/4] Installing dependencies...
cd /d "%SCRIPT_DIR%"
call npm install --silent
if %errorLevel% neq 0 ( echo  [ERROR] npm install failed. & pause & exit /b 1 )
echo  [OK] Dependencies ready.

:: ── Compile binary with pkg ───────────────────────────────────────────────────
echo.
echo  [2/4] Compiling binary (1-2 minutes on first run)...
if not exist "%INSTALL_DIR%" mkdir "%INSTALL_DIR%"

call npx pkg . --target node18-win-x64 --output "%INSTALL_DIR%\qrview-server.exe"
if %errorLevel% neq 0 ( echo  [ERROR] Compilation failed. & pause & exit /b 1 )
echo  [OK] Binary compiled to %INSTALL_DIR%\qrview-server.exe

:: ── Copy serialport native bindings ──────────────────────────────────────────
echo.
echo  [3/4] Copying serialport native bindings...
set PREBUILDS=%SCRIPT_DIR%node_modules\@serialport\bindings-cpp\prebuilds
if exist "%PREBUILDS%" (
  xcopy /E /I /Y "%PREBUILDS%" "%INSTALL_DIR%\prebuilds\" >nul
  echo  [OK] Native bindings copied.
) else (
  echo  [WARN] prebuilds not found - serial port may not work.
)

:: ── Start the agent ───────────────────────────────────────────────────────────
echo.
echo  [4/4] Starting QR-VIEW Agent...
:: Start hidden - no console window
start "" /B "%INSTALL_DIR%\qrview-server.exe"

:: Wait up to 10 seconds for agent to start
set STARTED=0
for /l %%i in (1,1,10) do (
  timeout /t 1 /nobreak >nul
  curl -sf "http://localhost:%PORT%/health" >nul 2>&1 && set STARTED=1 && goto :CHECK_DONE
)
:CHECK_DONE

echo.
if "%STARTED%"=="1" (
  echo  ==========================================
  echo   [OK] QR-VIEW Agent is running!
  echo        http://localhost:%PORT%
  echo.
  echo   Auto-start registered with Windows.
  echo   You never need to run this again.
  echo  ==========================================
) else (
  echo  [WARN] Agent started but health check timed out.
  echo         Check logs: %USERPROFILE%\qrview-server.log
  echo         Try: curl http://localhost:%PORT%/health
)

echo.
pause
