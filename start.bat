@echo off
echo.
echo  ================================
echo   RoboBuilder - AI Roblox Builder
echo  ================================
echo.
echo Starting Bridge Server...
start "Bridge Server" cmd /k "cd /d %~dp0bridge-server && node src/index.js"
echo.
echo Starting Web App...
timeout /t 2 /nobreak > nul
start "Web App" cmd /k "cd /d %~dp0web-app && npm run dev"
echo.
echo Waiting for servers to start...
timeout /t 5 /nobreak > nul
echo.
echo Opening browser...
start http://localhost:3000
echo.
echo  Bridge:  http://localhost:3456
echo  Web App: http://localhost:3000
echo.
echo Don't forget to click "Connect" in the Roblox Studio plugin!
echo.
pause
