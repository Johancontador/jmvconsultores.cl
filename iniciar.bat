@echo off
setlocal

cd /d "%~dp0"

echo ============================================
echo   IVA Mensual - iniciando servidor local
echo ============================================
echo.

if not exist node_modules (
  echo Instalando dependencias por primera vez...
  call npm install
  if errorlevel 1 (
    echo.
    echo ERROR: npm install fallo. Revisa el mensaje de arriba.
    pause
    exit /b 1
  )
)

if not exist .env (
  if exist .env.example (
    echo No existe .env, copiando desde .env.example...
    copy .env.example .env >nul
  )
)

echo Abriendo el navegador en unos segundos...
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3500"

echo Iniciando servidor (deja esta ventana abierta)...
echo.
call npm start

echo.
echo El servidor se detuvo.
pause
