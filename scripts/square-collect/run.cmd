@echo off
cd /d "%~dp0..\.."
npm run collect:square >> "%~dp0collect.log" 2>&1
