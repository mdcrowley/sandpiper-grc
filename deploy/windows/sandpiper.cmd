@echo off
rem Sandpiper GRC on Windows: sandpiper status | start | stop | restart | backup | check-update | logs | open
rem Runs sandpiper.ps1 beside this file in Windows PowerShell. See that file for what each command does.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0sandpiper.ps1" %*
exit /b %ERRORLEVEL%
