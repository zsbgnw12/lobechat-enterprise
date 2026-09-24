# Pack org-customer-lookup with SKILL.md at zip root (Windows Compress-Archive wraps a folder).
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$Root = $PSScriptRoot
$Dest = Join-Path $Root 'org-customer-lookup.zip'
if (Test-Path $Dest) { Remove-Item -LiteralPath $Dest }

$zip = [System.IO.Compression.ZipFile]::Open($Dest, 'Create')
try {
  [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
    $zip,
    (Join-Path $Root 'SKILL.md'),
    'SKILL.md'
  ) | Out-Null
  Get-ChildItem -LiteralPath (Join-Path $Root 'references') -File | ForEach-Object {
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $zip,
      $_.FullName,
      ('references/' + $_.Name)
    ) | Out-Null
  }
}
finally {
  $zip.Dispose()
}

Write-Host "Wrote $Dest"
