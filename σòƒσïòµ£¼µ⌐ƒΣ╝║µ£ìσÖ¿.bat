@echo off
cd /d "%~dp0"
start "" http://localhost:8000/index.html
where py >nul 2>nul && py -m http.server 8000 && exit /b
where python >nul 2>nul && python -m http.server 8000 && exit /b
echo 找不到 Python。雲端登入需要 HTTPS 網址或 localhost，請安裝 Python 或部署到靜態網站。
pause
