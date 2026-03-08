@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  Story Architect — Remote Access Launcher
::  Builds frontend, starts Express server, opens tunnel.
::  Access your app from anywhere via the printed URL.
:: ============================================================

title Story Architect - Remote Access

:: ── Check for cloudflared ──────────────────────────────────
where cloudflared >nul 2>nul
if %errorlevel% neq 0 (
    echo.
    echo  [!] cloudflared is not installed.
    echo.
    echo  Install it with:
    echo      winget install cloudflare.cloudflared
    echo.
    echo  Or download from:
    echo      https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
    echo.
    echo  Then re-run this script.
    echo.
    pause
    exit /b 1
)

:: ── Check for node_modules ─────────────────────────────────
if not exist "node_modules\" (
    echo.
    echo  [*] Installing dependencies...
    call npm install
    if %errorlevel% neq 0 (
        echo  [!] npm install failed.
        pause
        exit /b 1
    )
)

:: ── Check .env exists ──────────────────────────────────────
if not exist ".env" (
    echo.
    echo  [!] No .env file found. Copy .env.example and add your API keys.
    pause
    exit /b 1
)

echo.
echo  ============================================================
echo   Story Architect — Remote Access
echo  ============================================================
echo.

:: ── Build frontend ───────────────────────────────────────────
echo  [*] Building frontend...
call npx vite build
if %errorlevel% neq 0 (
    echo  [!] Frontend build failed.
    pause
    exit /b 1
)
echo  [OK] Frontend built to frontend/dist
echo.

:: ── Start Express server (serves API + built frontend) ──────
echo  [*] Starting server on port 3001...
start "Story Architect - Server" cmd /k "cd /d %~dp0 && npx tsx backend/index.ts"

:: ── Wait for Express to be ready ─────────────────────────────
echo  [*] Waiting for server to start...
set /a attempts=0
:wait_loop
set /a attempts+=1
if %attempts% gtr 20 (
    echo  [!] Server didn't start in time. Check the server window.
    pause
    exit /b 1
)
timeout /t 2 /nobreak >nul
powershell -command "try { $r = Invoke-WebRequest -Uri 'http://localhost:3001/api/models' -TimeoutSec 2 -UseBasicParsing; exit 0 } catch { exit 1 }" >nul 2>nul
if %errorlevel% neq 0 goto wait_loop

echo  [OK] Server is running on http://localhost:3001
echo.

:: ── Start Cloudflare Tunnel ──────────────────────────────────
echo  [*] Starting Cloudflare Tunnel...
echo  [*] Your public URL will appear below (*.trycloudflare.com)
echo.
echo  ============================================================
cloudflared tunnel --url http://localhost:3001
