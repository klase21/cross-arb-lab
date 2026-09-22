@echo off
cd /d "%~dp0..\.."
npm run collect:tv >> "%~dp0collect.log" 2>&1
