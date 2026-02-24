@echo off
set ROOT=%~dp0
cd /d "%ROOT%"
set PORT=3100
set DATA_DRIVER=mongo
if "%MONGODB_URI%"=="" set MONGODB_URI=mongodb://127.0.0.1:27017
if "%MONGODB_DB%"=="" set MONGODB_DB=cbsp
echo Starting API with Mongo at http://localhost:%PORT%
echo MONGODB_URI=%MONGODB_URI%
npm.cmd run dev:api
