@echo off
set ROOT=%~dp0
cd /d "%ROOT%"
start "CBSP API" cmd /k ""%ROOT%start-api.cmd""
start "CBSP Preview" cmd /k ""%ROOT%start-workspace-preview.cmd""
echo Launched:
echo - API: http://localhost:3100/health
echo - UI:  http://localhost:8775/apps/workbench/
echo - Admin: http://localhost:8775/apps/admin/
