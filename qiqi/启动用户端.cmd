@echo off
chcp 65001 >nul
REM ASCII-only launcher. Chinese output is printed by web/launch.py,
REM because cmd.exe mis-parses UTF-8 batch files on Chinese Windows.
REM
REM Python resolution order: env PYTHON, then the py launcher, then PATH.
REM (A hard-coded interpreter path would only work on the author's machine.)

if defined PYTHON (
  set "PY=%PYTHON%"
  goto :run
)

where py >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PY=py -3"
  goto :run
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
  set "PY=python"
  goto :run
)

echo [ERROR] Python 3 not found. Install Python 3.10+ or set PYTHON env var.
pause
exit /b 1

:run
%PY% "%~dp0web\launch.py" %*
