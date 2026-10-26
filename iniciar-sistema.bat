@echo off
title 🏥 Inicio Sistema IVA Mensual - JMV Tax Health Intelligence
color 0A 2>nul
cls

echo ================================================
echo   INSTALADOR Y ARRANQUE AUTOMÁTICO DEL SISTEMA
echo   JMV Tax Health Intelligence v1.0
echo ================================================
echo.

:: ============================
:: PASO 1: Verificar Node.js
:: ============================
echo.
echo [1/7] Verificando Node.js...
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js no está instalado.
    echo Por favor instala Node.js >= 20.0.0 desde https://nodejs.org/
    pause
    exit /b 1
)
echo ✅ Node.js $(node --version) detectado

:: ============================
:: PASO 2: Crear .env si no existe
:: ============================
echo.
echo [2/7] Configurando entorno...
if not exist .env (
    echo Creando archivo .env con configuración por defecto...
    echo PORT=3500 > .env
    echo DB_PATH=./data/iva_mensual.db >> .env
    echo BASIC_AUTH_USER=admin >> .env
    echo BASIC_AUTH_PASS=admin123 >> .env
    echo ✅ .env creado exitosamente
    echo.
    echo ⚠️  Revisa el archivo .env si necesitas cambiar puerto/contraseña
    echo.
) else (
    echo ✅ .env ya existe (usando el existente)
    echo.
)

:: ============================
:: PASO 3: Instalar dependencias
:: ============================
echo.
echo [3/7] Verificando módulos npm...
if not exist node_modules\installing 2>nul (
    echo Iniciando instalación de dependencias npm (primera vez)...
    echo Esto puede tardar 30-90 segundos...
    npm install > "%TEMP%\npm_install.log" 2>&1
    if %errorlevel% eq 0 (
        echo ✅ Módulos npm instalados correctamente
        del node_modules\installing 2>nul
        echo.
    ) else (
        echo ⚠️ Error en la instalación de npm
        echo Revisa: %TEMP%\npm_install.log
        echo.
        echo ¿Continuar de todas formas? (el sistema puede tener funcionalidad limitada)
        set /p respuesta=S
        if not %respuesta%==S (
            echo Instancia cancelada por el usuario.
            pause
            exit /b 1
        )
    )
) else (
    echo ✅ Módulos npm ya instalados
    echo.
)

:: ============================
:: PASO 4: Crear carpetas necesarias
:: ============================
echo.
echo [4/7] Preparando directorios...
mkdir data 2>nul
mkdir frontend\sistema\assets 2>nul
echo ✅ Carpetas listas

:: ============================
:: PASO 5: Verificar estructura del proyecto
:: ============================
echo.
echo [5/7] Verificando estructura del proyecto...
if exist backend\index.js (
    echo ✅ Backend encontrado (backend/index.js)
) else (
    echo ⚠️  Advertencia: No se encuentra backend/index.js
)

if exist frontend\sistema\index.html (
    echo ✅ Frontend encontrado (frontend/sistema/index.html)
) else (
    echo ⚠️  Advertencia: No se encuentra frontend/sistema/index.html
)

echo.

:: ============================
:: PASO 6: Arrancar el servidor
:: ============================
echo.
echo ============================
echo ===  INICIANDO SERVIDOR ===
echo ============================
echo.
echo El servidor se iniciará en http://localhost:3500
echo.
echo Por favor espera mientras se cargan los módulos...
echo.

node backend\index.js

:: Si el servidor falla, mostrar mensaje
if %errorlevel% neq 0 (
    echo.
    echo ❌ El servidor no pudo iniciarse.
    echo Verifica la consola arriba para ver los errores.
    echo Intenta ejecutar: node backend\index.js manualmente
    pause
)