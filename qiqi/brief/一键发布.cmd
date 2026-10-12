@echo off
chcp 65001 >nul
cd /d "%~dp0"
setlocal
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

REM ============================================================
REM  Daily Market Brief one-click pipeline
REM  NOTE: keep this file ASCII-only. Chinese text inside a .cmd
REM  is parsed unreliably by cmd.exe; all Chinese messaging is
REM  printed by the Python tools instead.
REM ============================================================

for /f %%i in ('python -c "import datetime;print(datetime.date.today().isoformat())"') do set "TODAY=%%i"
if "%TODAY%"=="" (
    echo [error] Could not resolve today's date via python. Is python on PATH?
    pause
    exit /b 1
)

echo ============================================
echo  Daily Market Brief pipeline  ^|  %TODAY%
echo ============================================
echo.
echo [1/6] Collecting market data...
python collect_market_data.py || goto :err
echo.
echo [2/6] Collecting flagship fund data...
python collect_fund_data.py || goto :err
echo.
echo [3/6] Building drafts...
python make_brief_draft.py || goto :err
echo.
echo [4/6] Building web pages (issue + index + latest + share + PDF)...
python make_brief_page.py || goto :err
echo.
echo [5/6] Building Feishu section + clipboard...
python make_feishu_section.py || goto :err
powershell -NoProfile -ExecutionPolicy Bypass -File push_brief_section.ps1 -Path out/feishu_section_%TODAY%.md
echo.
echo [6/6] Publishing (API auto-skips) + private DB ingest...
python upload_feishu.py --file out/brief_%TODAY%.md --from-heading "### %TODAY%" --webhook-file out/group_%TODAY%.txt
python ingest_to_db.py --date %TODAY%
echo.
echo --------------------------------------------
echo  Outputs:
echo    Issue  %~dp0out\brief_%TODAY%.html
echo    Index  %~dp0out\index.html   (all issues, newest first)
echo    Stable %~dp0out\latest.html  (always the newest issue)
echo    Share  %~dp0out\share\       (paths printed by step 4 above)
echo           .html  = send this one file, double-click opens it
echo           .pdf   = best for phones / WeChat / printing
echo --------------------------------------------
echo.
echo If you saw [skip] above, no Feishu credentials are configured.
echo Open the Feishu doc, scroll to the bottom, click the last empty
echo paragraph and press Ctrl+V (clipboard is already loaded), then
echo confirm "saved to cloud".
echo   https://rcntz7sdyswd.feishu.cn/wiki/LB0Xw98WniMV6okz9HqcGMDCnW7
echo.
echo Reminder: if drafts still contain placeholder markers, fill them in
echo and run this script again. Re-running never overwrites a finished draft.
echo.
start "" "%~dp0out\index.html"
pause
exit /b 0

:err
echo.
echo [error] A step failed. See the message above.
echo Common causes: no network, missing akshare, draft missing module markers.
pause
exit /b 1
