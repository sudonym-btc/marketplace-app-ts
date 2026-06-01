import type { SessionRestoreError } from '../types'

type Props = {
  error: SessionRestoreError
  loading: boolean
  onRetry(): void
  onClearSession(): void
}

export function SessionErrorPage({ error, loading, onRetry, onClearSession }: Props) {
  return (
    <section className="session-error-layout">
      <div className="session-error-panel">
        <span className="label">Session</span>
        <h1>{error.title}</h1>
        <p>{error.message}</p>
        {error.detail && <pre>{error.detail}</pre>}
        <div className="session-error-actions">
          <button className="button secondary" type="button" disabled={loading} onClick={onRetry}>
            Retry reconnect
          </button>
          <button className="button" type="button" disabled={loading} onClick={onClearSession}>
            Clear session
          </button>
        </div>
      </div>
    </section>
  )
}
