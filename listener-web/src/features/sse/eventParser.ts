import type { SessionEvent, TranscriptionEvent, TranslationEvent } from './eventTypes'

export type BackendControlMessage = {
  type: string
  sessionState?: string
  detail?: string
  languageGroup?: string[]
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string')
}

function toNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isNaN(number) ? null : number
}

function isRedisStreamItem(value: unknown): value is [unknown, Record<string, unknown>] {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === 'string' && isObject(value[1])
}

function unwrapRedisStreamItem(value: unknown): Record<string, unknown> | null {
  if (isRedisStreamItem(value)) return value[1]
  if (isObject(value)) return value
  return null
}

function normalizeRedisStreamItems(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []

  if (isRedisStreamItem(value)) return [value[1]]

  return value
    .map(unwrapRedisStreamItem)
    .filter((item): item is Record<string, unknown> => item !== null)
}

function parseBackendTranscription(item: Record<string, unknown>): TranscriptionEvent | null {
  const number = toNumber(item['number'])
  const language = typeof item['language'] === 'string' ? item['language'] : ''
  const content = typeof item['result'] === 'string' ? item['result'] : ''
  const complete = item['complete'] === true || item['complete'] === 'true'

  if (number === null) return null

  return { kind: 'transcription', number, language, content, complete }
}

function parseBackendTranslation(item: Record<string, unknown>): TranslationEvent | null {
  const number = toNumber(item['number'])
  const languageValue = item['language']
  const complete = item['complete'] === true || item['complete'] === 'true'
  const languages =
    typeof languageValue === 'string'
      ? languageValue.split(',').map((language) => language.trim()).filter(Boolean)
      : toStringArray(languageValue)

  if (number === null) return null

  const translations = languages.reduce<Record<string, string>>((acc, language) => {
    const translated = item[language]
    if (typeof translated === 'string') acc[language] = translated
    return acc
  }, {})

  const errorResult = typeof item['result'] === 'string' ? item['result'] : ''
  if (Object.keys(translations).length === 0 && errorResult) {
    for (const language of languages) translations[language] = errorResult
  }

  return { kind: 'translation', number, languages, translations, complete }
}

// 현재 백엔드는 named event가 아닌 기본 SSE message로 Redis stream payload를 보낸다.
export function parseBackendMessage(raw: string): SessionEvent[] {
  try {
    const parsed = JSON.parse(raw)
    if (!isObject(parsed) || !isObject(parsed['payload'])) return []

    const messageType = parsed['type']
    const payload = parsed['payload']
    const events: SessionEvent[] = []

    if (messageType === 'init') {
      const languageGroup = toStringArray(payload['language-group'])
      if (languageGroup.length > 0) {
        events.push({ kind: 'language_group', languages: languageGroup })
      }
    }

    const transcriptionItems = normalizeRedisStreamItems(payload['transcription'])
    if (messageType === 'init' && transcriptionItems.length > 0) {
      events.push({
        kind: 'message_batch',
        items: transcriptionItems
          .filter((item) => item['complete'] === 'true')
          .map((item) => ({
            number: String(item['number'] ?? ''),
            language: typeof item['language'] === 'string' ? item['language'] : '',
            text: typeof item['result'] === 'string' ? item['result'] : '',
          }))
          .filter((item) => item.text),
      })
    } else {
      for (const item of transcriptionItems) {
        const event = parseBackendTranscription(item)
        if (event) events.push(event)
      }
    }

    for (const item of normalizeRedisStreamItems(payload['translation'])) {
      const event = parseBackendTranslation(item)
      if (event) events.push(event)
    }

    return events
  } catch {
    return []
  }
}

export function parseBackendControlMessage(raw: string): BackendControlMessage | null {
  try {
    const parsed = JSON.parse(raw)
    if (!isObject(parsed)) return null

    const type = typeof parsed['type'] === 'string' ? parsed['type'] : ''
    const payload = isObject(parsed['payload']) ? parsed['payload'] : {}
    const sessionState =
      typeof payload['session-state'] === 'string' ? payload['session-state'] : undefined
    const detail = typeof payload['detail'] === 'string' ? payload['detail'] : undefined
    const languageGroup = toStringArray(payload['language-group'])

    if (!type && !sessionState && !detail && languageGroup.length === 0) return null

    return {
      type,
      sessionState,
      detail,
      languageGroup: languageGroup.length > 0 ? languageGroup : undefined,
    }
  } catch {
    return null
  }
}
