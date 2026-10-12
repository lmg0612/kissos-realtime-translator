import { useEffect } from 'react'

/**
 * Toast 컴포넌트 props
 *
 * @property message  - 화면에 표시할 알림 텍스트
 * @property onClose  - 토스트가 닫힐 때 호출되는 콜백 (부모가 표시 여부를 제어한다)
 * @property duration - 자동 닫힘까지의 대기 시간(ms), 기본값 2500ms
 */
type ToastProps = {
  message: string
  onClose: () => void
  duration?: number
}

/**
 * 자동으로 사라지는 토스트 알림 컴포넌트
 *
 * - duration(ms)이 지나면 onClose를 호출하여 부모가 토스트를 숨기도록 한다.
 * - 컴포넌트가 언마운트되거나 duration이 바뀌면 기존 타이머를 정리한다.
 * - 사용 예: 세션 입력 오류, 서버 연결 실패 등의 단발성 피드백 메시지
 *
 * 사용 예:
 *   {toast && <Toast message={toast} onClose={() => setToast(null)} />}
 */
export default function Toast({
  message,
  onClose,
  duration = 2500,
}: ToastProps) {
  useEffect(() => {
    // duration 후 onClose를 자동 호출하여 토스트를 닫는다.
    const timer = setTimeout(onClose, duration)
    return () => clearTimeout(timer)
  }, [onClose, duration])

  return (
    <div className="toast-container">
      <div className="toast-box">{message}</div>
    </div>
  )
}
