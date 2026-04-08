#Requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap Local Comet on Windows.

.DESCRIPTION
  Normal mode (default):
    - Single-instance guard: if port 5051 is already listening AND /api/health
      returns HTTP 200, skip everything and just print the URL.
    - Otherwise: hard-kills any stale process on port 5051, updates the repo
      (fetch + reset --hard), rebuilds, starts the server, polls /api/health.

  Force-fresh mode (-ForceFresh):
    - Bypasses the single-instance guard.
    - Hard-kills any process on port 5051.
    - Deletes the entire local repo folder (including node_modules and dist).
    - Clones a clean copy from GitHub.
    - Installs dependencies, builds, starts the server.
    - Guarantees no stale UI assets, no old dist artifacts survive the update.

.PARAMETER ForceFresh
  Switch.  When set, wipe the local copy and reclone from scratch.
  Example:
    powershell -ExecutionPolicy Bypass -File bootstrap-local-comet.ps1 -ForceFresh

.NOTES
  Does NOT open the browser automatically — prints the URL for the user.
#>
param(
  [switch]$ForceFresh
)

$ErrorActionPreference = 'Stop'

# -- Config --------------------------------------------------------------------
$repoUrl       = 'https://github.com/fdf52400-arch/local-comet.git'
$repoPath      = Join-Path $env:USERPROFILE 'local-comet'
$port          = 5051
$host_addr     = '127.0.0.1'
$healthUrl     = "http://$host_addr`:$port/api/health"
$appUrl        = "http://$host_addr`:$port/#/"
$healthTimeout = 90          # seconds to wait for server ready
$healthPoll    = 2           # seconds between health probes
# ------------------------------------------------------------------------------

Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
if ($ForceFresh) {
  Write-Host '  Local Comet  —  FORCE-FRESH bootstrap'  -ForegroundColor Magenta
} else {
  Write-Host '  Local Comet  —  bootstrap'               -ForegroundColor Cyan
}
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''

# -- 0. Single-instance guard (skipped in force-fresh mode) --------------------
function Test-ServerHealthy {
  try {
    $resp = Invoke-WebRequest -Uri $healthUrl `
                              -UseBasicParsing `
                              -TimeoutSec 3 `
                              -ErrorAction Stop
    return ($resp.StatusCode -eq 200)
  } catch {
    return $false
  }
}

if (-not $ForceFresh) {
  if (Test-ServerHealthy) {
    Write-Host '[OK] Local Comet is already running.' -ForegroundColor Green
    Write-Host ''
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host '  Already running — no action taken.'      -ForegroundColor Green
    Write-Host "  Open in browser: $appUrl"                -ForegroundColor Cyan
    Write-Host '  (Use -ForceFresh to wipe and reclone.)'  -ForegroundColor DarkGray
    Write-Host '==========================================' -ForegroundColor Cyan
    Write-Host ''
    exit 0
  }
}

# -- 1. Hard-kill anything on port $port ---------------------------------------
function Kill-Port {
  param([int]$p)
  Write-Host "[1] Freeing port $p..." -ForegroundColor Yellow
  try {
    $conns = Get-NetTCPConnection -LocalPort $p -State Listen,Established,TimeWait,CloseWait -ErrorAction SilentlyContinue
    if ($conns) {
      $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
      foreach ($pid in $pids) {
        if ($pid -and $pid -ne 0) {
          try {
            $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
            if ($proc) {
              Write-Host "    Killing PID $pid ($($proc.ProcessName))..." -ForegroundColor DarkYellow
              Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
            }
          } catch {}
        }
      }
      # Wait for the OS to fully release the port
      $waited = 0
      while ($waited -lt 5) {
        Start-Sleep -Milliseconds 500
        $still = Get-NetTCPConnection -LocalPort $p -ErrorAction SilentlyContinue
        if (-not $still) { break }
        $waited++
      }
      Write-Host "    Port $p freed." -ForegroundColor Green
    } else {
      Write-Host "    Port $p is free." -ForegroundColor Green
    }
  } catch {
    Write-Host "    (Could not check port $p — continuing)" -ForegroundColor DarkGray
  }
}

Kill-Port $port

# -- 2. Clone / update repo ----------------------------------------------------
Write-Host ''
Set-Location $env:USERPROFILE

if ($ForceFresh) {
  # ---- FORCE-FRESH: delete everything, clone clean ----------------------------
  Write-Host '[2] FORCE-FRESH — deleting local copy...' -ForegroundColor Magenta
  if (Test-Path $repoPath) {
    Write-Host "    Removing $repoPath (this may take a moment for node_modules)..." -ForegroundColor DarkYellow
    # Remove-Item -Recurse -Force can be slow or fail on deep node_modules trees.
    # Use cmd /c rd /s /q which is faster and more reliable on Windows.
    cmd /c "rd /s /q `"$repoPath`""
    if (Test-Path $repoPath) {
      # Fallback: PowerShell native remove
      Remove-Item -Recurse -Force $repoPath -ErrorAction Stop
    }
    Write-Host "    Old copy deleted." -ForegroundColor Green
  } else {
    Write-Host "    No existing folder found — nothing to delete." -ForegroundColor DarkGray
  }

  Write-Host '[2] Cloning fresh copy from GitHub...' -ForegroundColor Magenta
  git clone $repoUrl $repoPath
  if ($LASTEXITCODE -ne 0) { throw 'git clone failed' }
  Write-Host '    Fresh clone complete.' -ForegroundColor Green

} else {
  # ---- NORMAL UPDATE: fetch + reset --hard ------------------------------------
  Write-Host '[2] Updating repository...' -ForegroundColor Yellow
  if (Test-Path (Join-Path $repoPath '.git')) {
    git -C $repoPath remote set-url origin $repoUrl
    git -C $repoPath fetch origin
    git -C $repoPath reset --hard origin/master
    git -C $repoPath clean -fdx
  } elseif (Test-Path $repoPath) {
    Write-Host '    Removing broken folder...' -ForegroundColor DarkYellow
    Remove-Item -Recurse -Force $repoPath
    git clone $repoUrl $repoPath
  } else {
    git clone $repoUrl $repoPath
  }
  Write-Host '    Repository ready.' -ForegroundColor Green
}

# -- 3. Install & build --------------------------------------------------------
Write-Host ''
Write-Host '[3] Installing dependencies...' -ForegroundColor Yellow
Set-Location $repoPath
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Host ''
Write-Host '[3] Building project...' -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Write-Host '    Build complete.' -ForegroundColor Green

# -- 4. Start server in a new window ------------------------------------------
Write-Host ''
Write-Host '[4] Starting Local Comet server...' -ForegroundColor Yellow

$launchCmd = @"
`$host.UI.RawUI.WindowTitle = 'Local Comet Server (port $port)';
Set-Location '$repoPath';
`$env:HOST='$host_addr';
`$env:NODE_ENV='production';
node .\dist\index.cjs
"@

Start-Process powershell -ArgumentList '-NoExit', '-Command', $launchCmd

# -- 5. Poll /api/health until ready ------------------------------------------
Write-Host ''
Write-Host "[5] Waiting for server at $healthUrl ..." -ForegroundColor Yellow

$elapsed = 0
$ready   = $false

while ($elapsed -lt $healthTimeout) {
  Start-Sleep -Seconds $healthPoll
  $elapsed += $healthPoll

  try {
    $resp = Invoke-WebRequest -Uri $healthUrl `
                              -UseBasicParsing `
                              -TimeoutSec 3 `
                              -ErrorAction Stop

    if ($resp.StatusCode -eq 200) {
      $ready = $true
      Write-Host "    Server ready after $elapsed s." -ForegroundColor Green
      break
    }
  } catch {
    Write-Host "    ...waiting ($elapsed/$healthTimeout s)" -ForegroundColor DarkGray
  }
}

if (-not $ready) {
  Write-Host ''
  Write-Host '==========================================' -ForegroundColor Red
  Write-Host "  ERROR: Server did not respond within $healthTimeout seconds." -ForegroundColor Red
  Write-Host "  Check the server window for error output."                    -ForegroundColor Red
  Write-Host "  Expected health endpoint: $healthUrl"                         -ForegroundColor Red
  Write-Host '==========================================' -ForegroundColor Red
  exit 1
}

# -- 6. Print URL (no auto-open) -----------------------------------------------
Write-Host ''
Write-Host '==========================================' -ForegroundColor Cyan
if ($ForceFresh) {
  Write-Host '  Force-fresh complete — Local Comet is running!' -ForegroundColor Magenta
} else {
  Write-Host '  Local Comet is running!'                        -ForegroundColor Green
}
Write-Host "  Open in browser: $appUrl"                -ForegroundColor Cyan
Write-Host "  API health    : $healthUrl"               -ForegroundColor DarkGray
Write-Host '  (close the Server window to stop)'       -ForegroundColor DarkGray
Write-Host '==========================================' -ForegroundColor Cyan
Write-Host ''
