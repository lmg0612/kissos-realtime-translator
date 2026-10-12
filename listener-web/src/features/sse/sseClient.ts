import { parseBackendControlMessage, parseBackendMessage } from './eventParser'
import type { SessionEvent } from './eventTypes'

type SSEHandlers = {
  onOpen?: () => void
  onAlive?: () => void
  onEvent?: (event: SessionEvent) => void
  onError?: () => void
  onClose?: () => void
}

/**
 * 세션 SSE 채널에 연결하고 EventSource 인스턴스를 반환한다.
 *
 * 연결 대상: /api/broadcast/{sessionId}
 * 백엔드는 기본 SSE message로 PublishForm을 전송한다.
 *   - type: init | next | done
 *   - payload.transcription: Redis stream item(s)
 *   - payload.translation: Redis stream item(s)
 *
 * 세션 상태는 백엔드의 init payload session-state로 확정한다.
 * 단순 onerror는 EventSource 기본 자동 재연결에 맡긴다.
 */
export function connectSessionSSE(
  sessionId: string,
  handlers: SSEHandlers,
): EventSource {
  const url = `/api/broadcast/${encodeURIComponent(sessionId)}?_=${Date.now()}`
  const source = new EventSource(url)
  let hasOpened = false

  source.onopen = () => {
    hasOpened = true
    handlers.onOpen?.()
  }

  source.onmessage = (event: MessageEvent) => {
    const control = parseBackendControlMessage(event.data)
    if (control?.sessionState === 'dead') {
      source.close()
      handlers.onClose?.()
      return
    }
    if (control?.sessionState === 'alive') {
      handlers.onAlive?.()
    }
    if (control?.type === 'done') {
      source.close()
      handlers.onEvent?.({ kind: 'session_done', detail: control.detail })
      return
    }

    const parsedEvents = parseBackendMessage(event.data)
    if (parsedEvents.length === 0) {
      if (!control) console.warn('[SSE] parse failed for backend message', event.data)
      return
    }

    for (const parsed of parsedEvents) {
      handlers.onEvent?.(parsed)
    }
  }

  source.onerror = () => {
    handlers.onError?.()
    // 세션 없음은 백엔드의 session-state: dead 메시지로만 확정한다.
    // 네트워크/프록시/서버 재시작 중 onerror가 먼저 올 수 있으므로 EventSource의
    // 기본 자동 재연결을 막지 않는다.
    if (!hasOpened) return
  }

  return source
}
