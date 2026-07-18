@echo off
echo ============================================================
echo  HR Outreach Tracker — Starting servers
echo ============================================================
echo.
echo [1/2] Starting backend on http://localhost:3001 ...
start "HR-Backend" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 3 /nobreak >nul
echo [2/2] Starting frontend on http://localhost:5173 ...
start "HR-Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"
echo.
echo Both servers starting. Open http://localhost:5173 in your browser.
echo Excel file auto-saved at: backend\data\HR_Outreach_Tracker.xlsx
echo.
pause
