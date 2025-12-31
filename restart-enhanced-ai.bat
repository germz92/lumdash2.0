@echo off
echo 🚀 Restarting LumDash with Enhanced AI Assistant...
echo.

REM Kill any existing node processes
echo 🛑 Stopping existing server...
taskkill /f /im node.exe 2>nul
timeout /t 2 /nobreak >nul

echo.
echo ✨ Starting server with ENHANCED AI CAPABILITIES:
echo   📱 Page context awareness
echo   🧠 Cross-page intelligence  
echo   🔗 Data relationship understanding
echo   ⚠️  Proactive alerts and suggestions
echo   🕒 Time-aware responses
echo.

echo 📊 Watch for these enhanced logs:
echo   - Page context detection
echo   - Cross-page data linking
echo   - Smart data filtering
echo.

REM Start the server
node server.js

pause
