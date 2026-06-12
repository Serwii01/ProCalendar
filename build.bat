@echo off
REM ============================================================
REM  Pro Calendar - build completo con un clic
REM  Genera el instalador en desktop\release\
REM  Requisitos: JDK 21, Maven y Node 18+ en el PATH
REM ============================================================
setlocal

echo.
echo ===== Comprobando requisitos =====

where java >nul 2>nul || (echo [ERROR] Java no esta en el PATH. Instala JDK 21. & goto :fail)
where mvn  >nul 2>nul || (echo [ERROR] Maven no esta en el PATH. & goto :fail)
where node >nul 2>nul || (echo [ERROR] Node.js no esta en el PATH. & goto :fail)
where npm  >nul 2>nul || (echo [ERROR] npm no esta en el PATH. & goto :fail)

java -version 2>&1 | findstr /C:"21" >nul || echo [AVISO] No se detecta Java 21; el backend requiere JDK 21.

echo OK
echo.
echo ===== Instalando dependencias de Electron (si faltan) =====
cd /d "%~dp0desktop"
if not exist node_modules call npm install || goto :fail

echo.
echo ===== Limpieza + build standalone (JRE embebido) =====
powershell -ExecutionPolicy Bypass -File "%~dp0desktop\scripts\clean-and-build.ps1"
if errorlevel 1 goto :fail

echo.
echo ============================================================
echo  LISTO. Instalador en: %~dp0desktop\release\
echo    - ProCalendar-Setup-1.0.0.exe     (instalador)
echo    - ProCalendar-Portable-1.0.0.exe  (portable)
echo ============================================================
pause
exit /b 0

:fail
echo.
echo ===== EL BUILD HA FALLADO - revisa los mensajes de arriba =====
pause
exit /b 1
