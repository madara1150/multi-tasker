@echo off
rem Builds dist\Baton-Windows-Setup.exe and dist\Baton-Windows-Portable.zip
cd /d "%~dp0"
call npm install || exit /b 1
call npm run dist:win || exit /b 1
dir dist\Baton-Windows-*
