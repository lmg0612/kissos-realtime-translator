import { useState } from 'react'
import SessionEntryForm from '../../components/entrance/SessionEntryForm'
import Toast from '../../components/common/Toast'

export default function EntrancePage() {
  const [sessionId, setSessionId] = useState('')
  const [toast, setToast] = useState<string | null>(null)

  const handleEnter = async () => {
    const trimmed = sessionId.trim()

    if (!trimmed) {
      setToast('세션 ID를 입력해주세요.')
      return
    }

    const url = new URL(`/session/${encodeURIComponent(trimmed)}`, window.location.origin)
    url.searchParams.set('_', Date.now().toString())
    window.location.assign(url.toString())
  }

  return (
    <main className="page entrance-page-shell">
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}

      <section className="entrance-frame" aria-label="Join listener session">
        <header className="entrance-topbar">
          <strong>Listener</strong>
          <span>실시간 세션 입장</span>
        </header>

        <SessionEntryForm
          sessionId={sessionId}
          onChange={setSessionId}
          onSubmit={handleEnter}
        />
      </section>
    </main>
  )
}
