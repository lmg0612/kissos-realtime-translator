type Props = {
  sessionId: string
  onChange: (value: string) => void
  onSubmit: () => void
}

export default function SessionEntryForm({
  sessionId,
  onChange,
  onSubmit,
}: Props) {
  return (
    <section className="entrance-stage-section">
      <div className="entrance-stage-copy">
        <h1>Malieum</h1>
        <p>세션 PIN을 입력하세요</p>
      </div>

      <div className="entrance-card">
        <div className="session-form">
          <input
            className="text-input"
            value={sessionId}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onSubmit()
            }}
            placeholder="채널 PIN"
            inputMode="numeric"
            autoComplete="one-time-code"
          />

          <button className="primary-button" onClick={onSubmit}>
            입장
          </button>
        </div>
      </div>
    </section>
  )
}
