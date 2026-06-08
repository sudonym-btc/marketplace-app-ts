import type { AppConfig } from '../config/appConfig'
import type { AppSession, LoadedMarketplace } from '../types'

type Props = {
  config: AppConfig
  session?: AppSession
  marketplace?: LoadedMarketplace
}

export function SettingsPage({ config, session, marketplace }: Props) {
  return (
    <section className="page">
      <div className="page-heading">
        <div>
          <span className="label">Runtime</span>
          <h1>Settings</h1>
        </div>
      </div>
      <div className="settings-grid">
        <article>
          <h2>Nostr</h2>
          <p>{session?.pubkey ?? 'Not logged in'}</p>
          <code>{config.relays.join('\n')}</code>
        </article>
        <article>
          <h2>NIP-46</h2>
          <p>{config.signetUrl ?? 'No local Signet URL configured'}</p>
          <code>{config.nip46Relays.join('\n')}</code>
        </article>
        <article>
          <h2>EVM</h2>
          <p>{config.evm.enabled ? `${config.evm.chainName} (${config.evm.chainId})` : 'Disabled'}</p>
          <code>{config.evm.rpcUrl || 'No RPC configured'}</code>
          <p>{marketplace?.evm?.startSummary}</p>
        </article>
      </div>
    </section>
  )
}
