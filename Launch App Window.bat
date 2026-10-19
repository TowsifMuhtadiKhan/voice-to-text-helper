@echo off
title Launching VoiceText App Window...

:: Start the web server in the background if not already running
netstat -ano | find "3000" >nul
if %errorlevel% neq 0 (
  start "" /min node web/server.mjs
  timeout /t 1 >nul
)

:: Try Chrome standalone app window
start "" chrome.exe --app="http://localhost:3000" 2>nul
if %errorlevel% equ 0 exit

:: Try Microsoft Edge standalone app window
start "" msedge.exe --app="http://localhost:3000" 2>nul
if %errorlevel% equ 0 exit

:: Fallback to default browser
start "" "http://localhost:3000"
exit
