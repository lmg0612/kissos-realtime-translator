# KISSOS — 실시간 다국어 자동 번역 시스템

> 2026-1학기 팀 프로젝트 · 발화자의 음성을 실시간으로 전사(ASR)하고 여러 언어로 번역해 청취자에게 스트리밍하는 시스템

## 개요
강의·발표처럼 한 명이 말하고 여러 명이 듣는 상황에서, 발화자의 음성을 **Whisper**로 실시간 전사하고 **vLLM**으로 서빙하는 번역 모델로 다국어 번역해 청취자 웹 화면에 **SSE**로 전달합니다. 발화자는 Chrome 확장 프로그램으로 마이크 오디오를 보내고, 청취자는 세션 코드로 웹 페이지에 들어와 원하는 언어로 자막을 봅니다.

## 아키텍처
```
[Chrome 확장 (발화자)]  --WebSocket /api/streaming-->  [Ray Serve IngressServer (FastAPI)]
   VAD로 발화 구간 검출                                      ├─ DeployWhisper   (whisper-large-v3-turbo, vLLM)
                                                            ├─ DeployMiLMMT    (MiLMMT-46-12B AWQ, vLLM)
                                                            └─ Redis (세션·스트림 저장)
[listener-web (청취자)]  <--SSE /api/broadcast/{session}--┘
```
- **Backend** `app/` — FastAPI + Ray Serve, Whisper 점진 디코딩(`custom/gradual_whisper.py`), 번역 배포(`deployment/translator.py`), Google OAuth + JWT 인증(`auth/oauth.py`), Redis/SQLite 관리
- **Extension** `extension/` — Chrome MV3 확장, offscreen 문서에서 오디오 캡처·VAD, React 팝업 UI(언어 선택·마이크 선택)
- **Listener Web** `listener-web/` — React + Vite, SSE 이벤트(`transcription` / `translation` / `message_batch`) 파싱 및 반응형 자막 화면
- **Tests** `tests/` — 전사·번역 지연 측정 실험 스크립트와 결과 JSON

## 기술 스택
Python 3.12 · FastAPI · Ray Serve · vLLM · Whisper · Redis · SQLite · TypeScript · React · Vite · Chrome Extension(MV3) · WSL2/CUDA

## 내 역할
- 청취자 웹(listener-web)의 실제 백엔드 연동: 데모 데이터 제거, SSE 이벤트 타입·파서·상태 리듀서 재작성 → [`docs/CHANGES.md`](docs/CHANGES.md)
- Chrome 확장 ↔ 백엔드 연동 점검 및 정리 → [`docs/BACKEND_INTEGRATION.md`](docs/BACKEND_INTEGRATION.md)
- 로컬 전체 실행 환경(WSL Redis·Ray Serve·Vite·확장) 구성 및 트러블슈팅 문서화 → [`docs/Project_all.md`](docs/Project_all.md)

## 실행
자세한 내용은 [`docs/Project_all.md`](docs/Project_all.md)를 참고하세요.
```bash
# 1) Redis
redis-server --port 6380
# 2) Backend (WSL, GPU)
cp .env.example .env   # 값 채우기
cd app && serve run serve_config.yaml
# 3) Listener web
cd listener-web && npm install && npm run dev -- --host 0.0.0.0
# 4) Extension
cd extension && npm install && npm run build   # dist/ 를 Chrome에 로드
```

## 참고
- 팀 프로젝트로, 이 레포는 개인 포트폴리오용 정리본입니다.
- 모델 가중치, 녹음 파일, 비밀키(`.env`)는 포함하지 않았습니다. 서버 주소는 `<SERVER_HOST>`로 가렸습니다.
