@echo off
rem CoverForge Studio: doppio clic per avviarlo su Windows (dai sorgenti, serve Node.js 20.3 o successivo)
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo Serve Node.js 20.3 o successivo: scaricalo da https://nodejs.org e poi riapri questo file.
  echo In alternativa scarica il programma di installazione di CoverForge, che non richiede Node.js.
  echo.
  pause
  exit /b 1
)
node start.js
if errorlevel 1 pause
