@echo off
chcp 65001 >nul
title NewCar Server
cd /d "%~dp0"
echo.
echo ===================================
echo    NewCar - מפעיל את השרת...
echo ===================================
echo.
echo אחרי שהשרת יעלה, פתח בדפדפן:
echo http://localhost:3001/car-reception.html
echo.
echo הדפדפן יבקש שם משתמש וסיסמה (פעם אחת לכל דפדפן) - הפרטים נמצאים בקובץ .env
echo.
echo אל תסגור את החלון הזה כל עוד אתה רוצה שהמערכת תעבוד.
echo לעצירת השרת - פשוט סגור את החלון.
echo.
node server.js
pause
