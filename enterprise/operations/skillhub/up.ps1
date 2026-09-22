# [enterprise-fork] Start / stop a SkillHub sidecar without vendoring upstream Compose.
param(
  [ValidateSet('up', 'down', 'ps', 'pull', 'refresh')]
  [string]$Command = 'up'
)

$ErrorActionPreference = 'Stop'
$Pin = 'v0.2.21'
$Project = 'heihub-skillhub'
$Root = $PSScriptRoot
$Runtime = Join-Path $Root '.runtime'
$Overlay = Join-Path $Root 'env.heihub.example'
$Compose = Join-Path $Runtime 'compose.release.yml'
$EnvExample = Join-Path $Runtime '.env.release.example'
$EnvFile = Join-Path $Runtime '.env.release'
$RawBase = "https://raw.githubusercontent.com/iflytek/skillhub/$Pin"

function Get-DockerCompose {
  if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose version | Out-Null
    if ($LASTEXITCODE -eq 0) { return @('docker', 'compose') }
  }
  throw 'docker compose is required to run the SkillHub sidecar.'
}

function Save-RemoteFile([string]$Url, [string]$Path) {
  Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $Path
  if (-not (Test-Path $Path) -or (Get-Item $Path).Length -lt 32) {
    throw "Failed to download $Url"
  }
}

function Sync-OfficialFiles {
  New-Item -ItemType Directory -Force -Path $Runtime | Out-Null
  Write-Host "Fetching SkillHub $Pin compose files into $Runtime"
  Save-RemoteFile "$RawBase/compose.release.yml" $Compose
  Save-RemoteFile "$RawBase/.env.release.example" $EnvExample
}

function Merge-Overlay([string]$Source, [string]$Target) {
  $values = @{}
  Get-Content -LiteralPath $Source | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $name, $value = $_.Split('=', 2)
    $values[$name.Trim()] = $value
  }

  $lines = Get-Content -LiteralPath $Target
  $seen = @{}
  $updated = foreach ($line in $lines) {
    if ($line -match '^\s*#' -or $line -notmatch '=') {
      $line
      continue
    }
    $name, $rest = $line.Split('=', 2)
    $key = $name.Trim()
    if ($values.ContainsKey($key)) {
      $seen[$key] = $true
      "$key=$($values[$key])"
    }
    else {
      $line
    }
  }

  foreach ($key in $values.Keys) {
    if (-not $seen.ContainsKey($key)) {
      $updated += "$key=$($values[$key])"
    }
  }

  Set-Content -LiteralPath $Target -Value $updated -Encoding utf8
}

function Initialize-EnvFile {
  if (Test-Path $EnvFile) { return }
  if (-not (Test-Path $Overlay)) { throw "Missing overlay $Overlay" }
  Copy-Item -LiteralPath $EnvExample -Destination $EnvFile
  Merge-Overlay -Source $Overlay -Target $EnvFile
  Write-Host "Created $EnvFile from official example + heihub overlay. Edit passwords before exposing the stack."
}

function Invoke-Sidecar([string[]]$ComposeArgs) {
  $compose = Get-DockerCompose
  & $compose[0] $compose[1] -p $Project --env-file $EnvFile -f $Compose @ComposeArgs
  if ($LASTEXITCODE -ne 0) { throw "docker compose $($ComposeArgs -join ' ') failed" }
}

switch ($Command) {
  'refresh' {
    Sync-OfficialFiles
    Initialize-EnvFile
  }
  'up' {
    if (-not (Test-Path $Compose) -or -not (Test-Path $EnvExample)) { Sync-OfficialFiles }
    Initialize-EnvFile
    Invoke-Sidecar @('up', '-d')
    Write-Host ''
    Write-Host 'SkillHub sidecar is up.'
    Write-Host '  UI / SKILLHUB_URL (host):     http://127.0.0.1:18088'
    Write-Host '  API:                          http://127.0.0.1:18080'
    Write-Host '  From this repo docker stack:  SKILLHUB_URL=http://host.docker.internal:18088'
    Write-Host '  From pnpm dev on the host:    SKILLHUB_URL=http://127.0.0.1:18088'
  }
  'down' {
    if (-not (Test-Path $Compose) -or -not (Test-Path $EnvFile)) {
      throw 'Runtime files are missing. Nothing to stop.'
    }
    Invoke-Sidecar @('down')
  }
  'ps' {
    if (-not (Test-Path $Compose) -or -not (Test-Path $EnvFile)) {
      throw 'Runtime files are missing. Run up first.'
    }
    Invoke-Sidecar @('ps')
  }
  'pull' {
    if (-not (Test-Path $Compose) -or -not (Test-Path $EnvExample)) { Sync-OfficialFiles }
    Initialize-EnvFile
    Invoke-Sidecar @('pull')
  }
}
