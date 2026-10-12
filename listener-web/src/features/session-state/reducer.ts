import type { SessionEvent } from '../sse/eventTypes'

export type TranscriptItem = {
  number: number
  language: string
  text: string
}

export type SessionHistoryItem = {
  number: number
  transcript: TranscriptItem | null
  translations: Record<string, string>
}

export type TranslationCurrentItem = {
  number: number
  text: string
}

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error'
  | 'not_found'
  | 'session_done'

export type SessionState = {
  sessionId: string
  connectionStatus: ConnectionStatus
  sessionDetail: string | null
  expiresAt: number | null
  availableLanguages: string[]
  selectedLanguage: string | null
  selectedLanguages: string[]
  transcriptCurrent: TranscriptItem | null
  transcriptCurrentNumber: number | null
  transcriptHistory: TranscriptItem[]
  translationCurrent: Record<string, TranslationCurrentItem>
  translationHistory: SessionHistoryItem[]
}

export type SessionAction =
  | { type: 'session/setId'; payload: string }
  | { type: 'connection/setStatus'; payload: ConnectionStatus }
  | { type: 'event/received'; payload: SessionEvent }
  | { type: 'language/select'; payload: string }
  | { type: 'language/toggle'; payload: string }
  | { type: 'language/setActive'; payload: string[] }

export const initialSessionState: SessionState = {
  sessionId: '',
  connectionStatus: 'idle',
  sessionDetail: null,
  expiresAt: null,
  availableLanguages: [],
  selectedLanguage: null,
  selectedLanguages: [],
  transcriptCurrent: null,
  transcriptCurrentNumber: null,
  transcriptHistory: [],
  translationCurrent: {},
  translationHistory: [],
}

function normalizeLanguage(language: string) {
  return language.trim()
}

function normalizeLanguages(languages: string[]) {
  const next: string[] = []
  for (const rawLanguage of languages) {
    const language = normalizeLanguage(rawLanguage)
    if (language && !next.includes(language)) next.push(language)
  }
  return next
}

const MAX_SELECTED_LANGUAGES = 5

function reconcileSelectedLanguages(
  languages: string[],
  selectedLanguage: string | null,
  selectedLanguages: string[],
) {
  const availableLanguages = normalizeLanguages(languages)
  const nextSelectedLanguages = selectedLanguages
    .map(normalizeLanguage)
    .filter((language) => availableLanguages.includes(language))
    .slice(0, MAX_SELECTED_LANGUAGES)

  const nextSelectedLanguage =
    selectedLanguage && nextSelectedLanguages.includes(selectedLanguage)
      ? selectedLanguage
      : nextSelectedLanguages[0] ?? availableLanguages[0] ?? null

  if (
    nextSelectedLanguage &&
    nextSelectedLanguages.length === 0 &&
    availableLanguages.includes(nextSelectedLanguage)
  ) {
    nextSelectedLanguages.push(nextSelectedLanguage)
  }

  return {
    availableLanguages,
    selectedLanguage: nextSelectedLanguage,
    selectedLanguages: nextSelectedLanguages,
  }
}

function toTranscriptItem(
  number: number,
  language: string,
  text: string,
): TranscriptItem {
  return {
    number,
    language: normalizeLanguage(language),
    text,
  }
}

function upsertTranscriptHistory(
  history: TranscriptItem[],
  item: TranscriptItem,
) {
  if (!item.text.trim()) return history

  const existingIndex = history.findIndex(
    (entry) =>
      entry.number === item.number &&
      entry.language.toLowerCase() === item.language.toLowerCase(),
  )

  if (existingIndex === -1) return [...history, item]

  const next = [...history]
  next[existingIndex] = item
  return next
}

function upsertTranslationHistory(
  history: SessionHistoryItem[],
  item: SessionHistoryItem,
) {
  const existingIndex = history.findIndex((entry) => entry.number === item.number)
  if (existingIndex === -1) return [...history, item]

  const existing = history[existingIndex]
  const next = [...history]
  next[existingIndex] = {
    number: item.number,
    transcript: existing.transcript ?? item.transcript,
    translations: {
      ...existing.translations,
      ...item.translations,
    },
  }
  return next
}

function findTranscriptByNumber(
  state: SessionState,
  number: number,
) {
  return (
    state.transcriptHistory.find((item) => item.number === number) ??
    (state.transcriptCurrent?.number === number ? state.transcriptCurrent : null)
  )
}

function numberFromBatchValue(value: string, fallback: number) {
  const parsed = Number(value)
  return Number.isNaN(parsed) ? fallback : parsed
}

function omitTranslationLanguages(
  current: Record<string, TranslationCurrentItem>,
  languages: string[],
) {
  const next = { ...current }
  for (const language of languages) delete next[language]
  return next
}

export function sessionReducer(
  state: SessionState,
  action: SessionAction,
): SessionState {
  switch (action.type) {

    case 'session/setId':
      if (state.sessionId === action.payload) return state
      return { ...initialSessionState, sessionId: action.payload }

    case 'connection/setStatus':
      return {
        ...state,
        connectionStatus: action.payload,
        sessionDetail:
          action.payload === 'connecting' || action.payload === 'connected'
            ? null
            : state.sessionDetail,
      }

    case 'language/select': {
      const next = normalizeLanguage(action.payload)
      if (!state.availableLanguages.includes(next)) return state

      const selectedLanguages = state.selectedLanguages.includes(next)
        ? state.selectedLanguages
        : [...state.selectedLanguages, next].slice(0, MAX_SELECTED_LANGUAGES)

      return {
        ...state,
        selectedLanguage: next,
        selectedLanguages,
      }
    }

    case 'language/toggle': {
      const language = normalizeLanguage(action.payload)
      if (!state.availableLanguages.includes(language)) return state

      const already = state.selectedLanguages.includes(language)

      if (already) {
        const next = state.selectedLanguages.filter((l) => l !== language)
        if (next.length === 0) return state

        return {
          ...state,
          selectedLanguages: next,
          selectedLanguage:
            state.selectedLanguage === language
              ? next[0] ?? null
              : state.selectedLanguage,
        }
      }

      if (state.selectedLanguages.length >= MAX_SELECTED_LANGUAGES) return state

      const next = [...state.selectedLanguages, language]
      return {
        ...state,
        selectedLanguages: next,
        selectedLanguage: state.selectedLanguage ?? language,
      }
    }

    case 'language/setActive': {
      const selectedLanguages = action.payload
        .map(normalizeLanguage)
        .filter((language, index, list) =>
          state.availableLanguages.includes(language) &&
          list.indexOf(language) === index,
        )
        .slice(0, MAX_SELECTED_LANGUAGES)

      if (selectedLanguages.length === 0) return state

      return {
        ...state,
        selectedLanguages,
        selectedLanguage: selectedLanguages.includes(state.selectedLanguage ?? '')
          ? state.selectedLanguage
          : selectedLanguages[0],
      }
    }

    case 'event/received': {
      const event = action.payload

      if (event.kind === 'transcription') {
        const nextTranscript = toTranscriptItem(
          event.number,
          event.language,
          event.content,
        )

        let transcriptHistory = state.transcriptHistory
        if (
          state.transcriptCurrent !== null &&
          event.number !== state.transcriptCurrent.number
        ) {
          transcriptHistory = upsertTranscriptHistory(
            transcriptHistory,
            state.transcriptCurrent,
          )
        }

        if (event.complete) {
          transcriptHistory = upsertTranscriptHistory(
            transcriptHistory,
            nextTranscript,
          )

          const shouldClearCurrent =
            state.transcriptCurrent === null ||
            (
              state.transcriptCurrent.number === nextTranscript.number &&
              state.transcriptCurrent.language.toLowerCase() ===
                nextTranscript.language.toLowerCase()
            )

          return {
            ...state,
            transcriptCurrentNumber: shouldClearCurrent
              ? null
              : state.transcriptCurrentNumber,
            transcriptCurrent: shouldClearCurrent ? null : state.transcriptCurrent,
            transcriptHistory,
          }
        }

        return {
          ...state,
          transcriptCurrentNumber: nextTranscript.number,
          transcriptCurrent: nextTranscript,
          transcriptHistory,
        }
      }

      if (event.kind === 'translation') {
        const transcript = findTranscriptByNumber(state, event.number)

        if (!event.complete) {
          const nextTranslations = Object.entries(event.translations).reduce<
            Record<string, TranslationCurrentItem>
          >((acc, [language, text]) => {
            acc[language] = {
              number: event.number,
              text,
            }
            return acc
          }, {})

          return {
            ...state,
            translationCurrent: {
              ...state.translationCurrent,
              ...nextTranslations,
            },
          }
        }

        return {
          ...state,
          translationCurrent: omitTranslationLanguages(
            state.translationCurrent,
            event.languages,
          ),
          translationHistory: upsertTranslationHistory(
            state.translationHistory,
            {
              number: event.number,
              transcript,
              translations: event.translations,
            },
          ),
        }
      }

      if (event.kind === 'message_batch') {
        if (state.transcriptHistory.length > 0) return state

        const batchItems = event.items
          .map((item, index) =>
            toTranscriptItem(
              numberFromBatchValue(item.number, index),
              item.language,
              item.text,
            ),
          )
          .filter((item) => item.text.trim())

        if (batchItems.length === 0) return state

        return {
          ...state,
          transcriptHistory: batchItems,
        }
      }

      if (event.kind === 'language_group') {
        const {
          availableLanguages,
          selectedLanguage,
          selectedLanguages,
        } = reconcileSelectedLanguages(
          event.languages,
          state.selectedLanguage,
          state.selectedLanguages,
        )

        return {
          ...state,
          availableLanguages,
          selectedLanguage,
          selectedLanguages,
        }
      }

      if (event.kind === 'session_done') {
        return {
          ...state,
          connectionStatus: 'session_done',
          sessionDetail: event.detail ?? null,
          expiresAt: Date.now() + 30 * 60 * 1000,
        }
      }

      return state
    }

    default:
      return state
  }
}
