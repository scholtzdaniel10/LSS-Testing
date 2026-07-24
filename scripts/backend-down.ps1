# PLT-1 — stop portable backend stack.
param(
    [switch]$RemoveVolumes
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$env:Path = [System.Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' +
    [System.Environment]::GetEnvironmentVariable('Path', 'User')

Push-Location $RepoRoot
try {
    if ($RemoveVolumes) {
        docker compose down -v
    } else {
        docker compose down
    }
} finally {
    Pop-Location
}
