# PowerShell script to create or update the VoiceText PC App Desktop shortcut with a global hotkey
$WshShell = New-Object -ComObject WScript.Shell
$DesktopPath = [System.Environment]::GetFolderPath('Desktop')
$Shortcut = $WshShell.CreateShortcut("$DesktopPath\VoiceText PC App.lnk")

$ChromePath = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" -ErrorAction SilentlyContinue).'(default)'
if (-not $ChromePath) {
  $ChromePath = (Get-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe" -ErrorAction SilentlyContinue).'(default)'
}

$Shortcut.TargetPath = $ChromePath
$Shortcut.Arguments = '--app="http://localhost:3000"'
$Shortcut.Hotkey = 'Ctrl+Alt+V'
$Shortcut.IconLocation = "$PSScriptRoot\assets\icon32.png,0"
$Shortcut.Description = "Launch VoiceText Standalone App Window (HotKey: Ctrl+Alt+V)"
$Shortcut.Save()

Write-Host "Created Desktop Shortcut: '$DesktopPath\VoiceText PC App.lnk' with Hotkey 'Ctrl+Alt+V'"
