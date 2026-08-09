# Generate SHA-256 checksums for release artefacts in dist/
$ErrorActionPreference = "Stop"
$dist = Join-Path $PSScriptRoot "..\dist"
if (-not (Test-Path $dist)) { throw "dist/ not found - build first" }

# Only ship artefacts: portable + Setup (skip unpacked Keycode.exe copies)
$files = Get-ChildItem $dist -File | Where-Object {
  $_.Name -match '^Keycode-(.+-portable|Setup-.+)\.(exe|7z|zip)$'
}
if (-not $files) { throw "No Keycode artefacts in dist/" }

$out = Join-Path $dist "SHA256SUMS.txt"
$lines = @()
foreach ($f in $files) {
  $hash = (Get-FileHash $f.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $lines += "$hash  $($f.Name)"
  Write-Host "$($f.Name): $hash"
}
$lines | Set-Content -Path $out -Encoding utf8
Write-Host "Wrote $out"
