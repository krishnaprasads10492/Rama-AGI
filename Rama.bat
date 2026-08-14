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
echo     2. Build Windows installer  (.exe)
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
echo   Building the Windows installer...
echo   This can take several minutes the first time.
echo.
call npm run build:win
if errorlevel 1 (
    echo.
    echo   Build failed - see the error above.
    echo   Common causes: missing Visual Studio Build Tools ^(for native
    echo   modules^), or no internet connection for the first npm install.
    pause
    goto MENU
)
echo.
echo   ============================================
echo     BUILD COMPLETE
echo   ============================================
echo.
echo   Your installer is in the "dist-electron" folder:
echo     - Rama AGI Setup ^<version^>.exe   ^(installer - run this to install^)
echo     - Rama AGI ^<version^>.exe          ^(portable - runs without installing^)
echo.
echo   Double-click the Setup .exe to actually install Rama on this
echo   machine ^(Program Files, desktop shortcut, Start Menu, uninstaller^).
echo   This script only builds it - installing is a separate, manual step.
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
