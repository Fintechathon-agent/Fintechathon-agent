@echo off
setlocal
pushd "%~dp0..\..\.."
if not exist "docs\safety-risk-eval\contracts\node_modules\ajv\package.json" (
  call npm.cmd ci --prefix docs/safety-risk-eval/contracts
  if errorlevel 1 goto failed
)
echo Open http://127.0.0.1:8780/risk/long-text
node modules/safety-risk-eval/server.cjs
if errorlevel 1 goto failed
popd
exit /b 0
:failed
popd
echo Workbench could not start. See the error above.
pause
exit /b 1
