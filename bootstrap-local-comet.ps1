#Requires -Version 5.1
<#
.SYNOPSIS
  Bootstrap Local Comet on Windows.
  - Hard-kills any process on port 5051 before starting.
  - Clones / updates the repo and rebuilds.
  - Polls /api/health until the server is genuinely ready.
  - Opens the correct URL (127.0.0.1:5051/#/) only after the server responds.
  - Appends a cache-busting query string to prevent the browser from serving a
    stale tab / cached index.html.
#>

$ErrorActionPreference = 'Stop'

# ── Config ────────────────────────────────────────────────────────────────────
$repoUrl       = 'https://github.com/fdf52400-arch/local-comet.git'
$repoPath      = Join-Path $env:USERPROFILE 'local-comet'
$port          = 5051
$host_addr     = '127.0.0.1'
$healthUrl     = "http://$host_addr`:$port/api/health"
$healthTimeout = 60          # seconds to wait for server ready
$healthPoll    = 1           # seconds between health probes
# ─────────────────────────────────────────────────────────────────────────────

Write-Host ''
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Cyan
Write-Host '  Local Comet  —  bootstrap starting'         -ForegroundColor Cyan
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Cyan
Write-Host ''

# ── 1. Hard-kill anything on port $port ──────────────────────────────────────
function Kill-Port {
  param([int]$p)
  Write-Host "[1/5] Freeing port $p..." -ForegroundColor Yellow
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

# ── 2. Clone / update repo ───────────────────────────────────────────────────
Write-Host ''
Write-Host '[2/5] Updating repository...' -ForegroundColor Yellow
Set-Location $env:USERPROFILE

if (Test-Path (Join-Path $repoPath '.git')) {
  git -C $repoPath remote set-url origin $repoUrl
  git -C $repoPath fetch origin
  git -C $repoPath reset --hard origin/master
  git -C $repoPath clean -fdx
} elseif (Test-Path $repoPath) {
  Write-Host '  Removing broken folder...' -ForegroundColor DarkYellow
  Remove-Item -Recurse -Force $repoPath
  git clone $repoUrl $repoPath
} else {
  git clone $repoUrl $repoPath
}
Write-Host '  Repository ready.' -ForegroundColor Green

# ── 3. Install & build ───────────────────────────────────────────────────────
Write-Host ''
Write-Host '[3/5] Installing dependencies...' -ForegroundColor Yellow
Set-Location $repoPath
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Host ''
Write-Host '[3/5] Building project...' -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }
Write-Host '  Build complete.' -ForegroundColor Green

# ── 4. Start server in a new window ─────────────────────────────────────────
Write-Host ''
Write-Host '[4/5] Starting Local Comet server...' -ForegroundColor Yellow

# Build the launch command — bind to 127.0.0.1 to avoid Windows firewall prompts
# and ENOTSUP on SO_REUSEPORT.  Title the window so the user can identify it.
$launchCmd = @"
`$host.UI.RawUI.WindowTitle = 'Local Comet Server (port $port)';
Set-Location '$repoPath';
`$env:HOST='$host_addr';
`$env:NODE_ENV='production';
node .\dist\index.cjs
"@

Start-Process powershell -ArgumentList '-NoExit', '-Command', $launchCmd

# ── 5. Poll /api/health until ready ─────────────────────────────────────────
Write-Host ''
Write-Host "[5/5] Waiting for server at $healthUrl ..." -ForegroundColor Yellow

$elapsed  = 0
$ready    = $false

while ($elapsed -lt $healthTimeout) {
  Start-Sleep -Seconds $healthPoll
  $elapsed += $healthPoll

  try {
    # Use WebRequest with a short timeout; -UseBasicParsing avoids IE engine dependency
    $resp = Invoke-WebRequest -Uri $healthUrl `
                              -UseBasicParsing `
                              -TimeoutSec 3 `
                              -ErrorAction Stop

    if ($resp.StatusCode -eq 200) {
      $ready = $true
      Write-Host "  Server ready after $elapsed s." -ForegroundColor Green
      break
    }
  } catch {
    # Not up yet — keep polling silently
    Write-Host "  ...waiting ($elapsed/$healthTimeout s)" -ForegroundColor DarkGray
  }
}

if (-not $ready) {
  Write-Host ''
  Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Red
  Write-Host "  ERROR: Server did not respond within $healthTimeout seconds." -ForegroundColor Red
  Write-Host "  Check the server window for error output."                    -ForegroundColor Red
  Write-Host "  Expected health endpoint: $healthUrl"                         -ForegroundColor Red
  Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Red
  exit 1
}

# ── 6. Open browser — deterministic open sequence ───────────────────────────
# Strategy:
#   a) Wait a brief stabilization period after health OK so async server init
#      (DB seed, Chromium probe, etc.) can finish before the browser fires.
#   b) Open the plain root URL first so the browser definitely loads a fresh
#      page from the server (no cached about:blank / stale tab).
#   c) After the page has had time to load, navigate to the hash route so
#      React Router initialises correctly.
#   d) Cache-bust with a timestamp query param so even a cached entry is skipped.

# Small stabilization window after first health OK — avoids opening the browser
# while the server is still completing async startup (DB seed, Chromium probe).
Write-Host '  Waiting 2 s for server to stabilise...' -ForegroundColor DarkGray
Start-Sleep -Seconds 2

$cacheBust = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()

# Root URL (no hash yet) — browser unconditionally requests a fresh page.
$rootUrl   = "http://$host_addr`:$port/?v=$cacheBust"
# Hash URL — passed to the browser after the page has been fetched.
$hashUrl   = "http://$host_addr`:$port/#/"

Write-Host ''
Write-Host "Opening: $hashUrl" -ForegroundColor Cyan

# Prefer navigating via the shell URL handler so the OS picks the default
# browser and opens a new tab with the correct URL from the start.
# We pass the hash URL directly — modern browsers open it as a fresh tab.
try {
  # Try to open via Start-Process with the default browser explicitly.
  # Use the root URL for the initial fetch, then immediately replace with hash.
  # Opening the root URL first forces a genuine HTTP request (no stale tab).
  Start-Process $rootUrl

  # Give the browser a moment to start the request, then open the hash URL.
  # If the browser reuses the same tab (Chrome/Edge behaviour) it will
  # navigate directly to /#/ which is what we want.
  Start-Sleep -Seconds 2
  Start-Process $hashUrl
} catch {
  # Fallback: open the combined URL if the above fails for any reason.
  $fallbackUrl = "http://$host_addr`:$port/?v=$cacheBust#/"
  Write-Host "  Fallback open: $fallbackUrl" -ForegroundColor DarkYellow
  Start-Process $fallbackUrl
}

Write-Host ''
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Cyan
Write-Host '  Local Comet is running!'                     -ForegroundColor Green
Write-Host "  URL : http://$host_addr`:$port/#/"           -ForegroundColor Green
Write-Host "  API : $healthUrl"                            -ForegroundColor DarkGray
Write-Host '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━' -ForegroundColor Cyan
Write-Host ''
