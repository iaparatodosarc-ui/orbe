@echo off
chcp 65001 >nul
title Orbe Motion - Instalador
cd /d "%~dp0"

set "PY="
for %%V in (313 312 311 310) do (
  if not defined PY if exist "%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python%%V\python.exe"
)
if not defined PY (
  py -3 --version >nul 2>nul && set "PY=py -3"
)
if not defined PY (
  python -c "import sys" >nul 2>nul && set "PY=python"
)

if not defined PY (
  echo Instalando Python 3.11 con winget. Si pide permiso, acepta...
  winget install -e --id Python.Python.3.11 --scope user --silent --accept-package-agreements --accept-source-agreements
  if exist "%LOCALAPPDATA%\Programs\Python\Python311\python.exe" set "PY=%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
)

if not defined PY (
  echo.
  echo No pude instalar Python automaticamente.
  echo Instalalo desde https://www.python.org/downloads/ marcando "Add Python to PATH"
  pause
  exit /b
)

echo Usando Python: %PY%

if not exist ".venv\Scripts\python.exe" (
  echo Preparando Orbe Motion por primera vez. Esto tarda unos minutos...
  %PY% -m venv .venv
)
".venv\Scripts\python.exe" -c "import mediapipe, cv2, pyautogui" >nul 2>nul
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install --upgrade pip
  ".venv\Scripts\python.exe" -m pip install -r requirements.txt
)

echo.
echo Abriendo Orbe Motion...
".venv\Scripts\python.exe" orbe_motion.py
pause
