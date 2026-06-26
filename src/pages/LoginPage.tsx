import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { CodeHint } from '../codeHints/codeHints'
import { Alert, Button, Card, Input, Textarea } from '../components/ui'
import { Eyebrow } from '../components/widgets/Eyebrow'
import { Field } from '../components/widgets/FormField'
import type { DemoAccountConfig } from '../config/appConfig'
import { createNostrConnectRequest, loginWithBunker, loginWithNsec, loginWithNostrConnect } from '../nostr/session'
import type { AppSession } from '../types'

type Props = {
  relays: string[]
  nip46Relays: string[]
  signetUrl?: string
  demoAccounts: DemoAccountConfig[]
  loading: boolean
  error?: string
  onLogin(session: AppSession): void
  onError(error: string): void
}

const marketplaceInitializationHint = `const marketplaceSession = await marketplace.session(session.signer, {
  pubkey: session.pubkey,
  orderDrivers,
  auctionDrivers,
  publish: event => publisher(session).publish(event),
})

await marketplaceSession.start()`

export function LoginPage({ relays, nip46Relays, signetUrl, demoAccounts, loading, error, onLogin, onError }: Props) {
  const [bunkerInput, setBunkerInput] = useState('')
  const [connectUri, setConnectUri] = useState('')
  const [waiting, setWaiting] = useState(false)

  async function bunkerLogin() {
    try {
      setWaiting(true)
      onLogin(await loginWithBunker(bunkerInput, relays))
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Bunker login failed')
    } finally {
      setWaiting(false)
    }
  }

  async function startNostrConnect() {
    const request = createNostrConnectRequest(nip46Relays)
    setConnectUri(request.uri)
    setWaiting(true)
    try {
      onLogin(await loginWithNostrConnect(request.uri, relays))
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Nostr Connect login failed')
    } finally {
      setWaiting(false)
    }
  }

  async function demoLogin(account: DemoAccountConfig) {
    try {
      setWaiting(true)
      onLogin(await loginWithNsec(account.nsec, relays))
    } catch (err) {
      onError(err instanceof Error ? err.message : `Demo login failed for ${account.label}`)
    } finally {
      setWaiting(false)
    }
  }

  return (
    <section className="grid min-h-dvh grid-cols-[minmax(0,1fr)_430px] items-center gap-10 p-12 max-[860px]:grid-cols-1">
      <div>
        <Eyebrow className="mb-3">NIP-46</Eyebrow>
        <h1 className="text-5xl font-semibold leading-tight tracking-normal text-foreground">Marketplace</h1>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-muted-foreground">
          Sign in with a remote signer to publish listings, read private trade messages, and sign marketplace orders.
        </p>
      </div>
      <CodeHint code={marketplaceInitializationHint} className="rounded-xl">
        <Card className="grid gap-4 p-5">
          <Field label="Bunker URI or NIP-05">
            <Input
              value={bunkerInput}
              onChange={event => setBunkerInput(event.target.value)}
              placeholder="bunker://... or user@example.com"
            />
          </Field>
          <Button disabled={!bunkerInput || waiting || loading} onClick={bunkerLogin}>
            Connect bunker
          </Button>
          <div className="text-center text-sm font-medium text-muted-foreground">or</div>
          <Button disabled={waiting || loading} onClick={startNostrConnect} variant="secondary">
            Create Nostr Connect QR
          </Button>
          {demoAccounts.length > 0 && (
            <>
              <div className="text-center text-sm font-medium text-muted-foreground">or</div>
              <div className="grid grid-cols-2 gap-2 max-[520px]:grid-cols-1">
                {demoAccounts.map(account => (
                  <Button
                    key={account.id}
                    data-testid={`demo-login-${account.id}`}
                    disabled={waiting || loading}
                    onClick={() => void demoLogin(account)}
                    variant="secondary"
                  >
                    Login as {account.label}
                  </Button>
                ))}
              </div>
            </>
          )}
          {error && <Alert variant="destructive">{error}</Alert>}
          {connectUri && (
            <div className="grid justify-items-center gap-3">
              <QRCodeSVG value={connectUri} size={180} />
              {signetUrl && (
                <Button asChild variant="secondary">
                  <a href={signetUrl} target="_blank" rel="noreferrer">
                    Open Signet
                  </a>
                </Button>
              )}
              <Textarea className="h-20 min-h-20 text-xs" readOnly value={connectUri} />
            </div>
          )}
        </Card>
      </CodeHint>
    </section>
  )
}
