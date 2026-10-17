@echo off
chcp 65001 >nul
REM ASCII-only launcher. Chinese output is printed by web/launch.py,
REM because cmd.exe mis-parses UTF-8 batch files on Chinese Windows.
set "PY=C:\Users\qiqi\AppData\Local\Programs\Python\Python310\python.exe"
if not exist "%PY%" (
  echo [ERROR] Python not found: %PY%
  pause
  exit /b 1
)
"%PY%" "%~dp0web\launch.py" %*
