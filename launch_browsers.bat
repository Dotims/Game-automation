@echo off
echo ==========================================
echo    MargoBot Browser Launcher (Manual)
echo ==========================================
echo.

:: --- KONFIGURACJA ---
set BRAVE_PATH="C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe"
set USER_DATA_DIR="C:\Users\rados\AppData\Local\BraveSoftware\Brave-Browser\User Data"

:: Nazwy profili (sprawdz przez brave://version)
set PROFILE_NAME_1=Default
set PROFILE_NAME_2=Profile 1
:: ---------------------

echo Zamykam istniejace procesy Brave...
taskkill /F /IM brave.exe >nul 2>&1
timeout /t 2 >nul

echo Otwieram Profil 1 (%PROFILE_NAME_1%) na porcie 9222...
start "" %BRAVE_PATH% --remote-debugging-port=9222 --user-data-dir=%USER_DATA_DIR% --profile-directory="%PROFILE_NAME_1%"

echo Czekam 4 sekundy...
timeout /t 4 >nul

echo Otwieram Profil 2 (%PROFILE_NAME_2%) na porcie 9223...
start "" %BRAVE_PATH% --remote-debugging-port=9223 --user-data-dir=%USER_DATA_DIR% --profile-directory="%PROFILE_NAME_2%"

echo.
echo Gotowe! Zaloguj sie w obu oknach i uruchom start_bot.bat.
pause
