export type TranscriptionEvent = {
  kind: 'transcription'
  number: number
  language: string
  content: string
  complete?: boolean
}

export type TranslationEvent = {
  kind: 'translation'
  number: number
  languages: string[]
  translations: Record<string, string>
  complete?: boolean
}

export type MessageBatchEvent = {
  kind: 'message_batch'
  items: Array<{ number: string; language: string; text: string }>
}

export type LanguageGroupEvent = {
  kind: 'language_group'
  languages: string[]
}

export type SessionDoneEvent = {
  kind: 'session_done'
  detail?: string
}

export type SessionEvent =
  | TranscriptionEvent
  | TranslationEvent
  | MessageBatchEvent
  | LanguageGroupEvent
  | SessionDoneEvent
