@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

echo.
echo  ╔══════════════════════════════════════════╗
echo  ║         Local Comet — local mode         ║
echo  ║  Ollama  : http://localhost:11436         ║
echo  ║  LM Studio: http://localhost:1234         ║
echo  ╚══════════════════════════════════════════╝
echo.

:: ── Check Node.js ──────────────────────────────────────────────────────────────
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install from https://nodejs.org (LTS recommended)
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%v in ('node --version 2^>nul') do set "NODE_VER=%%v"
echo [OK] Node.js found: %NODE_VER%

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

:: ── Optional: remind user to run db:push if schema was changed ─────────────────
if not exist "data.db" (
    echo [INFO] No database found. Running db:push to create schema...
    call npx drizzle-kit push >nul 2>&1
    echo [OK] Database schema created.
)

:: ── Check if port 5051 is already in use ──────────────────────────────────────
netstat -ano | findstr ":5051 " >nul 2>&1
if not errorlevel 1 (
    echo [WARN] Port 5051 is already in use. Another instance may be running.
    echo        Open http://localhost:5051 in your browser to check.
    pause
    exit /b 0
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

node dist/index.cjs

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
