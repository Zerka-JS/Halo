@echo off
rem A lancer si la barre des taches Windows reste cachee apres un arret brutal de Halo.
taskkill /f /im halo-desktop.exe >nul 2>&1
taskkill /f /im explorer.exe >nul 2>&1
start explorer.exe
