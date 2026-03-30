#Requires -Version 5.1
<#
.SYNOPSIS
    Local Comet — local launch script (Windows, PowerShell)

.DESCRIPTION
    Starts Local Comet in production mode.
    Expects Ollama on http://localhost:11436 and LM Studio on http://localhost:1234.

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
Write-Host "  ║  Ollama  : http://localhost:11436         ║" -ForegroundColor Cyan
Write-Host "  ║  LM Studio: http://localhost:1234         ║" -ForegroundColor Cyan
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

# ── Create DB schema if database is missing ───────────────────────────────────
if (-not (Test-Path "data.db")) {
    Write-Host "[INFO] No database found. Running db:push to create schema..." -ForegroundColor Yellow
    npx drizzle-kit push 2>&1 | Out-Null
    Write-Host "[OK] Database schema created." -ForegroundColor Green
}

# ── Check if dist/index.cjs exists ────────────────────────────────────────────
if (-not (Test-Path "dist/index.cjs")) {
    Write-Host "[WARN] dist/index.cjs not found. Running build..." -ForegroundColor Yellow
    npm run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[ERROR] Build failed. Check output above." -ForegroundColor Red
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host "[OK] Build complete." -ForegroundColor Green
}

# ── Check if port 5051 is already in use ──────────────────────────────────────
$portInUse = netstat -ano 2>&1 | Select-String ":5051 "
if ($portInUse) {
    Write-Host "[WARN] Port 5051 is already in use. Another instance may be running." -ForegroundColor Yellow
    Write-Host "       Open http://localhost:5051 in your browser to check." -ForegroundColor Yellow
    Read-Host "Press Enter to exit"
    exit 0
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

node dist/index.cjs

if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[ERROR] Server exited with an error. See output above." -ForegroundColor Red
    Write-Host "        Try: npm run build — then start again." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
