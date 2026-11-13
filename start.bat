@echo off
REM ==============================================================
REM start.bat - launch the Frontal Lobe app on Relate.
REM
REM Starts TWO processes in separate windows:
REM   1. Backend API  (llm_app.main)  -> http://localhost:8020
REM   2. UI (Vite dev server)         -> http://localhost:5188
REM
REM There is no database server to start. Relate is a library: the
REM backend opens data\graph\ in-process. Nothing listens on 7687.
REM
REM Ports are fixed and never collide with the Memgraph app
REM (API :8010, UI :5178) or the original app (API :8000, UI :5173).
REM
REM After editing a .py file: close the backend window and re-run this.
REM ==============================================================
setlocal
cd /d "%~dp0"

echo.
echo  Frontal Lobe on Relate
echo  Backend: http://localhost:8020    UI: http://localhost:5188
echo.

REM ---- preflight ------------------------------------------------
if not exist ".venv\Scripts\python.exe" (
    echo  [X] No .venv found.
    echo.
    echo      python -m venv .venv
    echo      .venv\Scripts\python.exe -m pip install -r requirements.txt
    echo.
    pause
    exit /b 1
)

if not exist "ui\node_modules" (
    echo  [X] UI dependencies missing.
    echo.
    echo      cd ui ^&^& npm install
    echo.
    pause
    exit /b 1
)

if not exist "data\graph\manifest.json" (
    echo  [!] data\graph is empty - the app will start with a blank map.
    echo      See data\README.md to build or copy a store in.
    echo.
)

REM ---- 1. backend ----------------------------------------------
echo [1/2] Backend on :8020 ...
start "FL Backend (8020)" cmd /k "set PYTHONIOENCODING=utf-8 && .venv\Scripts\python.exe -m llm_app.main"

REM ---- 2. UI ----------------------------------------------------
echo [2/2] UI on :5188 ...
start "FL UI (5188)" cmd /k "cd /d "%~dp0ui" && npm run dev"

echo.
echo  Both windows are starting. Open http://localhost:5188
echo  Close both windows to stop everything.
echo.
endlocal
