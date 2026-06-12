import { LoginPage } from '../pages/LoginPage'
import { SessionErrorPage } from '../pages/SessionErrorPage'
import { useMarketplaceApp } from '../state/AppStateContext'
import { LoadingSpinner } from './LoadingSpinner'
import { Card } from './ui'
import { Eyebrow } from './widgets/Eyebrow'

export function LoginGate() {
  const { state, actions } = useMarketplaceApp()

  if (state.restoringSigner) {
    return (
      <section className="grid min-h-dvh place-items-center p-12">
        <Card className="grid w-full max-w-xl gap-3 p-6">
          <div className="flex items-center gap-3">
            <LoadingSpinner label="Restoring signer" />
            <Eyebrow>Signer</Eyebrow>
          </div>
          <h1 className="text-3xl font-semibold tracking-normal text-foreground">Restoring signer</h1>
          <p className="text-sm leading-6 text-muted-foreground">Checking saved signer credentials and reconnecting relays.</p>
        </Card>
      </section>
    )
  }

  if (state.sessionError) {
    return (
      <SessionErrorPage
        error={state.sessionError}
        loading={state.loading}
        onRetry={actions.restore}
        onClearSession={actions.clearSession}
      />
    )
  }

  return (
    <LoginPage
      relays={state.config.relays}
      nip46Relays={state.config.nip46Relays}
      signetUrl={state.config.signetUrl}
      demoAccounts={state.config.demoAccounts}
      loading={state.loading}
      error={state.error}
      onLogin={actions.attachSession}
      onError={actions.setError}
    />
  )
}
