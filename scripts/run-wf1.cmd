@echo off
REM سوّي — تشغيل بنك الأفكار من Task Scheduler
REM يتأكد أن Docker وn8n يعملان، ثم يشغّل السكربت ويسجّل في logs\wf1-YYYY-MM-DD.log

setlocal
set "HERE=%~dp0"
set "LOGDIR=%HERE%logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%"
for /f %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "STAMP=%%d"
set "LOG=%LOGDIR%\wf1-%STAMP%.log"

echo. >> "%LOG%"
echo ======== %date% %time% ======== >> "%LOG%"

powershell -NoProfile -ExecutionPolicy Bypass -File "%HERE%ensure-n8n.ps1" >> "%LOG%" 2>&1
if errorlevel 1 (
  echo n8n غير متاح — أُلغي التشغيل. النافذة 7 أيام تلتقط ما فات في المرة القادمة. >> "%LOG%"
  echo EXIT=2 >> "%LOG%"
  exit /b 2
)

"C:\Program Files\nodejs\node.exe" "%HERE%wf1-ideas.mjs" --days 7 >> "%LOG%" 2>&1
echo EXIT=%ERRORLEVEL% >> "%LOG%"
endlocal
