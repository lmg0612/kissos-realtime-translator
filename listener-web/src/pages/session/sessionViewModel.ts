import type {
  SessionHistoryItem,
  TranscriptItem,
  TranslationCurrentItem,
} from '../../features/session-state/reducer'
import { isSameLanguage } from './sessionViewUtils'

export type MessageCard = {
  id: string
  number: number
  text: string
  isFinal: boolean
}

export type LanguageCard = MessageCard & {
  order: number
}

export type ColumnScrollMeasurement = {
  maxScrollTop: number
}

export type MobileChatBlock = {
  id: string
  number: number
  translation: string
}

export function getColumnLabel(column: string) {
  return column
}

export function mergeLanguageCardsByNumber(cards: LanguageCard[]) {
  const byNumber = new Map<number, LanguageCard>()

  for (const card of cards) {
    const existing = byNumber.get(card.number)
    if (
      !existing ||
      card.order > existing.order ||
      (card.order === existing.order && !existing.isFinal && card.isFinal)
    ) {
      byNumber.set(card.number, card)
    }
  }

  return Array.from(byNumber.values()).sort((a, b) => a.number - b.number)
}

export function buildTranscriptCards(
  transcriptCurrent: TranscriptItem | null,
  transcriptHistory: TranscriptItem[],
) {
  const historyCards = transcriptHistory.map((item, index) => ({
    id: `history-${index}`,
    number: item.number,
    text: item.text,
    isFinal: true,
  }))

  if (!transcriptCurrent?.text.trim()) return historyCards

  return [
    ...historyCards,
    {
      id: 'current',
      number: transcriptCurrent.number,
      text: transcriptCurrent.text,
      isFinal: false,
    },
  ]
}

export function buildLanguageCardsByLanguage({
  languages,
  transcriptCurrent,
  transcriptHistory,
  translationCurrent,
  translationHistory,
}: {
  languages: string[]
  transcriptCurrent: TranscriptItem | null
  transcriptHistory: TranscriptItem[]
  translationCurrent: Record<string, TranslationCurrentItem>
  translationHistory: SessionHistoryItem[]
}) {
  const built: Record<string, LanguageCard[]> = {}

  languages.forEach((language) => {
    const transcriptCards = transcriptHistory
      .filter((item) => isSameLanguage(item.language, language))
      .map((item, index) => ({
        id: `transcript-${item.number}-${index}`,
        number: item.number,
        text: item.text,
        isFinal: true,
        order: 0,
      }))

    const translationCards = translationHistory.flatMap((item, index) => {
      if (item.transcript && isSameLanguage(item.transcript.language, language)) {
        return []
      }

      const text = item.translations[language]
      if (!text) return []

      return [{
        id: `translation-${item.number}-${language}-${index}`,
        number: item.number,
        text,
        isFinal: true,
        order: 1,
      }]
    })

    const currentCards: LanguageCard[] = []
    if (
      transcriptCurrent?.text.trim() &&
      isSameLanguage(transcriptCurrent.language, language)
    ) {
      currentCards.push({
        id: `current-transcript-${language}`,
        number: transcriptCurrent.number,
        text: transcriptCurrent.text,
        isFinal: false,
        order: 0,
      })
    }

    const currentTranslation = translationCurrent[language]
    if (currentTranslation) {
      currentCards.push({
        id: `current-translation-${language}`,
        number: currentTranslation.number,
        text: currentTranslation.text,
        isFinal: false,
        order: 1,
      })
    }

    built[language] = mergeLanguageCardsByNumber([
      ...transcriptCards,
      ...translationCards,
      ...currentCards,
    ])
  })

  return built
}

export function buildMobileChatBlocks(
  effectiveLanguage: string,
  transcriptCurrent: TranscriptItem | null,
  transcriptHistory: TranscriptItem[],
  translationCurrent: Record<string, TranslationCurrentItem>,
  translationHistory: SessionHistoryItem[],
) {
  const blocks = new Map<number, MobileChatBlock>()

  for (const item of translationHistory) {
    if (item.transcript && isSameLanguage(item.transcript.language, effectiveLanguage)) {
      continue
    }

    const translation = item.translations[effectiveLanguage]
    if (!translation) continue

    blocks.set(item.number, {
      id: `translation-${item.number}`,
      number: item.number,
      translation,
    })
  }

  for (const item of transcriptHistory) {
    if (!isSameLanguage(item.language, effectiveLanguage)) continue

    blocks.set(item.number, {
      id: `transcript-${item.number}`,
      number: item.number,
      translation: blocks.get(item.number)?.translation ?? item.text,
    })
  }

  const currentTranslation = translationCurrent[effectiveLanguage]
  const hasCurrentTranscript =
    transcriptCurrent !== null &&
    isSameLanguage(transcriptCurrent.language, effectiveLanguage) &&
    transcriptCurrent.text.trim().length > 0

  const currentText =
    currentTranslation?.text ??
    (hasCurrentTranscript ? transcriptCurrent.text : '')

  const historyBlocks = Array.from(blocks.values()).sort((a, b) => a.number - b.number)

  if (!currentText.trim()) return historyBlocks

  return [
    ...historyBlocks,
    {
      id: 'current',
      number: currentTranslation?.number ?? transcriptCurrent?.number ?? Number.MAX_SAFE_INTEGER,
      translation: currentText,
    },
  ]
}
