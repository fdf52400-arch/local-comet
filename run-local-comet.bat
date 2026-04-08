@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║         Local Comet — local mode         ║
echo  ║  Ollama  : http://127.0.0.1:11436        ║
echo  ║  LM Studio: http://192.168.31.168:1234   ║
echo  ╚══════════════════════════════════════════╝
echo.

:: ── Check Node.js ──────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org (LTS recommended)
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo [OK] Node.js found: %NODE_VER%

:: ── Single-instance guard ──────────────────────────────────────────────────────
:: First, try a real HTTP health check — most reliable way to confirm Local Comet
:: (not just any process) is already running on port 5051.
::
:: PowerShell is used for the HTTP probe because cmd.exe has no built-in HTTP client.
:: The probe is intentionally short-timeout (3 s) to keep the launch fast.
set "HEALTH_URL=http://127.0.0.1:5051/api/health"
set "APP_URL=http://127.0.0.1:5051/#/"

for /f "delims=" %%s in ('powershell -NoProfile -NonInteractive -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if ($r.StatusCode -eq 200) { 'HEALTHY' } else { 'DOWN' } } catch { 'DOWN' }" 2^>nul') do set "HEALTH_STATUS=%%s"

if "!HEALTH_STATUS!"=="HEALTHY" (
    echo.
    echo [OK] Local Comet is already running on port 5051.
    echo      Open in your browser: %APP_URL%
    echo.
    pause
    exit /b 0
)

:: Belt-and-suspenders: if health check timed out but port is in use the server
:: may still be booting — warn instead of spawning a second copy.
netstat -ano | findstr ":5051 " >nul 2>&1
if not errorlevel 1 (
    echo.
    echo [WARN] Port 5051 is in use but /api/health is not responding yet.
    echo        Another instance may be starting. Wait a moment, then open:
    echo        %APP_URL%
    echo.
    pause
    exit /b 0
)

:: ── Install dependencies if node_modules is missing ───────────────────────────
if not exist "node_modules\" (
    echo [INFO] Installing dependencies (first run only)...
    npm install
    if errorlevel 1 (
        echo [ERROR] npm install failed.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed.
) else (
    echo [OK] node_modules present, skipping npm install.
)

:: ── Check better-sqlite3 native binary ─────────────────────────────────────────
:: The app falls back to in-memory storage automatically if the native binary
:: cannot be loaded (e.g. Linux-built .node file on Windows).
:: Data will not be persisted. To fix: npm rebuild better-sqlite3
if exist "node_modules\better-sqlite3\build\Release\better_sqlite3.node" (
    node -e "try{require('./node_modules/better-sqlite3');process.exit(0);}catch(e){process.exit(1);}" >nul 2>&1
    if errorlevel 1 (
        echo [WARN] better-sqlite3 native binary cannot load on this Windows install.
        echo        App will use IN-MEMORY storage (data resets on restart).
        echo        To enable SQLite persistence, run: npm rebuild better-sqlite3
        echo.
    ) else (
        echo [OK] better-sqlite3: OK (SQLite persistence enabled)
    )
) else (
    echo [WARN] better-sqlite3 native binary not found.
    echo        App will use IN-MEMORY storage (data resets on restart).
    echo        To enable SQLite persistence, run: npm rebuild better-sqlite3
    echo.
)

:: ── Build if dist/index.cjs is missing ─────────────────────────────────────────
if not exist "dist\index.cjs" (
    echo [WARN] dist\index.cjs not found. Running build...
    call npm run build
    if errorlevel 1 (
        echo [ERROR] Build failed. Check output above.
        pause
        exit /b 1
    )
    echo [OK] Build complete.
)

:: ── Start the server ──────────────────────────────────────────────────────────
echo.
echo [INFO] Starting Local Comet on http://localhost:5051
echo [INFO] This window must stay open while Local Comet is running.
echo [INFO] Open http://localhost:5051 in your browser manually.
echo [INFO] Press Ctrl+C to stop.
echo.

set NODE_ENV=production
set LOCAL_COMET_PORT=5051

node dist\index.cjs

if errorlevel 1 (
    echo.
    echo [ERROR] Server exited with an error.
    echo         Try running: npm run build
    echo         Then start again.
    pause
    exit /b 1
)

pause
endlocal
