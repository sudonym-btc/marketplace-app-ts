import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
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

export type NostrConnectRequest = {
  uri: string
  clientPubkey: string
  secret: string
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
  const uri = createNostrConnectURI({
    clientPubkey,
    relays,
    secret,
    name: 'Marketplace',
    perms: [
      'get_public_key',
      'nip44_encrypt',
      'nip44_decrypt',
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

export async function loginWithNostrConnect(uri: string, relays: string[]): Promise<AppSession> {
  const pool = new SimplePool()
  const signer = await BunkerSigner.fromURI(getOrCreateClientSecretKey(), uri, { pool })
  const pubkey = await signer.getPublicKey()
  localStorage.setItem(bunkerStorageKey, toBunkerURL(signer.bp))
  localStorage.setItem(pubkeyStorageKey, pubkey)
  return { pubkey, signer, pool, relays }
}

export async function loginWithBunker(input: string, relays: string[]): Promise<AppSession> {
  const pointer = await parseBunkerInput(input)
  if (!pointer) throw new Error('Invalid bunker URI or NIP-05 address')
  const pool = new SimplePool()
  const signer = BunkerSigner.fromBunker(getOrCreateClientSecretKey(), pointer, { pool })
  await signer.connect()
  const pubkey = await signer.getPublicKey()
  localStorage.setItem(bunkerStorageKey, toBunkerURL(pointer))
  localStorage.setItem(pubkeyStorageKey, pubkey)
  return { pubkey, signer, pool, relays }
}

export async function restoreBunkerSession(relays: string[]): Promise<AppSession | null> {
  const stored = localStorage.getItem(bunkerStorageKey)
  if (!stored) return null
  const pointer = await parseBunkerInput(stored)
  if (!pointer) return null
  const pool = new SimplePool()
  const signer = BunkerSigner.fromBunker(getOrCreateClientSecretKey(), pointer as BunkerPointer, { pool })
  const pubkey = await signer.getPublicKey()
  localStorage.setItem(pubkeyStorageKey, pubkey)
  return { pubkey, signer, pool, relays }
}

export function logout(session?: AppSession): void {
  session?.pool.close(session.relays)
  localStorage.removeItem(bunkerStorageKey)
  localStorage.removeItem(pubkeyStorageKey)
}

export function publisher(session: AppSession): NostrPublisher {
  return {
    sign(event: EventTemplate): Promise<VerifiedEvent> {
      return session.signer.signEvent(event)
    },
    async publish(event: VerifiedEvent): Promise<void> {
      const pubs = session.pool.publish(session.relays, event)
      await Promise.allSettled(pubs)
    },
  }
}
