param([switch]$Apply)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Split-Path -Parent $PSScriptRoot))
$current = [version](Get-Content -LiteralPath (Join-Path $projectRoot 'package.json') -Raw | ConvertFrom-Json).version
$releaseRoot = Join-Path $projectRoot 'release'
$tempRoot = Join-Path $projectRoot 'tmp'
$targets = @()
if (Test-Path -LiteralPath $releaseRoot) {
  $targets += Get-ChildItem -LiteralPath $releaseRoot -Force | Where-Object {
    if ($_.Name -eq 'win-unpacked') { return $true }
    if ($_.Name -match '^(\d+\.\d+\.\d+)(?:\.zip)?$') { return [version]$Matches[1] -lt $current }
    if ($_.Name -match '^PDFSandwich(?: Setup |-Setup-)(\d+\.\d+\.\d+)\.exe(?:\.blockmap)?$') { return [version]$Matches[1] -lt $current }
    return $false
  }
}
$processes = @(Get-CimInstance Win32_Process)
$transferActive = $processes | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'scripts[\\/]update-transfer-test\.cjs' }
if ((Test-Path -LiteralPath $tempRoot) -and -not $transferActive) {
  $targets += Get-ChildItem -LiteralPath $tempRoot -Directory -Filter 'update-transfer-*'
}
$inventory = @()
$skipped = @()
foreach ($target in $targets) {
  $resolved = (Resolve-Path -LiteralPath $target.FullName).Path
  $inRelease = $resolved.StartsWith($releaseRoot + '\', [StringComparison]::OrdinalIgnoreCase)
  $inTemp = $resolved.StartsWith($tempRoot + '\', [StringComparison]::OrdinalIgnoreCase)
  if (-not ($inRelease -or $inTemp)) { throw "Target outside generated output: $resolved" }
  if ($target.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw "Refusing linked target: $resolved" }
  $children = @(if ($target.PSIsContainer) { Get-ChildItem -LiteralPath $resolved -Recurse -Force })
  if ($children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw "Refusing directory containing links: $resolved" }
  if ($children | Where-Object { $_.Name -eq '文献库' -or (-not $_.PSIsContainer -and $_.Extension -eq '.pdf') }) {
    $skipped += [pscustomobject]@{ Path = $resolved; Reason = 'Contains a PDF library or PDF documents; retained' }
    continue
  }
  if ($processes | Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($resolved + '\', [StringComparison]::OrdinalIgnoreCase) }) { throw "A running program uses: $resolved" }
  $bytes = if ($target.PSIsContainer) { ($children | Where-Object { -not $_.PSIsContainer } | Measure-Object Length -Sum).Sum } else { $target.Length }
  $inventory += [pscustomobject]@{ Path = $resolved; Bytes = [long]$bytes }
}
$driveName = [IO.Path]::GetPathRoot($projectRoot).TrimEnd(':\')
$freeBefore = (Get-PSDrive -Name $driveName).Free
foreach ($item in $inventory) {
  if ($Apply) { Remove-Item -LiteralPath $item.Path -Recurse -Force }
}
$freeAfter = (Get-PSDrive -Name $driveName).Free
[pscustomobject]@{ Applied = [bool]$Apply; RetainedVersion = "$current"; Targets = $inventory; Skipped = $skipped; FreeSpaceIncrease = if ($Apply) { $freeAfter - $freeBefore } else { 0 } } | ConvertTo-Json -Depth 4
