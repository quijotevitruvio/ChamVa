@echo off
chcp 65001 >nul
cd /d "%~dp0"
title ChamVa - Generar licencia

echo ==========================================
echo    ChamVa  -  Generador de licencias
echo ==========================================
echo.

set "NOMBRE="
set /p "NOMBRE=Nombre del cliente / institucion / empresa: "
if "%NOMBRE%"=="" (
  echo.
  echo  ^> Debes escribir un nombre. Cancelado.
  echo.
  pause
  exit /b
)

set "MESES="
set /p "MESES=Meses de validez (Enter = 12): "
if "%MESES%"=="" set "MESES=12"

echo.
echo Generando...
echo.

for /f "usebackq delims=" %%K in (`node tools\sign-license.mjs "%NOMBRE%" %MESES% --raw`) do set "KEY=%%K"

if "%KEY%"=="" (
  echo  ^> ERROR: no se pudo generar la clave.
  echo    Revisa que exista tools\private-key.txt y que Node este instalado.
  echo.
  pause
  exit /b
)

REM Copiar al portapapeles sin salto de linea extra
<nul set /p "=%KEY%" | clip

echo ------------------------------------------
echo  CLAVE para: %NOMBRE%  (%MESES% meses)
echo ------------------------------------------
echo.
echo %KEY%
echo.
echo  ^(La clave ya quedo COPIADA al portapapeles^)
echo  Pegasela al cliente; el la activa en Ajustes ^> Activar.
echo.
pause
