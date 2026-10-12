# Project_all

KISSOS 로컬 실행 정리 문서입니다. 기준 경로는 아래입니다.

```text
<PROJECT_ROOT>
```

전체 구조는 다음과 같습니다.

```text
Redis        : localhost:6380
Backend      : http://localhost:8000
Frontend     : http://localhost:5173
Extension WS : ws://localhost:8000/api/streaming
```

`http://localhost:8000/`에 브라우저로 접속했을 때 404가 뜨는 것은 정상입니다. 백엔드는 화면 서버가 아니라 API/WebSocket 서버입니다. 프론트 화면은 `http://localhost:5173`에서 확인합니다.

## 1. Redis 실행

백엔드는 Redis를 `localhost:6380`으로 사용합니다.

WSL Ubuntu에서 Redis 상태 확인:

```bash
redis-cli -p 6380 ping
```

정상 결과:

```text
PONG
```

Redis가 안 켜져 있으면 WSL에서 실행:

```bash
redis-server --port 6380
```

만약 아래 오류가 나면 이미 6380 포트를 누가 쓰고 있는 상태입니다.

```text
bind: Address already in use
```

확인:

```bash
ss -ltnp | grep 6380
sudo ss -ltnp | grep 6380
redis-cli -p 6380 ping
```

`PONG`이 나오면 Redis가 이미 살아있는 것이므로 다시 켤 필요 없이 다음 단계로 넘어갑니다.

Windows Docker Redis를 끄고 싶으면 Windows PowerShell 또는 WSL에서 다음을 실행합니다.

```powershell
docker stop kissos-redis
```

WSL에서 Windows Docker 명령을 실행할 때:

```bash
powershell.exe -Command "docker ps"
powershell.exe -Command "docker stop kissos-redis"
```

컨테이너 이름 충돌 오류:

```text
Conflict. The container name "/kissos-redis" is already in use
```

이 경우 새로 `docker run` 하지 말고 기존 컨테이너를 시작합니다.

```powershell
docker start kissos-redis
```

## 2. 백엔드 실행

백엔드는 Windows PowerShell/CMD가 아니라 WSL Ubuntu에서 실행하는 것을 기준으로 합니다. 이유는 `vllm`, CUDA, PyTorch CUDA wheel, `nvidia-*` 패키지가 Linux/GPU 환경을 전제로 하기 때문입니다.

백엔드 경로:

```bash
cd <PROJECT_ROOT_WSL>/debug
```

Python 확인:

```bash
python3.12 --version
```

필요 패키지 설치:

```bash
sudo apt update
sudo apt install -y python3.12 python3.12-venv python3.12-dev python3-pip build-essential
```

가상환경은 `/mnt/c` 아래 프로젝트 폴더에 만들지 말고 WSL 홈에 만드는 것을 권장합니다.

```bash
mkdir -p ~/.venvs
python3.12 -m venv ~/.venvs/kissos-debug
source ~/.venvs/kissos-debug/bin/activate
```

pip 확인 및 업그레이드:

```bash
python -m pip --version
python -m pip install --upgrade pip setuptools wheel
```

PyTorch CUDA 12.9 wheel은 기본 PyPI가 아니라 PyTorch 전용 인덱스에 있으므로 반드시 `--extra-index-url`을 붙입니다.

```bash
cd <PROJECT_ROOT_WSL>/debug
pip install --extra-index-url https://download.pytorch.org/whl/cu129 -r requirements.txt
```

`torch==2.10.0+cu129` 관련 오류가 날 때 원인:

```text
ERROR: No matching distribution found for torch==2.10.0+cu129
```

해결:

```bash
pip install --extra-index-url https://download.pytorch.org/whl/cu129 -r requirements.txt
```

`nvidia-cufile-cu12` 관련 오류가 Windows에서 발생하면 Windows 네이티브 설치가 아니라 WSL/Linux에서 설치해야 합니다.

Ray 임시 폴더 생성:

```bash
sudo mkdir -p /data/tmp
sudo chmod 777 /data/tmp
```

백엔드 실행:

```bash
cd <PROJECT_ROOT_WSL>/debug/main
source ~/.venvs/kissos-debug/bin/activate
serve run serve_config.yaml
```

또는 activate 없이:

```bash
~/.venvs/kissos-debug/bin/serve run serve_config.yaml
```

정상 확인:

```bash
ss -ltnp | grep 8000
```

백엔드 로그에 아래처럼 뜨면 서버는 켜져 있는 것입니다.

```text
GET / 404
```

`/` 라우트가 없어서 404가 나는 것이며, 문제가 아닙니다.

## 3. 프론트 실행

프론트 경로:

```bash
cd <PROJECT_ROOT_WSL>/debug/listener-web
```

의존성 설치가 필요하면:

```bash
npm install
```

실행:

```bash
npm run dev -- --host 0.0.0.0
```

브라우저 접속:

```text
http://localhost:5173
```

세션 페이지 예시:

```text
http://localhost:5173/session/test
```

프론트의 `/api` 요청은 `vite.config.ts`에서 백엔드로 프록시됩니다.

```text
/api -> http://localhost:8000
```

## 4. Chrome 확장프로그램 연동

확장프로그램 경로:

```text
<EXTENSION_DIR>
```

Chrome에는 보통 아래 폴더를 로드합니다.

```text
<EXTENSION_DIR>\dist
```

수정된 핵심 파일:

```text
src/constants.ts
public/manifest.json
src/offscreen/index.ts
```

`src/constants.ts`는 원격 서버 설정을 유지하면서 로컬 서버를 사용하도록 구성했습니다.

```ts
export const REMOTE_API_BASE_URL = "http://<SERVER_HOST>";
export const REMOTE_DASHBOARD_URL = "http://<SERVER_HOST>/room/hello/world";
export const REMOTE_WS_STREAM_URL = "ws://<SERVER_HOST>/api/streaming";

export const LOCAL_API_BASE_URL = "http://localhost:8000";
export const LOCAL_DASHBOARD_URL = "http://localhost:5173/room/hello/world";
export const LOCAL_WS_STREAM_URL = "ws://localhost:8000/api/streaming";

const USE_LOCAL_BACKEND = true;

export const API_BASE_URL = USE_LOCAL_BACKEND ? LOCAL_API_BASE_URL : REMOTE_API_BASE_URL;
export const DASHBOARD_URL = USE_LOCAL_BACKEND ? LOCAL_DASHBOARD_URL : REMOTE_DASHBOARD_URL;
export const WS_STREAM_URL = USE_LOCAL_BACKEND ? LOCAL_WS_STREAM_URL : REMOTE_WS_STREAM_URL;
```

`public/manifest.json`의 `host_permissions`는 원격과 로컬을 모두 허용합니다.

```json
"host_permissions": [
  "http://<SERVER_HOST>/*",
  "ws://<SERVER_HOST>/*",
  "http://localhost:8000/*",
  "ws://localhost:8000/*",
  "http://127.0.0.1:8000/*",
  "ws://127.0.0.1:8000/*"
]
```

확장프로그램은 빌드 결과인 `dist`를 Chrome이 읽으므로, 소스를 수정하면 반드시 다시 빌드해야 합니다.

Windows PowerShell/CMD에서:

```powershell
cd "<EXTENSION_DIR>"
npm.cmd run build
```

그 다음 Chrome에서:

```text
chrome://extensions
```

1. 개발자 모드 ON
2. 해당 확장프로그램 새로고침
3. 필요하면 `dist` 폴더를 다시 로드

## 5. 확장프로그램 인증 오류 해결

증상:

```text
Connection: 인증 오류
```

원인 중 하나는 WebSocket 인증 토큰 전달 방식 불일치였습니다.

확장프로그램은 URL에 다음처럼 토큰을 붙입니다.

```text
ws://localhost:8000/api/streaming?access_token=...
```

하지만 현재 백엔드 `routers/stream.py`는 쿼리의 `access_token`을 읽지 않고, 첫 JSON 메시지의 `payload.accessToken`만 읽습니다.

백엔드가 기대하는 형태:

```json
{
  "type": "handshake",
  "payload": {
    "accessToken": "...",
    "languages": ["English", "Korean"],
    "domain": "Default"
  }
}
```

그래서 `src/offscreen/index.ts`의 WebSocket open 이후 handshake payload에 `accessToken`을 추가했습니다.

```ts
socket?.send(JSON.stringify({
  type: "handshake",
  payload: {
    accessToken,
    languages,
    domain,
  },
}));
```

수정 후 반드시 빌드:

```powershell
cd "<EXTENSION_DIR>"
npm.cmd run build
```

그리고 Chrome 확장 새로고침.

여전히 인증 오류가 나면 백엔드 터미널에서 아래 로그를 확인합니다.

```text
Websocket initial/auth connection failed: ...
```

이 로그가 토큰 검증 실패의 실제 원인입니다.

## 6. 실행 순서 요약

터미널 1, Redis:

```bash
redis-cli -p 6380 ping
```

`PONG`이면 이미 실행 중입니다. 아니면:

```bash
redis-server --port 6380
```

터미널 2, 백엔드:

```bash
cd <PROJECT_ROOT_WSL>/debug/main
source ~/.venvs/kissos-debug/bin/activate
serve run serve_config.yaml
```

터미널 3, 프론트:

```bash
cd <PROJECT_ROOT_WSL>/debug/listener-web
npm run dev -- --host 0.0.0.0
```

브라우저:

```text
http://localhost:5173
```

Chrome 확장:

```text
chrome://extensions
로드/새로고침 대상: <EXTENSION_DIR>\dist
```

## 7. 자주 헷갈리는 점

`localhost:8000`은 프론트 화면이 아닙니다. 백엔드 API 서버입니다.

`GET / 404`는 정상일 수 있습니다. 백엔드 루트 라우트가 없기 때문입니다.

확장프로그램을 수정한 뒤에는 `src`만 바뀌고 Chrome이 읽는 `dist`는 안 바뀔 수 있습니다. 반드시 `npm.cmd run build` 후 Chrome 확장 새로고침을 해야 합니다.

Windows에서 `pip install -r requirements.txt`를 하면 CUDA/Linux 패키지 때문에 실패할 수 있습니다. 백엔드는 WSL Ubuntu에서 설치/실행합니다.

PyTorch CUDA `+cu129` 패키지는 기본 PyPI가 아니라 PyTorch 인덱스를 추가해야 설치됩니다.

```bash
pip install --extra-index-url https://download.pytorch.org/whl/cu129 -r requirements.txt
```

## 8. 한 번에 서버 켜기

아래 배치 파일을 만들었습니다.

```text
<WORKSPACE>\start_project_all.bat
```

Windows CMD 또는 PowerShell에서 한 줄로 실행:

```powershell
<WORKSPACE>\start_project_all.bat
```

또는 파일을 더블클릭해도 됩니다.

이 스크립트는 WSL 터미널을 3개 엽니다.

```text
KISSOS Redis    : Redis localhost:6380 확인 또는 실행
KISSOS Backend  : Ray Serve 백엔드 localhost:8000 실행
KISSOS Frontend : Vite 프론트 localhost:5173 실행
```

실행 후 브라우저에서 자동으로 아래 주소를 엽니다.

```text
http://localhost:5173
```

백엔드 터미널에서 `/data/tmp is missing or not writable` 메시지가 나오면 WSL에서 아래 명령을 한 번 실행합니다.

```bash
sudo mkdir -p /data/tmp
sudo chmod 777 /data/tmp
```

백엔드 터미널에서 `venv not found`가 나오면 `~/.venvs/kissos-debug` 가상환경이 아직 없거나 이름이 다른 것입니다. 이 문서의 백엔드 설치 단계를 먼저 완료해야 합니다.
