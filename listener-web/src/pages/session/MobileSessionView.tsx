import { type CSSProperties, useEffect, useRef, useState } from 'react'
import { ChevronDown, Type } from 'lucide-react'
import type {
  SessionHistoryItem,
  TranscriptItem,
  TranslationCurrentItem,
} from '../../features/session-state/reducer'
import {
  CONTENT_FONT_SCALE_MAX,
  CONTENT_FONT_SCALE_MIN,
  formatExpiryTime,
  getConnectionLabel,
  uniqueLanguages,
  useContentFontScale,
} from './sessionViewUtils'
import { buildMobileChatBlocks } from './sessionViewModel'

type MobileSessionViewProps = {
  sessionId: string
  connectionStatus: string
  sessionDetail: string | null
  expiresAt: number | null
  availableLanguages: string[]
  selectedLanguage: string | null
  transcriptCurrent: TranscriptItem | null
  transcriptHistory: TranscriptItem[]
  translationCurrent: Record<string, TranslationCurrentItem>
  translationHistory: SessionHistoryItem[]
  onSelectLanguage: (language: string) => void
}

export default function MobileSessionView({
  sessionId,
  connectionStatus,
  sessionDetail,
  expiresAt,
  availableLanguages,
  selectedLanguage,
  transcriptCurrent,
  transcriptHistory,
  translationCurrent,
  translationHistory,
  onSelectLanguage,
}: MobileSessionViewProps) {
  const safeLanguages = uniqueLanguages(availableLanguages ?? [])

  const requestedLanguage = selectedLanguage
  const effectiveLanguage =
    requestedLanguage && safeLanguages.includes(requestedLanguage)
      ? requestedLanguage
      : safeLanguages[0] ?? ''

  const chatBlocks = buildMobileChatBlocks(
    effectiveLanguage,
    transcriptCurrent,
    transcriptHistory,
    translationCurrent,
    translationHistory,
  )

  const [isLanguageMenuOpen, setIsLanguageMenuOpen] = useState(false)
  const languageMenuRef = useRef<HTMLDivElement | null>(null)
  const { contentFontScale, updateContentFontScale } =
    useContentFontScale()

  const mobileFontStyle = {
    '--mobile-content-font-scale': contentFontScale,
  } as CSSProperties
  const expiryTime = formatExpiryTime(expiresAt)

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node
      if (languageMenuRef.current?.contains(target)) return
      setIsLanguageMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutsideClick)
    return () => document.removeEventListener('mousedown', handleOutsideClick)
  }, [])

  return (
    <section className="session-layout mobile-layout" style={mobileFontStyle}>
      <header className="mobile-session-topbar">
        <span className="listener-session-chip">PIN {sessionId}</span>
        <span className="status-badge" title={sessionDetail ?? undefined}>
          {getConnectionLabel(connectionStatus)}
        </span>
        {expiryTime ? (
          <span className="listener-session-chip">{expiryTime} 만료</span>
        ) : null}
        <div className="listener-font-controls" aria-label="Font size controls">
          <Type size={14} aria-hidden="true" />
          <button
            type="button"
            className="listener-font-control-button"
            onClick={() => updateContentFontScale(-1)}
            disabled={contentFontScale <= CONTENT_FONT_SCALE_MIN}
            aria-label="Decrease content font size"
          >
            A-
          </button>
          <button
            type="button"
            className="listener-font-control-button"
            onClick={() => updateContentFontScale(1)}
            disabled={contentFontScale >= CONTENT_FONT_SCALE_MAX}
            aria-label="Increase content font size"
          >
            A+
          </button>
        </div>
      </header>

      <div className="card mobile-language-bar" ref={languageMenuRef}>
        <span className="field-label" id="mobile-language-label">
          번역 언어
        </span>
        <button
          type="button"
          className="mobile-language-select"
          onClick={() => setIsLanguageMenuOpen((prev) => !prev)}
          disabled={safeLanguages.length === 0}
          aria-labelledby="mobile-language-label"
          aria-expanded={isLanguageMenuOpen}
        >
          <span>{effectiveLanguage || '언어 없음'}</span>
          <ChevronDown
            className={`mobile-language-select-arrow ${isLanguageMenuOpen ? 'is-open' : ''}`}
            size={18}
            aria-hidden="true"
          />
        </button>

        {isLanguageMenuOpen ? (
          <div className="mobile-language-menu custom-scrollbar">
            {safeLanguages.map((language) => (
              <button
                key={language}
                type="button"
                className={`mobile-language-option ${
                  language === effectiveLanguage ? 'is-selected' : ''
                }`}
                onClick={() => {
                  onSelectLanguage(language)
                  setIsLanguageMenuOpen(false)
                }}
              >
                {language}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <section className="mobile-translation-workspace">
        <article className="mobile-translation-column">
          <div className="mobile-translation-header">
            <span className="mobile-translation-column-title">
              {effectiveLanguage || '언어 없음'}
            </span>
          </div>

          <div className="mobile-translation-body custom-scrollbar">
            {chatBlocks.length === 0 ? (
              <p className="mobile-empty-state">대기 중...</p>
            ) : (
              chatBlocks.map((item) => (
                <article key={item.id} className="mobile-translation-card">
                  <p className="mobile-translation-card-text">
                    {item.translation || '번역 내용이 없습니다.'}
                  </p>
                </article>
              ))
            )}
          </div>
        </article>
      </section>
    </section>
  )
}
