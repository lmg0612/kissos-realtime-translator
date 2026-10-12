import {
  type CSSProperties,
  type WheelEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  SessionHistoryItem,
  TranscriptItem,
  TranslationCurrentItem,
} from '../../features/session-state/reducer'
import {
  formatExpiryTime,
  uniqueLanguages,
  useContentFontScale,
} from './sessionViewUtils'
import SessionToolbar from './components/SessionToolbar'
import TranscriptionSidebar from './components/TranscriptionSidebar'
import TranslationWorkspace from './components/TranslationWorkspace'
import {
  type ColumnScrollMeasurement,
  type MessageCard,
  buildLanguageCardsByLanguage,
  buildTranscriptCards,
} from './sessionViewModel'

type WideSessionViewProps = {
  sessionId: string
  connectionStatus: string
  sessionDetail: string | null
  expiresAt: number | null
  availableLanguages: string[]
  selectedLanguage: string | null
  selectedLanguages: string[]
  transcriptCurrent: TranscriptItem | null
  transcriptHistory: TranscriptItem[]
  translationCurrent: Record<string, TranslationCurrentItem>
  translationHistory: SessionHistoryItem[]
  onSelectLanguage: (language: string) => void
  onToggleLanguage: (language: string) => void
  onSetActiveLanguages: (languages: string[]) => void
  onBack: () => void
}

export default function WideSessionView({
  sessionId,
  connectionStatus,
  sessionDetail,
  expiresAt,
  availableLanguages,
  selectedLanguage,
  selectedLanguages,
  transcriptCurrent,
  transcriptHistory,
  translationCurrent,
  translationHistory,
  onSelectLanguage,
  onToggleLanguage,
  onSetActiveLanguages,
  onBack,
}: WideSessionViewProps) {
  const languageOptions = useMemo(
    () => uniqueLanguages(availableLanguages),
    [availableLanguages],
  )

  const fallbackActiveColumns = useMemo(() => {
    const firstLanguage =
      (selectedLanguage && languageOptions.includes(selectedLanguage)
        ? selectedLanguage
        : null) ??
      selectedLanguages.find((l) => languageOptions.includes(l)) ??
      languageOptions[0]

    return firstLanguage ? [firstLanguage] : []
  }, [languageOptions, selectedLanguage, selectedLanguages])

  const [isTranscriptSidebarOpen, setIsTranscriptSidebarOpen] = useState(true)
  const [dragLanguage, setDragLanguage] = useState<string | null>(null)
  const [dragOverLanguage, setDragOverLanguage] = useState<string | null>(null)
  const [isLanguageLimitToastVisible, setIsLanguageLimitToastVisible] =
    useState(false)
  const { contentFontScale, updateContentFontScale } =
    useContentFontScale()

  const translationBodyRefs = useRef<Array<HTMLDivElement | null>>([])
  const transcriptionBodyRef = useRef<HTMLDivElement | null>(null)
  const translationGlobalScrollbarRef = useRef<HTMLDivElement | null>(null)
  const languageToolbarRef = useRef<HTMLDivElement | null>(null)
  const languageLimitToastTimeoutRef = useRef<number | null>(null)
  const isSyncingGlobalScrollbarRef = useRef(false)
  const shouldStickToTranslationBottomRef = useRef(true)
  const [globalScrollbarHeight, setGlobalScrollbarHeight] = useState(1)
  const [messageRowHeights, setMessageRowHeights] = useState<Record<number, number>>({})
  const [languageToolbarOverflow, setLanguageToolbarOverflow] = useState({
    left: false,
    right: false,
  })
  const [shareStatus, setShareStatus] = useState<'idle' | 'copied'>('idle')

  const activeColumns = useMemo(() => {
    const filtered = selectedLanguages.filter((column) => (
      languageOptions.includes(column)
    ))
    return filtered.length > 0 ? filtered.slice(0, 5) : fallbackActiveColumns
  }, [fallbackActiveColumns, languageOptions, selectedLanguages])

  useEffect(() => {
    return () => {
      if (languageLimitToastTimeoutRef.current !== null) {
        window.clearTimeout(languageLimitToastTimeoutRef.current)
      }
    }
  }, [])

  const showLanguageLimitToast = () => {
    if (languageLimitToastTimeoutRef.current !== null) {
      window.clearTimeout(languageLimitToastTimeoutRef.current)
    }
    setIsLanguageLimitToastVisible(true)
    languageLimitToastTimeoutRef.current = window.setTimeout(() => {
      setIsLanguageLimitToastVisible(false)
      languageLimitToastTimeoutRef.current = null
    }, 2200)
  }

  const transcriptCards = useMemo<MessageCard[]>(
    () => buildTranscriptCards(transcriptCurrent, transcriptHistory),
    [transcriptCurrent, transcriptHistory],
  )

  const languageCardsByLanguage = useMemo(() => {
    return buildLanguageCardsByLanguage({
      languages: languageOptions,
      transcriptCurrent,
      transcriptHistory,
      translationCurrent,
      translationHistory,
    })
  }, [
    languageOptions,
    transcriptCurrent,
    transcriptHistory,
    translationCurrent,
    translationHistory,
  ])

  const columnCardsByColumn = useMemo<Record<string, MessageCard[]>>(() => {
    const built: Record<string, MessageCard[]> = {}

    languageOptions.forEach((language) => {
      built[language] = languageCardsByLanguage[language] ?? []
    })

    return built
  }, [languageCardsByLanguage, languageOptions])

  const toolbarColumns = useMemo(
    () =>
      uniqueLanguages([
        ...activeColumns,
        ...selectedLanguages.filter((l) => languageOptions.includes(l)),
        ...languageOptions,
      ]),
    [activeColumns, languageOptions, selectedLanguages],
  )

  const sessionFontStyle = {
    '--session-content-font-scale': contentFontScale,
  } as CSSProperties
  const expiryTime = formatExpiryTime(expiresAt)

  const updateLanguageToolbarOverflow = useCallback(() => {
    const toolbar = languageToolbarRef.current
    if (!toolbar) return

    const maxScrollLeft = Math.max(0, toolbar.scrollWidth - toolbar.clientWidth)
    setLanguageToolbarOverflow({
      left: toolbar.scrollLeft > 1,
      right: maxScrollLeft - toolbar.scrollLeft > 1,
    })
  }, [])

  const handleLanguageToolbarWheel = useCallback((
    event: WheelEvent<HTMLDivElement>,
  ) => {
    const toolbar = languageToolbarRef.current
    if (!toolbar) return

    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
      ? event.deltaX
      : event.deltaY
    if (delta === 0) return

    event.preventDefault()
    toolbar.scrollLeft += delta
    updateLanguageToolbarOverflow()
  }, [updateLanguageToolbarOverflow])

  const handleShare = async () => {
    const url = window.location.href
    try {
      if (navigator.share) {
        await navigator.share({ url, title: 'Listener session' })
      } else {
        await navigator.clipboard.writeText(url)
        setShareStatus('copied')
        window.setTimeout(() => setShareStatus('idle'), 1600)
      }
    } catch {
      // 사용자가 네이티브 공유를 취소한 경우도 여기로 들어온다.
    }
  }

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateLanguageToolbarOverflow)
    return () => window.cancelAnimationFrame(frame)
  }, [toolbarColumns, updateLanguageToolbarOverflow])

  useEffect(() => {
    const toolbar = languageToolbarRef.current
    if (!toolbar || typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(updateLanguageToolbarOverflow)
    observer.observe(toolbar)
    return () => observer.disconnect()
  }, [updateLanguageToolbarOverflow])

  const toggleActiveColumn = (column: string) => {
    const alreadyActive = activeColumns.includes(column)

    if (!alreadyActive && activeColumns.length >= 5) {
      showLanguageLimitToast()
      return
    }

    if (alreadyActive && activeColumns.length === 1) return

    onToggleLanguage(column)

    const nextSelection = alreadyActive
      ? activeColumns.find((language) => language !== column) ?? null
      : column
    if (nextSelection) {
      onSelectLanguage(nextSelection)
    }
  }

  const moveColumn = (sourceLanguage: string, targetLanguage: string) => {
    const sourceIndex = activeColumns.indexOf(sourceLanguage)
    const targetIndex = activeColumns.indexOf(targetLanguage)
    if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) return

    const next = [...activeColumns]
    const [moved] = next.splice(sourceIndex, 1)
    next.splice(targetIndex, 0, moved)
    onSetActiveLanguages(next)
  }

  const getScrollableBodies = useCallback(() => {
    const bodies = isTranscriptSidebarOpen && transcriptionBodyRef.current
      ? [transcriptionBodyRef.current]
      : []

    return [
      ...bodies,
      ...translationBodyRefs.current.filter((body): body is HTMLDivElement => body !== null),
    ]
  }, [isTranscriptSidebarOpen])

  const measureColumns = useCallback((): ColumnScrollMeasurement[] => {
    return getScrollableBodies().map((body) => {
      return {
        maxScrollTop: body
          ? Math.max(0, body.scrollHeight - body.clientHeight)
          : 0,
      }
    })
  }, [getScrollableBodies])

  const getGlobalMaxScrollTop = useCallback((
    columns: ColumnScrollMeasurement[],
  ) => {
    return columns.reduce(
      (maxScrollTop, column) => Math.max(maxScrollTop, column.maxScrollTop),
      0,
    )
  }, [])

  const setAllColumnScrollTops = useCallback((
    scrollTop: number,
    columns: ColumnScrollMeasurement[],
  ) => {
    getScrollableBodies().forEach((body, index) => {
      const maxScrollTop = columns[index]?.maxScrollTop ?? 0
      body.scrollTop = Math.min(Math.max(scrollTop, 0), maxScrollTop)
    })
  }, [getScrollableBodies])

  const syncGlobalScrollbarMetrics = useCallback((
    columns: ColumnScrollMeasurement[],
  ) => {
    const scrollbar = translationGlobalScrollbarRef.current
    if (!scrollbar) return

    const globalMaxScrollTop = getGlobalMaxScrollTop(columns)
    setGlobalScrollbarHeight((prev) => {
      const next = scrollbar.clientHeight + globalMaxScrollTop
      return Math.abs(prev - next) > 0.5 ? next : prev
    })

    if (scrollbar.scrollTop > globalMaxScrollTop) {
      isSyncingGlobalScrollbarRef.current = true
      scrollbar.scrollTop = globalMaxScrollTop
      window.requestAnimationFrame(() => {
        isSyncingGlobalScrollbarRef.current = false
      })
    }
  }, [getGlobalMaxScrollTop])

  const syncTranslationScrollFromGlobalScrollbar = useCallback(() => {
    if (isSyncingGlobalScrollbarRef.current) return

    const scrollbar = translationGlobalScrollbarRef.current
    const columns = measureColumns()
    if (!scrollbar) return

    const globalMaxScrollTop = getGlobalMaxScrollTop(columns)
    const nextScrollTop = Math.min(scrollbar.scrollTop, globalMaxScrollTop)
    shouldStickToTranslationBottomRef.current =
      globalMaxScrollTop - nextScrollTop < 40
    setAllColumnScrollTops(nextScrollTop, columns)
  }, [getGlobalMaxScrollTop, measureColumns, setAllColumnScrollTops])

  const handleTranslationWorkspaceWheel = useCallback((
    event: WheelEvent<HTMLElement>,
  ) => {
    const scrollbar = translationGlobalScrollbarRef.current
    if (!scrollbar) return

    event.preventDefault()
    const columns = measureColumns()
    const globalMaxScrollTop = getGlobalMaxScrollTop(columns)
    const nextScrollTop = Math.min(
      Math.max(scrollbar.scrollTop + event.deltaY, 0),
      globalMaxScrollTop,
    )

    scrollbar.scrollTop = nextScrollTop
    shouldStickToTranslationBottomRef.current =
      globalMaxScrollTop - nextScrollTop < 40
    setAllColumnScrollTops(nextScrollTop, columns)
  }, [getGlobalMaxScrollTop, measureColumns, setAllColumnScrollTops])

  const updateMessageRowHeights = useCallback(() => {
    const nextHeights = new Map<number, number>()

    getScrollableBodies().forEach((body) => {
      const entries = body.querySelectorAll<HTMLElement>(
        '[data-message-number][data-message-final="true"]',
      )
      entries.forEach((entry) => {
        const number = Number(entry.dataset.messageNumber)
        if (Number.isNaN(number)) return

        const bubble = entry.querySelector<HTMLElement>('.message-bubble')
        if (!bubble) return

        const style = window.getComputedStyle(entry)
        const paddingTop = Number.parseFloat(style.paddingTop) || 0
        const paddingBottom = Number.parseFloat(style.paddingBottom) || 0
        const naturalHeight = bubble.offsetHeight + paddingTop + paddingBottom
        const current = nextHeights.get(number) ?? 0
        if (naturalHeight > current) {
          nextHeights.set(number, Math.ceil(naturalHeight))
        }
      })
    })

    const next = Object.fromEntries(nextHeights) as Record<number, number>
    setMessageRowHeights((prev) => {
      const prevKeys = Object.keys(prev)
      const nextKeys = Object.keys(next)
      if (prevKeys.length !== nextKeys.length) return next

      for (const key of nextKeys) {
        const numberKey = Number(key)
        if (Math.abs((prev[numberKey] ?? 0) - (next[numberKey] ?? 0)) > 0.5) {
          return next
        }
      }

      return prev
    })
  }, [getScrollableBodies])

  useEffect(() => {
    const frame = window.requestAnimationFrame(updateMessageRowHeights)
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeColumns,
    contentFontScale,
    columnCardsByColumn,
    transcriptCards,
    updateMessageRowHeights,
  ])

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return

    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(updateMessageRowHeights)
    })

    getScrollableBodies().forEach((body) => observer.observe(body))

    return () => observer.disconnect()
  }, [activeColumns, getScrollableBodies, updateMessageRowHeights])

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const columns = measureColumns()
      const scrollbar = translationGlobalScrollbarRef.current
      const globalMaxScrollTop = getGlobalMaxScrollTop(columns)
      syncGlobalScrollbarMetrics(columns)
      if (!shouldStickToTranslationBottomRef.current) return

      if (scrollbar) {
        isSyncingGlobalScrollbarRef.current = true
        scrollbar.scrollTop = globalMaxScrollTop
        window.requestAnimationFrame(() => {
          isSyncingGlobalScrollbarRef.current = false
        })
      }
      setAllColumnScrollTops(globalMaxScrollTop, columns)
      shouldStickToTranslationBottomRef.current = true
    })
    return () => window.cancelAnimationFrame(frame)
  }, [
    activeColumns,
    columnCardsByColumn,
    getGlobalMaxScrollTop,
    messageRowHeights,
    measureColumns,
    setAllColumnScrollTops,
    syncGlobalScrollbarMetrics,
  ])

  return (
    <section className="listener-shell" style={sessionFontStyle}>
      {isLanguageLimitToastVisible ? (
        <div className="toast-container">
          <div className="toast-box">언어 선택은 최대 5개까지만 가능합니다.</div>
        </div>
      ) : null}

      <SessionToolbar
        sessionId={sessionId}
        connectionStatus={connectionStatus}
        sessionDetail={sessionDetail}
        expiryTime={expiryTime}
        isTranscriptOpen={isTranscriptSidebarOpen}
        toolbarColumns={toolbarColumns}
        activeColumns={activeColumns}
        contentFontScale={contentFontScale}
        shareStatus={shareStatus}
        languageToolbarRef={languageToolbarRef}
        overflow={languageToolbarOverflow}
        onToolbarWheel={handleLanguageToolbarWheel}
        onToolbarScroll={updateLanguageToolbarOverflow}
        onToggleColumn={toggleActiveColumn}
        onToggleTranscript={() => setIsTranscriptSidebarOpen((prev) => !prev)}
        onUpdateFontScale={updateContentFontScale}
        onBack={onBack}
        onShare={handleShare}
      />

      <section className="session-wide-shell">
        <TranscriptionSidebar
          isOpen={isTranscriptSidebarOpen}
          cards={transcriptCards}
          messageRowHeights={messageRowHeights}
          bodyRef={transcriptionBodyRef}
          onWheel={handleTranslationWorkspaceWheel}
        />
        <TranslationWorkspace
          activeColumns={activeColumns}
          dragColumn={dragLanguage}
          dragOverColumn={dragOverLanguage}
          columnCardsByColumn={columnCardsByColumn}
          messageRowHeights={messageRowHeights}
          globalScrollbarHeight={globalScrollbarHeight}
          bodyRefs={translationBodyRefs}
          globalScrollbarRef={translationGlobalScrollbarRef}
          onWorkspaceWheel={handleTranslationWorkspaceWheel}
          onGlobalScroll={syncTranslationScrollFromGlobalScrollbar}
          onMoveColumn={moveColumn}
          onSetDragColumn={setDragLanguage}
          onSetDragOverColumn={setDragOverLanguage}
          onToggleColumn={toggleActiveColumn}
        />
      </section>
    </section>
  )
}
