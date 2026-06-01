import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import { SimplePool } from 'nostr-tools/pool'
import {
  BunkerSigner,
  createNostrConnectURI,
  parseBunkerInput,
  toBunkerURL,
  type BunkerPointer,
} from 'nostr-tools/nip46'

import type { AppSession, NostrPublisher } from '../types'
import { bytesToHex, hexToBytes, randomHex } from '../utils/hex'

const clientKeyStorageKey = 'marketplace-app:nip46-client-key'
const bunkerStorageKey = 'marketplace-app:bunker'
const pubkeyStorageKey = 'marketplace-app:pubkey'
const bunkerRequestTimeoutMs = 15_000

type PoolWithAutomaticAuth = SimplePool & {
  automaticallyAuth?: (relayURL: string) => null | ((event: EventTemplate) => Promise<VerifiedEvent>)
}

export type NostrConnectRequest = {
  uri: string
  clientPubkey: string
  secret: string
}

export class BunkerSessionTimeoutError extends Error {
  constructor(action: string, timeoutMs = bunkerRequestTimeoutMs) {
    super(`${action} timed out after ${Math.round(timeoutMs / 1000)} seconds`)
    this.name = 'BunkerSessionTimeoutError'
  }
}

function withBunkerTimeout<T>(promise: Promise<T>, action: string, timeoutMs = bunkerRequestTimeoutMs): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new BunkerSessionTimeoutError(action, timeoutMs)), timeoutMs)
  })
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timeout))
}

function getOrCreateClientSecretKey(): Uint8Array {
  const stored = localStorage.getItem(clientKeyStorageKey)
  if (stored) return hexToBytes(stored)
  const secretKey = generateSecretKey()
  localStorage.setItem(clientKeyStorageKey, bytesToHex(secretKey))
  return secretKey
}

export function createNostrConnectRequest(relays: string[]): NostrConnectRequest {
  const localSecretKey = getOrCreateClientSecretKey()
  const clientPubkey = getPublicKey(localSecretKey)
  const secret = randomHex(16)
  console.debug('[marketplace-app] creating NIP-46 connect request', {
    relayCount: relays.length,
    clientPubkey,
  })
  const uri = createNostrConnectURI({
    clientPubkey,
    relays,
    secret,
    name: 'Marketplace',
    perms: [
      'get_public_key',
      'nip44_encrypt',
      'nip44_decrypt',
      'sign_event:13',
      'sign_event:30402',
      'sign_event:30403',
      'sign_event:17388',
      'sign_event:30302',
      'sign_event:30303',
      'sign_event:32122',
      'sign_event:1327',
      'sign_event:1328',
      'sign_event:1329',
      'sign_event:1330',
      'sign_event:31555',
      'sign_event:24133',
      'sign_event:22242',
    ],
  })
  return { uri, clientPubkey, secret }
}

export function nip42AuthSigner(session: AppSession): (event: EventTemplate) => Promise<VerifiedEvent> {
  return event => session.signer.signEvent(event)
}

export function isBunkerSessionTimeout(err: unknown): err is BunkerSessionTimeoutError {
  return err instanceof BunkerSessionTimeoutError
}

function enableNip42Auth(pool: SimplePool, signer: BunkerSigner): void {
  ;(pool as PoolWithAutomaticAuth).automaticallyAuth = () => event => signer.signEvent(event)
}

function isMissingAuthChallenge(err: unknown): boolean {
  return err instanceof Error && err.message.includes("can't perform auth, no challenge")
}

function failedPublishReason(result: PromiseSettledResult<string>): string | undefined {
  if (result.status === 'rejected') return String(result.reason)
  if (
    result.value.startsWith('connection failure:') ||
    result.value.startsWith('connection skipped') ||
    result.value.startsWith('duplicate url')
  ) {
    return result.value
  }
  return undefined
}

async function connectAndAuthenticateRelays(pool: SimplePool, relays: string[], signer: BunkerSigner): Promise<void> {
  enableNip42Auth(pool, signer)
  console.debug('[marketplace-app] connecting relays with NIP-42 auth enabled', {
    relayCount: relays.length,
  })
  const signAuth = (event: EventTemplate) => signer.signEvent(event)
  const results = await Promise.allSettled(relays.map(async relayUrl => {
    const relay = await pool.ensureRelay(relayUrl)
    try {
      await relay.auth(signAuth)
      console.debug('[marketplace-app] relay authenticated', { relayUrl })
    } catch (err) {
      if (isMissingAuthChallenge(err)) {
        console.debug('[marketplace-app] relay connected without an auth challenge yet', { relayUrl })
      } else {
        console.warn('[marketplace-app] relay authentication failed', { relayUrl }, err)
        throw err
      }
    }
  }))
  const hardFailures = results.filter(result => result.status === 'rejected')
  if (hardFailures.length === relays.length && relays.length > 0) {
    console.warn('[marketplace-app] all relay authentication attempts failed', {
      relayCount: relays.length,
      failureCount: hardFailures.length,
    })
    throw new Error(`NIP-42 relay authentication failed: ${hardFailures.map(result => String(result.reason)).join('; ')}`)
  }
  console.debug('[marketplace-app] relay connection/auth pass complete', {
    relayCount: relays.length,
    failureCount: hardFailures.length,
  })
}

export async function loginWithNostrConnect(uri: string, relays: string[]): Promise<AppSession> {
  console.debug('[marketplace-app] logging in with nostrconnect URI', { relayCount: relays.length })
  const pool = new SimplePool()
  try {
    const signer = await BunkerSigner.fromURI(getOrCreateClientSecretKey(), uri, { pool, skipSwitchRelays: true })
    const pubkey = await withBunkerTimeout(signer.getPublicKey(), 'Nostr Connect signer handshake')
    await withBunkerTimeout(connectAndAuthenticateRelays(pool, relays, signer), 'Bunker relay authentication')
    localStorage.setItem(bunkerStorageKey, toBunkerURL(signer.bp))
    localStorage.setItem(pubkeyStorageKey, pubkey)
    console.debug('[marketplace-app] nostrconnect login complete', { pubkey, relayCount: relays.length })
    return { pubkey, signer, pool, relays }
  } catch (err) {
    pool.close(relays)
    throw err
  }
}

export async function loginWithBunker(input: string, relays: string[]): Promise<AppSession> {
  console.debug('[marketplace-app] logging in with bunker pointer', { relayCount: relays.length })
  const pointer = await parseBunkerInput(input)
  if (!pointer) throw new Error('Invalid bunker URI or NIP-05 address')
  const scopedPointer = { ...pointer, relays }
  const pool = new SimplePool()
  const signer = BunkerSigner.fromBunker(getOrCreateClientSecretKey(), scopedPointer, { pool })
  try {
    await withBunkerTimeout(signer.connect(), 'Bunker connect')
    const pubkey = await withBunkerTimeout(signer.getPublicKey(), 'Bunker public key request')
    await withBunkerTimeout(connectAndAuthenticateRelays(pool, relays, signer), 'Bunker relay authentication')
    localStorage.setItem(bunkerStorageKey, toBunkerURL(scopedPointer))
    localStorage.setItem(pubkeyStorageKey, pubkey)
    console.debug('[marketplace-app] bunker login complete', { pubkey, relayCount: relays.length })
    return { pubkey, signer, pool, relays }
  } catch (err) {
    pool.close(relays)
    throw err
  }
}

export async function restoreBunkerSession(relays: string[]): Promise<AppSession | null> {
  console.debug('[marketplace-app] attempting to restore bunker session', { relayCount: relays.length })
  const stored = localStorage.getItem(bunkerStorageKey)
  if (!stored) {
    console.debug('[marketplace-app] no bunker session to restore')
    return null
  }
  const pointer = await parseBunkerInput(stored)
  if (!pointer) {
    console.warn('[marketplace-app] stored bunker session could not be parsed')
    return null
  }
  const scopedPointer = { ...pointer, relays }
  const pool = new SimplePool()
  const signer = BunkerSigner.fromBunker(getOrCreateClientSecretKey(), scopedPointer as BunkerPointer, { pool })
  try {
    const pubkey = await withBunkerTimeout(signer.getPublicKey(), 'Bunker reconnect')
    await withBunkerTimeout(connectAndAuthenticateRelays(pool, relays, signer), 'Bunker relay authentication')
    localStorage.setItem(pubkeyStorageKey, pubkey)
    console.debug('[marketplace-app] restored bunker session', { pubkey, relayCount: relays.length })
    return { pubkey, signer, pool, relays }
  } catch (err) {
    pool.close(relays)
    throw err
  }
}

export function clearStoredSession(): void {
  console.debug('[marketplace-app] clearing stored NIP-46 session')
  localStorage.removeItem(bunkerStorageKey)
  localStorage.removeItem(pubkeyStorageKey)
  localStorage.removeItem(clientKeyStorageKey)
}

export function logout(session?: AppSession): void {
  console.debug('[marketplace-app] logging out', {
    hadSession: Boolean(session),
    relayCount: session?.relays.length ?? 0,
  })
  session?.pool.close(session.relays)
  clearStoredSession()
}

export function publisher(session: AppSession): NostrPublisher {
  const signAuth = nip42AuthSigner(session)
  return {
    sign(event: EventTemplate): Promise<VerifiedEvent> {
      return session.signer.signEvent(event)
    },
    async publish(event: Event): Promise<void> {
      console.debug('[marketplace-app] publishing nostr event', {
        eventId: event.id,
        kind: event.kind,
        relayCount: session.relays.length,
      })
      const pubs = session.pool.publish(session.relays, event, { onauth: signAuth })
      const results = await Promise.allSettled(pubs)
      const failures = results.map(failedPublishReason).filter(reason => reason !== undefined)
      if (failures.length === results.length) {
        console.warn('[marketplace-app] nostr event publish failed on every relay', {
          eventId: event.id,
          kind: event.kind,
          failureCount: failures.length,
        })
        throw new Error(`Relay publish failed: ${failures.join('; ')}`)
      }
      if (failures.length > 0) {
        console.warn('[marketplace-app] nostr event publish partially failed', {
          eventId: event.id,
          kind: event.kind,
          failureCount: failures.length,
          relayCount: session.relays.length,
        })
      } else {
        console.debug('[marketplace-app] nostr event publish accepted', {
          eventId: event.id,
          kind: event.kind,
          relayCount: session.relays.length,
        })
      }
    },
  }
}
