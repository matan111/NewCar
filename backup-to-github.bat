@echo off
cd /d "%~dp0"
echo.
echo ==========================================
echo    NewCar - Backup to GitHub
echo ==========================================
echo.

git add -A
if errorlevel 1 goto failed

git diff --cached --quiet
if not errorlevel 1 (
  echo Nothing new to back up - already up to date.
  echo.
  pause
  exit /b 0
)

echo Saving changes...
git commit -m "Backup %date% %time:~0,5%"
if errorlevel 1 goto failed

echo.
echo Sending to GitHub...
git push
if errorlevel 1 goto failed

echo.
echo ==========================================
echo    BACKUP COMPLETE
echo ==========================================
echo.
pause
exit /b 0

:failed
echo.
echo ==========================================
echo    FAILED - copy the error above
echo ==========================================
echo.
pause
exit /b 1