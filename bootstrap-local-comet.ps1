$ErrorActionPreference = 'Stop'
$repoUrl = 'https://github.com/fdf52400-arch/local-comet.git'
$repoPath = Join-Path $env:USERPROFILE 'local-comet'

Write-Host 'Local Comet bootstrap starting...' -ForegroundColor Cyan

# Make sure we are outside the repo before cleanup/update
Set-Location $env:USERPROFILE

if (Test-Path (Join-Path $repoPath '.git')) {
  Write-Host 'Updating existing repository...' -ForegroundColor Yellow
  git -C $repoPath fetch origin
  git -C $repoPath reset --hard origin/master
  git -C $repoPath clean -fdx
} elseif (Test-Path $repoPath) {
  Write-Host 'Removing broken existing folder...' -ForegroundColor Yellow
  Remove-Item -Recurse -Force $repoPath
  git clone $repoUrl $repoPath
} else {
  Write-Host 'Cloning repository...' -ForegroundColor Yellow
  git clone $repoUrl $repoPath
}

Set-Location $repoPath

Write-Host 'Installing dependencies...' -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) { throw 'npm install failed' }

Write-Host 'Building project...' -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) { throw 'npm run build failed' }

# Free port 5051 if some dead process still owns it
try {
  $conns = Get-NetTCPConnection -LocalPort 5051 -ErrorAction SilentlyContinue
  if ($conns) {
    $pids = $conns | Select-Object -ExpandProperty OwningProcess -Unique
    foreach ($pid in $pids) {
      try { Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue } catch {}
    }
    Start-Sleep -Seconds 1
  }
} catch {}

# Bind to 127.0.0.1 by default for local Windows launch.
# This avoids the ENOTSUP error from SO_REUSEPORT and Windows firewall prompts.
# Change HOST to 0.0.0.0 only if you need LAN access from other machines.
$launchCmd = "Set-Location '$repoPath'; `$env:HOST='127.0.0.1'; node .\dist\index.cjs"
Write-Host 'Starting Local Comet...' -ForegroundColor Green
Start-Process powershell -ArgumentList '-NoExit', '-Command', $launchCmd

Start-Sleep -Seconds 4
Start-Process 'http://localhost:5051'

Write-Host 'Done. Browser should open at http://localhost:5051' -ForegroundColor Green
