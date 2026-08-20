@echo off
setlocal enabledelayedexpansion
title Rama AGI
cd /d "%~dp0"

:MENU
cls
echo.
echo   ============================================
echo     RAMA AGI
echo   ============================================
echo.
echo     1. Start Rama  (normal use)
echo     2. Build installer from source  (installs what is missing)
echo     3. Diagnose only  (check, fix nothing)
echo     4. Exit
echo.
set /p CHOICE="  Choose 1-4 and press Enter: "

if "%CHOICE%"=="1" goto START
if "%CHOICE%"=="2" goto BUILD
if "%CHOICE%"=="3" goto DIAGNOSE
if "%CHOICE%"=="4" goto END
goto MENU

:START
echo.
echo   Starting Rama...
echo   (this window shows startup logs - closing it stops Rama)
echo.
call node start.cjs
echo.
echo   Rama has stopped.
pause
goto MENU

:BUILD
echo.
echo   Building Rama from source...
echo   Missing dependencies are installed automatically first, so this
echo   works on a fresh copy of the source. The first run takes several
echo   minutes and needs an internet connection.
echo.
call node scripts\buildInstaller.cjs
if errorlevel 1 (
    echo.
    echo   Build did not complete - the reason is in the report above.
    pause
    goto MENU
)
echo.
echo   ============================================
echo     BUILD COMPLETE
echo   ============================================
echo.
echo   Everything produced is listed in the report above, in the
echo   "dist-electron" folder. Installing is a separate, manual step:
echo   double-click the Setup .exe if one was produced, or unzip the
echo   portable archive and run "Rama AGI.exe" from it.
echo.
set /p OPENFOLDER="  Open the dist-electron folder now? (y/n): "
if /i "%OPENFOLDER%"=="y" start "" "dist-electron"
pause
goto MENU

:DIAGNOSE
echo.
call node start.cjs --diagnose
echo.
pause
goto MENU

:END
endlocal
exit /b 0
