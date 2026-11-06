@echo off
chcp 65001 >nul
title Booster Club - laisse cette fenetre ouverte pendant que tu joues
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
set OPEN_BROWSER=1
node server.js
echo.
echo Le serveur du jeu s'est arrete. Si une erreur est affichee au-dessus, fais une capture et envoie-la a Claude.
pause
