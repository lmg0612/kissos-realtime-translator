import { useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import WideSessionView from './WideSessionView'
import MobileSessionView from './MobileSessionView'
import { useResponsive } from '../../shared/hooks/useResponsive'
import { useSessionStore } from '../../features/session-state/store'
import { connectSessionSSE } from '../../features/sse/sseClient'

export default function SessionPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const isMobile = useResponsive()
  const [state, dispatch] = useSessionStore()

  useEffect(() => {
    if (!sessionId) return

    dispatch({ type: 'session/setId', payload: sessionId })
    dispatch({ type: 'connection/setStatus', payload: 'connecting' })

    const source = connectSessionSSE(sessionId, {
      onOpen: () => {
        dispatch({ type: 'connection/setStatus', payload: 'connecting' })
      },
      onAlive: () => {
        dispatch({ type: 'connection/setStatus', payload: 'connected' })
      },
      onEvent: (event) => {
        dispatch({ type: 'event/received', payload: event })
      },
      onError: () => {
        dispatch({ type: 'connection/setStatus', payload: 'error' })
      },
      // session-state: dead는 listener.py에서 세션 없음으로 확정한다.
      onClose: () => {
        dispatch({ type: 'connection/setStatus', payload: 'not_found' })
      },
    })

    return () => {
      source.close()
      dispatch({ type: 'connection/setStatus', payload: 'disconnected' })
    }
  }, [sessionId, dispatch])

  // 세션이 존재하지 않으면 진입 페이지로 돌려보낸다.
  if (state.connectionStatus === 'not_found') {
    return (
      <main className="page session-state-page">
        <section className="session-state-panel">
          <div>
            <p className="session-state-kicker">Session unavailable</p>
            <h1>존재하지 않는 세션입니다</h1>
            <p>PIN {sessionId} 세션을 찾을 수 없습니다.</p>
            <button
              type="button"
              className="primary-button session-state-action"
              onClick={() => navigate('/entrance')}
            >
              입장 화면으로 돌아가기
            </button>
          </div>
        </section>
      </main>
    )
  }

  const commonProps = {
    sessionId,
    connectionStatus: state.connectionStatus,
    sessionDetail: state.sessionDetail,
    expiresAt: state.expiresAt,
    availableLanguages: state.availableLanguages,
    selectedLanguage: state.selectedLanguage,
    transcriptCurrent: state.transcriptCurrent,
    transcriptHistory: state.transcriptHistory,
    translationCurrent: state.translationCurrent,
    translationHistory: state.translationHistory,
    onSelectLanguage: (language: string) =>
      dispatch({ type: 'language/select', payload: language }),
  }

  return (
    <main className="page">
      {isMobile ? (
        <MobileSessionView {...commonProps} />
      ) : (
        <WideSessionView
          {...commonProps}
          selectedLanguages={state.selectedLanguages}
          onBack={() => {
            if (window.history.length > 1) {
              navigate(-1)
              return
            }
            navigate('/entrance')
          }}
          onToggleLanguage={(language: string) =>
            dispatch({ type: 'language/toggle', payload: language })
          }
          onSetActiveLanguages={(languages: string[]) =>
            dispatch({ type: 'language/setActive', payload: languages })
          }
        />
      )}
    </main>
  )
}
