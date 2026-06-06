@echo off
REM Double-click launcher (Windows). Starts the ledzeppelin daemon and opens the
REM UI in the default browser. The console window stays open while it runs —
REM closing it stops LED output.
cd /d "%~dp0"
set OPEN=1
node server\index.js
