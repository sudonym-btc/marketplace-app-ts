import { useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'

import { createNostrConnectRequest, loginWithBunker, loginWithNostrConnect } from '../nostr/session'
import type { AppSession } from '../types'

type Props = {
  relays: string[]
  loading: boolean
  onLogin(session: AppSession): void
  onError(error: string): void
}

export function LoginPage({ relays, loading, onLogin, onError }: Props) {
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
    const request = createNostrConnectRequest(relays)
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

  return (
    <section className="login-layout">
      <div className="login-copy">
        <span className="label">NIP-46</span>
        <h1>Marketplace</h1>
        <p>Sign in with a remote signer to publish listings, read private trade messages, and sign marketplace orders.</p>
      </div>
      <div className="login-panel">
        <label>
          Bunker URI or NIP-05
          <input
            value={bunkerInput}
            onChange={event => setBunkerInput(event.target.value)}
            placeholder="bunker://... or user@example.com"
          />
        </label>
        <button className="button" type="button" disabled={!bunkerInput || waiting || loading} onClick={bunkerLogin}>
          Connect bunker
        </button>
        <div className="divider">or</div>
        <button className="button secondary" type="button" disabled={waiting || loading} onClick={startNostrConnect}>
          Create Nostr Connect QR
        </button>
        {connectUri && (
          <div className="qr-panel">
            <QRCodeSVG value={connectUri} size={180} />
            <textarea readOnly value={connectUri} />
          </div>
        )}
      </div>
    </section>
  )
}
