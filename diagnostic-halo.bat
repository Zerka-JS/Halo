@echo off
chcp 65001 >nul
echo Halo - diagnostic son et Spotify
echo Lance Spotify et mets un morceau AVANT de continuer.
pause
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0diagnostic-halo.ps1"
echo.
echo Le resultat est dans halo-diagnostic.txt (dans le dossier de Halo). Colle son contenu dans la conversation.
pause
