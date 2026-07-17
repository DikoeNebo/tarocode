@echo off
setlocal EnableExtensions
cd /d "%~dp0"

where npm >nul 2>&1
if errorlevel 1 (
  echo Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Install failed.
    pause
    exit /b 1
  )
)

REM Unique folder avoids locked app.asar in old dist/dist2
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set "BUILD_DIR=dist_%%t"

echo Building Keycode.exe to %BUILD_DIR% ...
call npx electron-builder --win portable --config.directories.output=%BUILD_DIR%
if errorlevel 1 (
  echo.
  echo Build failed.
  echo Tip: use dev.bat to run without building.
  pause
  exit /b 1
)

if not exist "%BUILD_DIR%\Keycode.exe" (
  echo Keycode.exe not found in %BUILD_DIR%
  pause
  exit /b 1
)

if not exist "dist2" mkdir "dist2"
copy /Y "%BUILD_DIR%\Keycode.exe" "dist2\Keycode.exe" >nul
if not exist "dist" mkdir "dist"
copy /Y "%BUILD_DIR%\Keycode.exe" "dist\Keycode.exe" >nul

echo.
echo Done: dist2\Keycode.exe
echo Full build: %BUILD_DIR%\Keycode.exe
pause
