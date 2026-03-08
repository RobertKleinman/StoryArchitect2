# ============================================================
#  Story Architect — Remote Access Launcher (PowerShell)
#  Builds frontend, starts Express server, opens tunnel.
#  Access your app from anywhere via the printed URL.
# ============================================================

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   Story Architect — Remote Access" -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""

# ── Check for cloudflared ──────────────────────────────────
$cf = Get-Command cloudflared -ErrorAction SilentlyContinue
if (-not $cf) {
    Write-Host "  [!] cloudflared is not installed." -ForegroundColor Red
    Write-Host ""
    Write-Host "  Install with:" -ForegroundColor Yellow
    Write-Host "      winget install cloudflare.cloudflared"
    Write-Host ""
    Write-Host "  Or download from:"
    Write-Host "      https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/"
    Write-Host ""
    Read-Host "  Press Enter to exit"
    exit 1
}
Write-Host "  [OK] cloudflared found" -ForegroundColor Green

# ── Check for .env ─────────────────────────────────────────
if (-not (Test-Path ".env")) {
    Write-Host "  [!] No .env file found. Copy .env.example and fill in your API keys." -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}
Write-Host "  [OK] .env found" -ForegroundColor Green

# ── Check for node_modules ─────────────────────────────────
if (-not (Test-Path "node_modules")) {
    Write-Host "  [*] Installing dependencies..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [!] npm install failed." -ForegroundColor Red
        exit 1
    }
}
Write-Host "  [OK] node_modules present" -ForegroundColor Green

# ── Build frontend ─────────────────────────────────────────
Write-Host ""
Write-Host "  [*] Building frontend..." -ForegroundColor Yellow
npx vite build
if ($LASTEXITCODE -ne 0) {
    Write-Host "  [!] Frontend build failed." -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}
Write-Host "  [OK] Frontend built to frontend/dist" -ForegroundColor Green

# ── Start Express server in background ─────────────────────
Write-Host ""
Write-Host "  [*] Starting server on port 3001..." -ForegroundColor Yellow
$serverProc = Start-Process -FilePath "cmd" -ArgumentList "/c npx tsx backend/index.ts" -PassThru -WindowStyle Normal
Write-Host "  [OK] Server launched (PID: $($serverProc.Id))" -ForegroundColor Green

# ── Wait for Express to be ready ───────────────────────────
Write-Host "  [*] Waiting for server (http://localhost:3001)..." -ForegroundColor Yellow
$maxWait = 30
$elapsed = 0
$ready = $false

while ($elapsed -lt $maxWait) {
    Start-Sleep -Seconds 2
    $elapsed += 2
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:3001/api/models" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
        if ($response.StatusCode -eq 200) {
            $ready = $true
            break
        }
    } catch {
        Write-Host "  ... waiting ($elapsed s)" -ForegroundColor DarkGray
    }
}

if (-not $ready) {
    Write-Host "  [!] Server didn't start within ${maxWait}s. Check the server window." -ForegroundColor Red
    Read-Host "  Press Enter to exit"
    exit 1
}

Write-Host "  [OK] Server is ready!" -ForegroundColor Green
Write-Host ""

# ── Start Cloudflare Tunnel ────────────────────────────────
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host "   Starting Cloudflare Tunnel..." -ForegroundColor Cyan
Write-Host "   Your public URL will appear below." -ForegroundColor Cyan
Write-Host "   Share it to access Story Architect from anywhere." -ForegroundColor Cyan
Write-Host "  ============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Press Ctrl+C to shut down the tunnel." -ForegroundColor Yellow
Write-Host "  (Close the server window separately)" -ForegroundColor Yellow
Write-Host ""

# Run cloudflared in foreground so Ctrl+C stops it
& cloudflared tunnel --url http://localhost:3001
