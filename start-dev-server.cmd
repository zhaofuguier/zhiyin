@echo off
cd /d "%~dp0"
call npm.cmd run dev:h5:demo >> "dev-server.log" 2>> "dev-server-error.log"
