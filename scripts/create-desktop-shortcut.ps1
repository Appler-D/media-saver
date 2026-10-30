$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'MediaSaver.lnk'

$installed = Join-Path $env:LOCALAPPDATA 'Programs\MediaSaver\MediaSaver.exe'
$portable = Join-Path $root 'apps\desktop\release\win-unpacked\MediaSaver.exe'
$webLauncher = Join-Path $root 'start.bat'

if (Test-Path $installed) {
  $target = $installed
  $workingDirectory = Split-Path -Parent $installed
  $icon = "$installed,0"
} elseif (Test-Path $portable) {
  $target = $portable
  $workingDirectory = Split-Path -Parent $portable
  $icon = "$portable,0"
} else {
  $target = $webLauncher
  $workingDirectory = $root
  $icon = "$env:SystemRoot\System32\shell32.dll,14"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $target
$shortcut.WorkingDirectory = $workingDirectory
$shortcut.IconLocation = $icon
$shortcut.Description = 'MediaSaver'
$shortcut.Save()

Write-Output "Shortcut: $shortcutPath"
Write-Output "Target:   $target"
