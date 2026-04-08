@echo off
setlocal
chcp 65001 >nul 2>&1

echo.
echo  Local Comet — launcher
echo.

:: ── Single-instance guard ────────────────────────────────────────────────────
:: If Local Comet is already running and healthy, skip the full bootstrap.
:: This prevents a second server window from being spawned when the user
:: double-clicks START_LOCAL.bat while an instance is already up.

set "HEALTH_URL=http://127.0.0.1:5051/api/health"
set "APP_URL=http://127.0.0.1:5051/#/"

for /f "delims=" %%s in ('powershell -NoProfile -NonInteractive -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop; if ($r.StatusCode -eq 200) { 'HEALTHY' } else { 'DOWN' } } catch { 'DOWN' }" 2^>nul') do set "HEALTH_STATUS=%%s"

if "%HEALTH_STATUS%"=="HEALTHY" (
    echo [OK] Local Comet is already running.
    echo      Open in your browser: %APP_URL%
    echo.
    pause
    endlocal
    exit /b 0
)

:: ── Download and run the full bootstrap ──────────────────────────────────────
:: Only reached when no healthy instance is found on port 5051.
echo  Downloading bootstrap script...
echo.
powershell -ExecutionPolicy Bypass -Command ^
  "iwr https://raw.githubusercontent.com/fdf52400-arch/local-comet/master/bootstrap-local-comet.ps1 -OutFile $env:USERPROFILE\bootstrap-local-comet.ps1; powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\bootstrap-local-comet.ps1"
endlocal
