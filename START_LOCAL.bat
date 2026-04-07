@echo off
setlocal
chcp 65001 >nul 2>&1
echo.
echo  Local Comet ^— downloading bootstrap script...
echo.
powershell -ExecutionPolicy Bypass -Command ^
  "iwr https://raw.githubusercontent.com/fdf52400-arch/local-comet/master/bootstrap-local-comet.ps1 -OutFile $env:USERPROFILE\bootstrap-local-comet.ps1; powershell -ExecutionPolicy Bypass -File $env:USERPROFILE\bootstrap-local-comet.ps1"
endlocal
