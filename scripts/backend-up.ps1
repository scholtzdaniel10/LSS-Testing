# PLT-1 — start portable backend (api + worker + postgres + redis).
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$EnvDocker = Join-Path $RepoRoot 'apps\api\.env.docker'

# Refresh PATH so a newly installed Docker Desktop is visible in this shell.
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [System.Environment]::GetEnvironmentVariable('Path', 'User')

function Test-Command($Name) {
    $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

if (-not (Test-Command docker)) {
    Write-Error 'Docker is not on PATH. Install Docker Desktop and open a new terminal, or re-run this script.'
}

docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error 'Docker Compose v2 is required (docker compose).'
}

function Ensure-AppKey {
    if (-not (Test-Path $EnvDocker)) {
        Write-Error "Missing $EnvDocker"
    }
    $lines = Get-Content $EnvDocker
    $keyLine = $lines | Where-Object { $_ -match '^\s*APP_KEY=' } | Select-Object -First 1
    $value = ''
    if ($keyLine -match '^\s*APP_KEY=(.*)$') {
        $value = $Matches[1].Trim()
    }
    if ($value -eq '' -or $value -eq 'base64:') {
        $bytes = New-Object byte[] 32
        [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
        $generated = 'base64:' + [Convert]::ToBase64String($bytes)
        $replaced = $false
        $newLines = foreach ($line in $lines) {
            if ($line -match '^\s*APP_KEY=') {
                $replaced = $true
                "APP_KEY=$generated"
            } else {
                $line
            }
        }
        if (-not $replaced) {
            $newLines += "APP_KEY=$generated"
        }
        Set-Content -Path $EnvDocker -Value $newLines -Encoding utf8
        Write-Host "Wrote new APP_KEY to apps/api/.env.docker"
    }
}

Ensure-AppKey

Push-Location $RepoRoot
try {
    Write-Host 'Building and starting backend stack...'
    docker compose up -d --build
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

    $healthUrl = 'http://127.0.0.1:8000/api/v1/health'
    $deadline = (Get-Date).AddMinutes(5)
    Write-Host "Waiting for $healthUrl ..."
    do {
        try {
            $resp = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
            if ($resp.StatusCode -eq 200) {
                Write-Host 'API healthy.'
                break
            }
        } catch {
            # still starting
        }
        if ((Get-Date) -gt $deadline) {
            Write-Error 'Timed out waiting for API health. Check: docker compose logs api'
        }
        Start-Sleep -Seconds 3
    } while ($true)

    Write-Host ''
    Write-Host 'Portable backend is up:'
    Write-Host '  API     http://127.0.0.1:8000  (GET /api/v1/health)'
    Write-Host '  Postgres localhost:5432  (lss / lss / database lss)'
    Write-Host '  Redis    localhost:6379'
    Write-Host ''
    Write-Host 'Next steps:'
    Write-Host '  1. Seed users (first time): docker compose exec api php artisan db:seed --force'
    Write-Host '  2. Issue web token:         docker compose exec api php artisan token:issue jean@lss.local --label=web'
    Write-Host '  3. Web UI:                  cd apps/web; npm install; npm run dev'
    Write-Host '  4. Stop stack:              scripts/backend-down.ps1'
    Write-Host ''
    Write-Host 'Tier 1 Electron exe uses its own bundled PHP sidecar (Windows). This compose stack is the shared cross-platform backend for dev.'
} finally {
    Pop-Location
}
