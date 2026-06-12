import type { SessionRestoreError } from '../types'
import { Button, Card } from '../components/ui'
import { Eyebrow } from '../components/widgets/Eyebrow'

type Props = {
  error: SessionRestoreError
  loading: boolean
  onRetry(): void
  onClearSession(): void
}

export function SessionErrorPage({ error, loading, onRetry, onClearSession }: Props) {
  return (
    <section className="grid min-h-dvh place-items-center p-12">
      <Card className="grid w-full max-w-xl gap-4 p-6">
        <Eyebrow>Session</Eyebrow>
        <h1 className="text-3xl font-semibold tracking-normal text-foreground">{error.title}</h1>
        <p className="text-sm leading-6 text-muted-foreground">{error.message}</p>
        {error.detail && <pre className="m-0 rounded-md bg-muted p-3 text-sm text-muted-foreground">{error.detail}</pre>}
        <div className="flex flex-wrap gap-2">
          <Button disabled={loading} onClick={onRetry} variant="secondary">
            Retry reconnect
          </Button>
          <Button disabled={loading} onClick={onClearSession}>
            Clear session
          </Button>
        </div>
      </Card>
    </section>
  )
}
