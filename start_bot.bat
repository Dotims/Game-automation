@echo off
echo ==========================================
echo    MargoBot Multi-Profile Launcher
echo ==========================================

echo Sprawdzanie pm2...
call npm list -g pm2 >nul 2>&1
if %errorlevel% neq 0 (
    echo PM2 nie jest zainstalowany. Instaluje...
    call npm install pm2 -g
)

echo.
echo Uruchamianie Bot_Friz (Port 9222)...
call pm2 start ecosystem.config.js --only Bot_Friz

echo Czekam 5 sekund...
timeout /t 5 >nul

echo Uruchamianie Bot_Czarek (Port 9222)...
call pm2 start ecosystem.config.js --only Bot_Czarek

echo.
echo Boty uruchomione! Otwieram panel podgladu (Dashboard)...
echo Aby wyjsc z podgladu wcisnij 'q'. Boty beda dzialac w tle.
echo.
timeout /t 2 >nul
call pm2 monit
