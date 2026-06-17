@echo off
echo =========================================
echo CGal - Local Server Setup
echo =========================================
echo.
echo Installing dependencies...
call npm install

echo.
echo Building frontend and backend...
call npm run build

echo.
echo Starting the server...
echo The app will be available at http://localhost:3000
echo.
call npm run start

pause
