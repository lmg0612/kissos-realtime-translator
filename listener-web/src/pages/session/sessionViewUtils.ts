import { useState } from 'react'

export const CONTENT_FONT_SCALE_MIN = 0.875
export const CONTENT_FONT_SCALE_MAX = 1.375
export const CONTENT_FONT_SCALE_STEP = 0.125

export function uniqueLanguages(languages: string[]) {
  return Array.from(new Set(languages.filter(Boolean)))
}

export function isSameLanguage(a: string, b: string) {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

export function getConnectionLabel(status: string) {
  switch (status) {
    case 'connecting':
      return '연결 중'
    case 'connected':
      return '연결됨'
    case 'error':
      return '오류'
    case 'disconnected':
      return '종료됨'
    case 'not_found':
      return '세션 없음'
    case 'session_done':
      return '세션 종료'
    case 'idle':
      return '대기 중'
    default:
      return status || '대기 중'
  }
}

export function formatExpiryTime(expiresAt: number | null) {
  if (expiresAt === null) return null

  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(expiresAt))
}

export function useContentFontScale() {
  const [contentFontScale, setContentFontScale] = useState(1)

  const updateContentFontScale = (direction: -1 | 1) => {
    setContentFontScale((prev) => {
      const next = prev + CONTENT_FONT_SCALE_STEP * direction
      return Math.min(CONTENT_FONT_SCALE_MAX, Math.max(CONTENT_FONT_SCALE_MIN, next))
    })
  }

  return {
    contentFontScale,
    setContentFontScale,
    updateContentFontScale,
  }
}
