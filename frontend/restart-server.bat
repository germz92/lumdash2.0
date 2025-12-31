@echo off
echo 🔄 Restarting LumDash Backend Server...
echo.

REM Kill any existing node processes
echo 🛑 Stopping existing server...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo 🚀 Starting server with enhanced error handling...
echo.
echo 📊 Watch for these logs:
echo   - Data size measurements
echo   - Error details if queries fail
echo   - Cache key generation
echo.

REM Start the server
node server.js

pause
