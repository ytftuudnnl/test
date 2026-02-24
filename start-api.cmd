@echo off
set ROOT=%~dp0
cd /d "%ROOT%"
set PORT=3100
echo Starting API at http://localhost:%PORT%
where npm.cmd >nul 2>nul
if not %errorlevel%==0 (
  echo ERROR: npm.cmd not found. Install Node.js LTS first.
  pause
  exit /b 1
)
npm.cmd run dev:api
