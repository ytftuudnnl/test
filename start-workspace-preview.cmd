@echo off
set ROOT=%~dp0
cd /d "%ROOT%"
echo Static workspace preview at http://localhost:8775/apps/workbench/
where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m http.server 8775
  goto :eof
)
where python >nul 2>nul
if %errorlevel%==0 (
  python -m http.server 8775
  goto :eof
)
echo.
echo ERROR: Python not found in PATH.
echo Install Python or run this manually:
echo   C:\Users\xds\AppData\Local\Programs\Python\Python313\python.exe -m http.server 8775
pause
