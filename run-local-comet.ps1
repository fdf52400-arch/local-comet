#Requires -Version 5.1
<#
.SYNOPSIS
    Local Comet — local launch script (Windows, PowerShell)

.DESCRIPTION
    Starts Local Comet in production mode.
    Single-instance guard: if port 5051 is already listening AND /api/health
    returns HTTP 200 the script exits immediately — no second server is started.
    Works on Windows without any extra build tools — falls back to in-memory
    storage automatically if better-sqlite3 native binary is unavailable.
    Expects Ollama on http://127.0.0.1:11436 or LM Studio on http://192.168.31.168:1234.

.NOTES
    Run this from the project root:
        powershell -ExecutionPolicy Bypass -File run-local-comet.ps1

    The server window must stay open while Local Comet is running.
    After startup, open http://localhost:5051 in your browser manually.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Host.UI.RawUI.WindowTitle = 'Local Comet'

Write-Host ""
Write-Host "  ╔══════════════════════════════════════════╗" -ForegroundColor Cyan
Write-Host "  ║         Local Comet — local mode         ║" -ForegroundColor Cyan
Write-Host "  ║  Ollama  : http://127.0.0.1:11436        ║" -ForegroundColor Cyan
Write-Host "  ║  LM Studio: http://192.168.31.168:1234   ║" -ForegroundColor Cyan
Write-Host "  ╚══════════════════════════════════════════╝" -ForegroundColor Cyan
Write-Host ""

# ── Ensure we're in the project directory ─────────────────────────────────────
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# ── Check Node.js ─────────────────────────────────────────────────────────────
try {
    $NodeVersion = (node --version 2>&1)
    Write-Host "[OK] Node.js found: $NodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] Node.js not found. Install from https://nodejs.org (LTS recommended)" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}

# ── Single-instance guard ──────────────────────────────────────────────────────
# Probe /api/health before doing anything else.
# Using a direct HTTP check is more reliable than netstat — it confirms that
# the *correct* service is already up and responding, not just that some process
# is occupying the port.
$healthUrl = 'http://127.0.0.1:5051/api/health'
$appUrl    = 'http://127.0.0.1:5051/#/'

$alreadyRunning = $false
try {
    $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
    if ($resp.StatusCode -eq 200) { $alreadyRunning = $true }
} catch {}

if ($alreadyRunning) {
    Write-Host ""
    Write-Host "[OK] Local Comet is already running on port 5051." -ForegroundColor Green
    Write-Host "     Open in your browser: $appUrl"                -ForegroundColor Cyan
    Write-Host ""
    Read-Host "Press Enter to close this window"
    exit 0
}

# ── Fallback: also check with netstat in case health endpoint takes time ───────
# (belt-and-suspenders: prevents starting a second node process when the server
#  is still booting and /api/health isn't responding yet)
$portInUse = netstat -ano 2>&1 | Select-String ":5051 "
if ($portInUse) {
    Write-Host ""
    Write-Host "[WARN] Port 5051 is in use but /api/health is not responding yet." -ForegroundColor Yellow
    Write-Host "       Another instance may be starting. Wait a moment, then open:" -ForegroundColor Yellow
    Write-Host "       $appUrl" -ForegroundColor Cyan
    Write-Host ""
    Read-Host "Press Enter to close this window"
    exit 0
}

# ── Install dependencies if missing ───────────────────────────────────────────
if (-not (Test-Path "node_modules")) {
    Write-Host "[INFO] Installing dependencies (first run only)..." -ForegroundColor Yellow
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] npm install failed." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] Dependencies installed." -ForegroundColor Green
} else {
    Write-Host "[OK] node_modules present, skipping npm install." -ForegroundColor Green
}

# ── Check better-sqlite3 native binary ────────────────────────────────────────
# If the .node file cannot be loaded (e.g. Linux-built binary on Windows),
# the app automatically falls back to in-memory storage — no crash.
# To enable persistent SQLite, run: npm rebuild better-sqlite3
$SqliteNode = "node_modules\better-sqlite3\build\Release\better_sqlite3.node"
if (Test-Path $SqliteNode) {
    # Quick test: try to load the binary
    $testResult = node -e "try { require('./node_modules/better-sqlite3'); process.exit(0); } catch(e) { process.exit(1); }" 2>&1
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[WARN] better-sqlite3 native binary cannot be loaded on this Windows install." -ForegroundColor Yellow
        Write-Host "       The app will run with IN-MEMORY storage (data resets on restart)." -ForegroundColor Yellow
        Write-Host "       To enable persistent SQLite storage, run once:" -ForegroundColor Yellow
        Write-Host "         npm rebuild better-sqlite3" -ForegroundColor White
        Write-Host ""
    } else {
        Write-Host "[OK] better-sqlite3 native binary: OK (SQLite persistence enabled)" -ForegroundColor Green
    }
} else {
    Write-Host "[WARN] better-sqlite3 native binary not found." -ForegroundColor Yellow
    Write-Host "       Running with IN-MEMORY storage (data resets on restart)." -ForegroundColor Yellow
    Write-Host "       To enable persistent SQLite storage, run once: npm rebuild better-sqlite3" -ForegroundColor Yellow
    Write-Host ""
}

# ── Check if dist/index.cjs exists ────────────────────────────────────────────
if (-not (Test-Path "dist\index.cjs")) {
    Write-Host "[WARN] dist\index.cjs not found. Running build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Build failed. Check output above." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] Build complete." -ForegroundColor Green
}

# ── Start the server ──────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[INFO] Starting Local Comet on http://localhost:5051" -ForegroundColor Cyan
Write-Host "[INFO] This window must stay open while Local Comet is running." -ForegroundColor Cyan
Write-Host "[INFO] Open http://localhost:5051 in your browser manually." -ForegroundColor Cyan
Write-Host "[INFO] Press Ctrl+C to stop." -ForegroundColor Cyan
Write-Host ""

$env:NODE_ENV = 'production'
$env:LOCAL_COMET_PORT = '5051'

node dist\index.cjs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Server exited with an error. See output above." -ForegroundColor Red
    Write-Host "        Try: npm run build — then start again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
