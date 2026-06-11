# clean-and-build.ps1
# Limpia artefactos de builds anteriores y lanza un build standalone limpio.
#
# Uso desde C:\Users\Sergio\Documents\Proyectos\Calendario\desktop\
#   .\scripts\clean-and-build.ps1

$ErrorActionPreference = 'Continue'

Write-Host "===== Limpieza de builds anteriores =====" -ForegroundColor Cyan

$desktopRoot = Split-Path -Parent $PSScriptRoot
$projectRoot = Split-Path -Parent $desktopRoot
$backendDir  = Join-Path $projectRoot 'backend'

$paths = @(
    (Join-Path $desktopRoot 'release'),
    (Join-Path $desktopRoot 'resources\backend.jar'),
    (Join-Path $desktopRoot '_jre_tmp.zip'),
    (Join-Path $backendDir  'target')
    # Para forzar redescarga del JRE, descomenta:
    # ,(Join-Path $desktopRoot 'resources\jre')
)

foreach ($p in $paths) {
    if (Test-Path $p) {
        Write-Host "  borrando $p"
        Remove-Item -Path $p -Recurse -Force -ErrorAction SilentlyContinue
    } else {
        Write-Host "  (no existe) $p"
    }
}

Write-Host ""
Write-Host "===== Lanzando build standalone =====" -ForegroundColor Cyan
Set-Location $desktopRoot
npm run dist:standalone

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "===== Build OK =====" -ForegroundColor Green
    Write-Host "Ejecutables en: $desktopRoot\release\"
    Get-ChildItem -Path "$desktopRoot\release\" -Filter "*.exe" | Format-Table Name, Length, LastWriteTime

    # --- Copiar instalador y portable a <proyecto>\releases\ (carpeta versionada) ---
    $releasesDir = Join-Path $projectRoot 'releases'
    New-Item -ItemType Directory -Path $releasesDir -Force | Out-Null
    Get-ChildItem -Path "$desktopRoot\release\" -Filter "ProCalendar-*.exe" | ForEach-Object {
        Copy-Item $_.FullName -Destination $releasesDir -Force
        Write-Host "  copiado a releases\: $($_.Name)" -ForegroundColor Green
    }
    Write-Host ""
    Write-Host "Listos para commit/push en: $releasesDir" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "===== Build FALLO (exit $LASTEXITCODE) =====" -ForegroundColor Red
}
