#26-05-13에 수정 및 마지막 내용
앞으로 debug/main/ 하위 백엔드 코드는 절대 건드리지 않겠습니다. 프론트엔드나 mock 서버처럼 백엔드 수정이 필요한 상황이 생기면, 직접 수정하지 않고 어떤 변경이 필요한지 알려드리겠습니다.

그러면 원래 질문으로 돌아와서 — checkSessionExists()가 항상 true를 반환하는 문제는 백엔드에 PIN 조회 엔드포인트가 없어서 발생한 거긴 한데, 백엔드를 건들 수 없다면 현재 구조(항상 true → 세션 페이지 이동 → SSE onClose에서 not_found 처리)가 가능한 유일한 방법입니다. "세션에 참가될 수 없음" 메시지를 EntrancePage에서 보여주려면 백엔드에 조회 엔드포인트가 필요한데, 이 부분을 어떻게 처리할지 알려주시면 그에 맞게 진행하겠습니다.


# listener-web 백엔드 연동 변경사항

날짜: 2026-05-12  
작업 범위: `kissos/debug/listener-web/src/` 내부 파일만 수정

---

## 배경

listener-web은 청취자(Listener)용 React 프론트엔드로,  
발화자가 WebSocket으로 오디오를 전송하면  
백엔드가 전사(Whisper) → 번역(Qwen)을 처리하고  
SSE(Server-Sent Events)로 결과를 청취자에게 전달하는 구조다.

수정 전에는 프론트가 임의의 데모 데이터와 잘못된 API 주소로 동작하고 있었다.  
이번 작업에서 **데모 데이터를 전부 제거**하고 **실제 백엔드 API와 연동**되도록 수정했다.

---

## 백엔드 API 구조 (참고)

| 엔드포인트 | 방식 | 설명 |
|---|---|---|
| `/api/broadcast/{session_id}` | SSE | 청취자가 구독하는 실시간 스트림 |
| `/api/streaming` | WebSocket | 발화자 전용 (listener-web 미사용) |
| `/api/auth/providers` | GET | OAuth 제공자 목록 |
| `/api/auth/exchange` | POST | OAuth 코드 교환 |

### SSE 이벤트 포맷 (PubSubForm)

백엔드는 named SSE 이벤트 3종을 전송한다:

```
event: transcription
data: {"type":"transcription","number":0,"language":"Korean","content":"현재 전사 텍스트"}

event: translation
data: {"type":"translation","number":0,"language":["Korean","English"],"content":{"Korean":"...","English":"..."}}

event: message_batch
data: [{"number":"0","language":"Korean","text":"확정된 전사"},...]
```

- `transcription`: 발화 중 실시간 업데이트. `number`가 이전과 달라지면 이전 utterance 확정.
- `translation`: utterance 확정 후 번역 결과. 항상 히스토리로 저장.
- `message_batch`: 접속 시 Redis Stream에 저장된 과거 전사 기록 일괄 전송.

---

## 수정된 파일 목록

### 1. `features/sse/eventTypes.ts` — 이벤트 타입 전면 교체

**변경 전**: `InitEvent`, `TranscriptEvent`, `TranslationEvent` (isFinal 기반)  
**변경 후**: `TranscriptionEvent`, `TranslationEvent`, `MessageBatchEvent` (백엔드 PubSubForm 기반)

- `InitEvent` 제거 (백엔드에서 init 이벤트를 전송하지 않음)
- `TranscriptionEvent`: `{ kind, number, language, content }` 구조
- `TranslationEvent`: `{ kind, number, languages, translations }` 구조
- `MessageBatchEvent`: `{ kind, items: [{number, language, text}] }` 구조
- `isFinal` 필드 제거 — `number` 값의 변화로 utterance 완료 여부를 판단

---

### 2. `features/sse/eventParser.ts` — 파서 전면 재작성

**변경 전**: 단일 `parseSessionEvent(raw)` 함수, flat/nested 구조 모두 허용하는 방어적 파싱  
**변경 후**: named event별 전용 파서 3개 + 분기 함수

- `parseTranscriptionEvent(raw)`: PubSubForm transcription 파싱
- `parseTranslationEvent(raw)`: PubSubForm translation 파싱
- `parseMessageBatchEvent(raw)`: Redis Stream 배열 파싱
- `parseSessionEvent(eventName, raw)`: eventName으로 분기하는 진입점

---

### 3. `features/sse/sseClient.ts` — SSE 연결 방식 수정

**변경 전**:
```typescript
const url = `/api/channel/${sessionId}`   // 잘못된 URL
source.onmessage = (event) => { ... }     // default event만 수신
```

**변경 후**:
```typescript
const url = `/api/broadcast/${sessionId}`  // 실제 백엔드 엔드포인트
source.addEventListener('transcription', ...) // named event 수신
source.addEventListener('translation', ...)
source.addEventListener('message_batch', ...)
```

- `onClose` 콜백 추가: SSE가 즉시 닫히면(세션 없음) 호출됨
- `SSEHandlers` 타입에 `onClose?: () => void` 추가

---

### 4. `features/session-state/reducer.ts` — 상태 처리 로직 수정

**변경 전**: `init/transcript/translation` 이벤트, `isFinal` 기반 로직  
**변경 후**: `transcription/translation/message_batch` 이벤트, `number` 기반 로직

주요 변경:

- `ConnectionStatus`에 `'not_found'` 추가 (세션 없음 상태)
- `SessionState`에 `transcriptCurrentNumber: number | null` 추가
- `transcription` 처리: `number`가 이전과 다르면 현재 current를 history로 확정 후 교체
- `translation` 처리: 항상 `translationHistory`에 추가, 언어 목록 자동 갱신
- `message_batch` 처리: 과거 전사 기록 일괄 로드 (이미 로드된 경우 무시)
- `init` 이벤트 분기 제거

---

### 5. `features/session-check/api.ts` — mock 완전 제거

**변경 전**:
```typescript
await new Promise((res) => setTimeout(res, 500))  // 500ms mock 지연
if (sessionId === '1234' || sessionId === 'demo') return true
return false
```

**변경 후**:
```typescript
return true  // 항상 이동, 세션 없으면 SSE onClose에서 처리
```

백엔드에 전용 세션 조회 엔드포인트가 없으므로,  
세션 존재 여부는 SSE 연결 결과로 판단한다.  
세션이 없으면 백엔드가 스트림을 즉시 닫고 `onClose`가 호출되어  
`connectionStatus`가 `'not_found'`로 설정된다.

---

### 6. `pages/session/SessionPage.tsx` — not_found 상태 UI 추가

- `connectSessionSSE`에 `onClose` 콜백 추가
- `onClose` 시 `dispatch({ type: 'connection/setStatus', payload: 'not_found' })`
- `connectionStatus === 'not_found'`일 때 "존재하지 않는 세션입니다" 화면 + 돌아가기 버튼 렌더링

---

### 7. `pages/session/WideSessionView.tsx` — 데모 데이터 전부 제거

제거된 항목:
- `buildDemoCardsByLanguage()` 함수 (영/한/일/중/스/불/독/베/아/포 10개 언어 샘플 데이터)
- `demoTranscriptCards` useMemo
- `demoCardsByLanguage` useMemo
- `hasServerTranscriptData` / `hasServerTranslationData` 조건 분기
- `translationCardsByLanguage`의 demo fallback (`demoCardsByLanguage[language] ?? demoCardsByLanguage.English`)

변경 후:
- 서버 데이터가 없으면 "대기 중..." 텍스트를 표시
- `transcriptCards` / `translationCardsByLanguage` 모두 실서버 데이터만 사용

---

### 8. `pages/session/MobileSessionView.tsx` — 데모 데이터 제거 + 타입 단순화

제거된 항목:
- `DEMO_TRANSCRIPTS` 상수 (5개 샘플 전사)
- `DEMO_TRANSLATIONS_BY_LANGUAGE` 상수 (10개 언어 샘플 번역)
- `buildDemoChatBlocks()` 함수
- `visibleChatBlocks`의 demo fallback

타입 단순화:
- `transcriptHistory: Array<string | {id?, transcript?, text?, ...}>` → `string[]`
- `translationCurrent: string | Record<string, string> | null | undefined` → `Record<string, string>`
- `translationHistory: Array<{...}> | Record<string, Array<...>> | null | undefined` → `Array<SessionHistoryItem>`
- `readTranscriptText`, `readTranscriptId`, `readTranscriptFinal`, `getHistoryTranslation` 헬퍼 제거

---

### 9. `features/session-state/selectors.ts` — 타입 갱신

- `SessionHistoryItem` 타입 변경에 따른 타입 참조 갱신 (로직 변경 없음)

---

## 데이터 흐름 (변경 후)

```
청취자 브라우저
  └─ EntrancePage: PIN 입력 → /session/:id 이동
  └─ SessionPage
       └─ connectSessionSSE("/api/broadcast/:id")
            ├─ event: message_batch → 과거 전사 history 로드
            ├─ event: transcription → transcriptCurrent 업데이트
            │    (number 변화 감지 시 이전 current를 history로 확정)
            └─ event: translation  → translationHistory 추가 + 언어 목록 갱신
```

---

## 세션 없음 처리 흐름

```
EntrancePage: checkSessionExists() → 항상 true → /session/:id 이동
SessionPage: SSE 연결 시도
  ├─ 세션 있음: onOpen → connected, 이벤트 수신 시작
  └─ 세션 없음: 백엔드가 스트림 즉시 종료 → onerror + readyState=CLOSED
                 → onClose → connectionStatus='not_found'
                 → "존재하지 않는 세션입니다" UI + 돌아가기 버튼
```

---

## 변경하지 않은 파일

| 파일 | 이유 |
|---|---|
| `vite.config.ts` | `/api` → `localhost:8000` 프록시 이미 설정됨 |
| `shared/config/supportedLanguages.ts` | 정적 언어 목록, 변경 불필요 |
| `shared/hooks/useResponsive.ts` | 반응형 훅, 변경 불필요 |
| `features/session-state/store.ts` | useReducer 래퍼, 변경 불필요 |
| `components/` | UI 컴포넌트 (Toast, SessionEntryForm), 변경 불필요 |
| `app/router.tsx` | 라우팅 구조 변경 없음 |
