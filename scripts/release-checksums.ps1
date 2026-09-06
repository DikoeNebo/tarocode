# Generate SHA-256 checksums for release artefacts in dist-release/ (or dist/)
# Writes UTF-8 without BOM so `sha256sum -c` works on Linux/macOS.
$ErrorActionPreference = "Stop"
$root = Join-Path $PSScriptRoot ".."
$dist = Join-Path $root "dist-release"
if (-not (Test-Path $dist)) { $dist = Join-Path $root "dist" }
if (-not (Test-Path $dist)) { throw "dist-release/ or dist/ not found - build first" }

# Only ship artefacts: portable + Setup (skip unpacked TaroCode.exe copies)
$files = Get-ChildItem $dist -File | Where-Object {
  $_.Name -match '^TaroCode-(.+-portable|Setup-.+)\.(exe|7z|zip)$'
} | Sort-Object Name
if (-not $files) { throw "No TaroCode artefacts in $dist" }

$out = Join-Path $dist "SHA256SUMS.txt"
$lines = New-Object System.Collections.Generic.List[string]
foreach ($f in $files) {
  $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $lines.Add("$hash  $($f.Name)")
  Write-Host "$($f.Name): $hash"
}
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllLines($out, $lines, $utf8NoBom)
Write-Host "Wrote $out (UTF-8, no BOM)"
