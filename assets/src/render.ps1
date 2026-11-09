# Renders the Flow Studio image kit with headless Chrome.
# Usage: powershell -ExecutionPolicy Bypass -File render.ps1

$ErrorActionPreference = 'Stop'

$src    = $PSScriptRoot
$assets = Split-Path $src -Parent
$root   = Split-Path $assets -Parent

$chromeCandidates = @(
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
)
$chrome = $chromeCandidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $chrome) { throw 'Chrome or Edge not found.' }

$profileDir = Join-Path $env:TEMP 'flow-studio-render-profile'
New-Item -ItemType Directory -Force -Path $profileDir | Out-Null

$shots = @(
  @{ file = '01-editor.html';        out = 'screenshots\01-editor.png';        w = 1760; h = 1020; bg = '070a0f' },
  @{ file = '02-graph.html';         out = 'screenshots\02-graph-laidout.png'; w = 1760; h = 900;  bg = '070a0f' },
  @{ file = '03-graph-manual.html';  out = 'screenshots\03-graph-manual.png';  w = 1760; h = 900;  bg = '070a0f' },
  @{ file = '04-json.html';          out = 'screenshots\04-json.png';          w = 1760; h = 1020; bg = '070a0f' },
  @{ file = '05-launch.html';        out = 'screenshots\05-launch.png';        w = 1600; h = 620;  bg = '070a0f' },
  @{ file = 'hero.html';             out = 'assets\hero.png';                  w = 1600; h = 820;  bg = '070a0f' },
  @{ file = 'social.html';           out = 'assets\social-preview.png';        w = 1280; h = 640;  bg = '070a0f' },
  @{ file = 'architecture.html';     out = 'assets\architecture.png';          w = 1600; h = 760;  bg = '070a0f' },
  @{ file = 'logo.html';             out = 'assets\logo.png';                  w = 512;  h = 512;  bg = '00000000' }
)

foreach ($s in $shots) {
  $html = Join-Path $src $s.file
  $out  = Join-Path $root $s.out
  New-Item -ItemType Directory -Force -Path (Split-Path $out -Parent) | Out-Null
  $url  = ([System.Uri]$html).AbsoluteUri

  $args = @(
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--run-all-compositor-stages-before-draw',
    '--virtual-time-budget=5000',
    "--user-data-dir=$profileDir",
    "--default-background-color=$($s.bg)",
    "--window-size=$($s.w),$($s.h)",
    "--screenshot=$out",
    $url
  )

  Write-Host ("Rendering {0} -> {1}" -f $s.file, $s.out)
  $ErrorActionPreference = 'Continue'
  & $chrome @args 2>$null | Out-Null
  $ErrorActionPreference = 'Stop'
  if (-not (Test-Path $out)) { throw "Screenshot was not created: $out" }
  $item = Get-Item $out
  Write-Host ("  {0} × {1}?  {2:N1} KB" -f $s.w, $s.h, ($item.Length / 1KB))
}

Write-Host 'Done.'
