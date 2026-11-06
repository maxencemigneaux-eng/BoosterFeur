@echo off
title Booster Club
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js n'est pas installe. Telecharge la version LTS sur https://nodejs.org puis relance ce fichier.
  pause
  exit /b
)
if not exist node_modules (
  echo Installation des dependances, une seule fois...
  call npm install
)
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server.js
pause
