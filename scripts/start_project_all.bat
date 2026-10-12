@echo off
setlocal

set "PROJECT_WSL=<PROJECT_ROOT_WSL>/debug"
set "BACKEND_WSL=<PROJECT_ROOT_WSL>/debug/main copy"
set "FRONTEND_WSL=<PROJECT_ROOT_WSL>/debug/listener-web"
set "VENV_WSL=$HOME/.venvs/kissos-debug"

where wsl.exe >nul 2>nul
if errorlevel 1 (
  echo [KISSOS] wsl.exe was not found. Install WSL Ubuntu first.
  pause
  exit /b 1
)

echo [KISSOS] Starting Redis, backend, and frontend in WSL terminals...

start "KISSOS Redis" wsl.exe -- bash -lc "cd '%PROJECT_WSL%' || exit 1; if redis-cli -p 6380 ping >/dev/null 2>&1; then echo '[Redis] already running on localhost:6380'; echo '[Redis] You can keep this window open or close it if Redis is managed elsewhere.'; exec bash; else echo '[Redis] starting on localhost:6380'; redis-server --port 6380; fi"

start "KISSOS Backend" wsl.exe -- bash -lc "cd '%BACKEND_WSL%' || exit 1; echo '[Backend] waiting for Redis localhost:6380...'; until redis-cli -p 6380 ping >/dev/null 2>&1; do sleep 1; done; if [ ! -w /data/tmp ]; then echo '[Backend] /data/tmp is missing or not writable.'; echo '[Backend] Run this once in WSL:'; echo 'sudo mkdir -p /data/tmp && sudo chmod 777 /data/tmp'; exec bash; fi; if [ ! -f ~/.venvs/kissos-debug/bin/activate ]; then echo '[Backend] venv not found: ~/.venvs/kissos-debug'; echo '[Backend] Check Project_all.md setup steps.'; exec bash; fi; source ~/.venvs/kissos-debug/bin/activate; echo '[Backend] starting Ray Serve on http://localhost:8000'; serve run serve_config.yaml; exec bash"

start "KISSOS Frontend" wsl.exe -- bash -lc "cd '%FRONTEND_WSL%' || exit 1; if [ ! -d node_modules ]; then echo '[Frontend] node_modules missing. Running npm install...'; npm install; fi; echo '[Frontend] starting Vite on http://localhost:5173'; npm run dev -- --host 0.0.0.0; exec bash"

echo [KISSOS] Windows opened. Browser will open shortly.
timeout /t 8 /nobreak >nul
start "" "http://localhost:5173"

echo [KISSOS] Done. Keep the Redis/backend/frontend terminal windows open while testing.
endlocal
