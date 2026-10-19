# PowerShell script to create or update the VoiceText PC App Desktop shortcut with icon and version
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$StartMenu = [System.Environment]::GetFolderPath('Programs')
$IcoPath = "$PSScriptRoot\assets\icon.ico"

$ChromePath = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue).'(default)'
if (-not $ChromePath) {
  $ChromePath = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" -ErrorAction SilentlyContinue).'(default)'
}

foreach ($loc in @($DesktopPath, $StartMenu)) {
  $Shortcut = $WshShell.CreateShortcut("$loc\VoiceText PC App v1.0.0.lnk")
  $Shortcut.TargetPath = $ChromePath
  $Shortcut.Arguments = '--app="http://localhost:3000"'
  $Shortcut.Hotkey = 'Ctrl+Shift+V'
  $Shortcut.IconLocation = "$IcoPath,0"
  $Shortcut.Description = "VoiceText PC App v1.0.0 (Hotkey: Ctrl+Shift+V)"
  $Shortcut.Save()
}

Write-Host "Created Desktop & Start Menu Shortcut: 'VoiceText PC App v1.0.0' with high-res icon and hotkey Ctrl+Shift+V"
