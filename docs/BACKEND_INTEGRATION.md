# 백엔드 연동 현황 및 남은 작업

날짜: 2026-05-14  
대상 프로젝트: `kissos/`

---

## 전체 데이터 흐름

```
[발화자 Chrome Extension]
    → WebSocket  /api/streaming        (오디오 스트리밍)
    → 백엔드: Whisper 전사 → Qwen 번역 → Redis Pub/Sub + Stream
    → SSE        /api/broadcast/{pin}
    → [청취자 listener-web]
```

---

## 완료된 작업 (2026-05-12 기준)

### listener-web (청취자 프론트)

| 파일 | 변경 내용 |
|---|---|
| `features/sse/sseClient.ts` | URL `/api/channel/...` → `/api/broadcast/{sessionId}`, named event 수신으로 전환 |
| `features/sse/eventTypes.ts` | `InitEvent` 제거, `TranscriptionEvent` / `TranslationEvent` / `MessageBatchEvent` 로 교체 |
| `features/sse/eventParser.ts` | 단일 파서 → named event별 전용 파서 3개 + 분기 함수 |
| `features/session-state/reducer.ts` | `isFinal` 기반 → `number` 변화 기반 발화 확정, `not_found` 상태 추가 |
| `features/session-check/api.ts` | mock 제거 → 항상 `true` (세션 없으면 SSE onClose에서 처리) |
| `pages/session/SessionPage.tsx` | `onClose` 콜백 추가, `not_found` 시 "존재하지 않는 세션" UI 렌더링 |
| `pages/session/WideSessionView.tsx` | demo 데이터 전면 제거, 서버 데이터 없으면 "대기 중..." 표시 |
| `pages/session/MobileSessionView.tsx` | demo 상수/함수 제거, 타입 단순화 |
| `features/session-state/selectors.ts` | `SessionHistoryItem` 타입 참조 갱신 |

### extension (발화자)

| 항목 | 상태 |
|---|---|
| WebSocket 연결 `ws://<SERVER_HOST>/api/streaming?access_token={token}` | 구현 완료 |
| 핸드쉐이크 `{ type: "handshake", payload: { languages, domain } }` | 구현 완료 |
| 세션 PIN 수신 `{ type: "session", payload: { pin, sessionId, broadcastUrl } }` | 구현 완료 |
| 오디오 바이너리 스트리밍 (`[isLong, isEnded]` 헤더 포함) | 구현 완료 |
| OAuth2 PKCE 인증 + dev 모드 (`/api/auth/dev-session`) | 구현 완료 |
| 지수 백오프 재연결 (최대 30초) | 구현 완료 |

---

## 남은 작업

### 1. [높음] PIN 조회 엔드포인트 없음

**현재 상태**  
`checkSessionExists()`가 항상 `true`를 반환한다.  
백엔드에 PIN 유효성 확인 전용 엔드포인트가 없기 때문이다.

**영향**  
잘못된 PIN을 입력해도 입장 페이지에서 즉시 오류를 보여줄 수 없다.  
`/session/:id`까지 이동 후 SSE `onClose`가 트리거되어야 `not_found` 상태가 된다.

**백엔드에 필요한 것**  
```
GET /api/sessions/{pin}/exists  →  200 { exists: true } or 404
```
또는 기존 `/api/broadcast/{pin}` 연결 전에 HEAD 요청으로 확인하는 방식도 가능.

**관련 파일**
- `kissos/debug/main/routers/` — 신규 라우터 추가 필요
- `kissos/debug/listener-web/src/features/session-check/api.ts` — 엔드포인트 추가 후 수정

---

### 2. [중간] Extension → 백엔드 실제 동작 검증

**관련 파일**: `kissos/extension/src/offscreen/index.ts`

| 확인 항목 | 내용 |
|---|---|
| 핸드쉐이크 응답 형식 | 백엔드가 `{ type: "session", payload: { pin, sessionId, broadcastUrl } }` 올바르게 반환하는지 |
| 오디오 포맷 일치 여부 | Float32Array 바이너리 전송 포맷이 `stream.py` 파서와 일치하는지 |
| 토큰 만료 처리 | 30초 버퍼 갱신 로직이 실제 토큰 수명과 맞는지 |
| dev 모드 엔드포인트 | `/api/auth/dev-session` 백엔드에 실제로 존재하는지 |

---

### 3. [중간] OAuth 설정 검증

**관련 파일**: `kissos/extension/src/auth.ts`, `kissos/debug/main/auth/oauth.py`, `kissos/debug/.env`

| 확인 항목 | 내용 |
|---|---|
| `/api/auth/providers` | Google OAuth 설정값 정상 반환 여부 |
| `/api/auth/exchange` | 코드 교환 후 access token 반환 여부 |
| `.env` | Google OAuth client ID / secret 설정 여부 |

---

### 4. [낮음] Nginx SSE / WebSocket 헤더 확인

**관련 파일**: `kissos/nginx/nginx.conf`

SSE는 Nginx 버퍼링이 켜져 있으면 이벤트가 뭉쳐 도착하므로 반드시 확인 필요.

```nginx
# SSE 버퍼링 비활성화 (필수)
location /api/broadcast/ {
    proxy_pass http://localhost:8000;
    proxy_buffering off;
    proxy_cache off;
    add_header X-Accel-Buffering no;
}

# WebSocket 업그레이드 헤더 (필수)
location /api/streaming {
    proxy_pass http://localhost:8000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
}
```

---

### 5. [낮음] listener-web vite proxy URL 확인

**관련 파일**: `kissos/debug/listener-web/vite.config.ts`

CHANGES.md 기준으로 `/api` → `localhost:8000` 프록시가 이미 설정되어 있다고 기재됨.  
실제 서버 주소(`<SERVER_HOST>:8000`)와 개발 환경 주소가 일치하는지 확인.

---

## 우선순위 요약

| 우선순위 | 항목 | 담당 |
|---|---|---|
| 높음 | 백엔드 PIN 조회 엔드포인트 추가 | 백엔드 담당자에게 요청 |
| 중간 | Extension WS 핸드쉐이크 실 동작 테스트 | extension 개발자 |
| 중간 | OAuth dev 모드 / 프로덕션 동작 확인 | extension + 백엔드 |
| 낮음 | Nginx SSE/WS 헤더 설정 확인 | 인프라 |
| 낮음 | vite proxy URL 확인 | listener-web 개발자 |

---

## 참고: 백엔드 API 목록

| 엔드포인트 | 방식 | 설명 |
|---|---|---|
| `/api/broadcast/{session_id}` | SSE | 청취자 실시간 스트림 구독 |
| `/api/streaming` | WebSocket | 발화자 오디오 스트리밍 |
| `/api/auth/providers` | GET | OAuth 제공자 목록 |
| `/api/auth/exchange` | POST | OAuth 코드 교환 |
| `/api/auth/dev-session` | POST | 개발용 임시 세션 발급 |
| ~~`/api/sessions/{pin}/exists`~~ | GET | **(미구현) PIN 조회** |

---

## 참고: SSE 이벤트 포맷 (PubSubForm)

```
event: transcription
data: {"type":"transcription","number":0,"language":"Korean","content":"현재 전사 텍스트"}

event: translation
data: {"type":"translation","number":0,"language":["Korean","English"],"content":{"Korean":"...","English":"..."}}

event: message_batch
data: [{"number":"0","language":"Korean","text":"확정된 전사"},...]
```
