import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { decode } from 'nostr-tools/nip19'
import { decrypt, encrypt, getConversationKey } from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { SimplePool } from 'nostr-tools/pool'
import { BunkerSigner, parseBunkerInput, toBunkerURL, type BunkerPointer } from 'nostr-tools/nip46'

import type { AppSigner } from '../types'
import { bytesToHex, hexToBytes } from '../utils/hex'

const clientKeyStorageKey = 'marketplace-app:nip46-client-key:v2'
const signerStorageKey = 'marketplace-app:signer:v2'
const legacyClientKeyStorageKey = 'marketplace-app:nip46-client-key'
const legacySignerStorageKey = 'marketplace-app:signer'
const legacyBunkerStorageKey = 'marketplace-app:bunker'
const legacyPubkeyStorageKey = 'marketplace-app:pubkey'
const sessionTtlMs = 8 * 60 * 60 * 1000

type StoredSigner = { kind: 'bunker'; bunker: string; pubkey?: string }

type SessionRecord<T> = {
  version: 2
  expiresAt: number
  value: T
}

class StoredNsecSigner implements AppSigner {
  constructor(private readonly secretKey: Uint8Array) {}

  async getPublicKey(): Promise<string> {
    return getPublicKey(this.secretKey)
  }

  async nip44Encrypt(pubkey: string, plaintext: string): Promise<string> {
    return encrypt(plaintext, getConversationKey(this.secretKey, pubkey))
  }

  async nip44Decrypt(pubkey: string, ciphertext: string): Promise<string> {
    return decrypt(ciphertext, getConversationKey(this.secretKey, pubkey))
  }

  async signEvent(event: EventTemplate): Promise<VerifiedEvent> {
    return finalizeEvent(event, this.secretKey)
  }
}

function parseNsec(nsec: string): Uint8Array {
  const decoded = decode(nsec.trim())
  if (decoded.type !== 'nsec') throw new Error('Login requires an nsec key')
  return decoded.data
}

function purgeLegacyPersistentSecrets(): void {
  // Older releases persisted nsec, bunker authorization secrets, and the
  // NIP-46 client private key indefinitely. Never attempt to restore them.
  localStorage.removeItem(legacySignerStorageKey)
  localStorage.removeItem(legacyBunkerStorageKey)
  localStorage.removeItem(legacyPubkeyStorageKey)
  localStorage.removeItem(legacyClientKeyStorageKey)
}

function readSessionRecord<T>(key: string): T | null {
  const stored = sessionStorage.getItem(key)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as SessionRecord<T>
      if (parsed.version !== 2 || !Number.isSafeInteger(parsed.expiresAt) || parsed.expiresAt <= Date.now()) {
        sessionStorage.removeItem(key)
        return null
      }
      return parsed.value
    } catch (err) {
      sessionStorage.removeItem(key)
      console.warn('[marketplace-app] session credential record could not be parsed', err)
    }
  }
  return null
}

function writeSessionRecord<T>(key: string, value: T): void {
  const record: SessionRecord<T> = { version: 2, expiresAt: Date.now() + sessionTtlMs, value }
  sessionStorage.setItem(key, JSON.stringify(record))
}

function readStoredSigner(): StoredSigner | null {
  purgeLegacyPersistentSecrets()
  const parsed = readSessionRecord<StoredSigner>(signerStorageKey)
  return parsed?.kind === 'bunker' && parsed.bunker ? parsed : null
}

export function getOrCreateClientSecretKey(): Uint8Array {
  purgeLegacyPersistentSecrets()
  const stored = readSessionRecord<string>(clientKeyStorageKey)
  if (stored) return hexToBytes(stored)
  const secretKey = generateSecretKey()
  writeSessionRecord(clientKeyStorageKey, bytesToHex(secretKey))
  return secretKey
}

export async function signerFromLocalSecret(nsec: string): Promise<{ pubkey: string; signer: AppSigner }> {
  const signer = new StoredNsecSigner(parseNsec(nsec))
  return { pubkey: await signer.getPublicKey(), signer }
}

export function storeLocalSecretCredential(_nsec: string, _pubkey: string): void {
  // Local nsec signers live only in the in-memory AppSession. A reload requires
  // another explicit login; no plaintext private key is written to web storage.
  purgeLegacyPersistentSecrets()
  sessionStorage.removeItem(signerStorageKey)
}

export function storeBunkerCredential(pointer: BunkerPointer, pubkey: string): void {
  const bunker = toBunkerURL(pointer)
  const stored: StoredSigner = { kind: 'bunker', bunker, pubkey }
  purgeLegacyPersistentSecrets()
  writeSessionRecord(signerStorageKey, stored)
}

export async function restoreStoredSigner(
  pool: SimplePool,
  relays: string[],
  clientSecretKey: Uint8Array,
): Promise<{ pubkey: string; signer: AppSigner } | null> {
  const stored = readStoredSigner()
  if (!stored) return null

  const pointer = await parseBunkerInput(stored.bunker)
  if (!pointer) {
    console.warn('[marketplace-app] stored bunker signer could not be parsed')
    return null
  }
  const scopedPointer: BunkerPointer = { ...pointer, relays }
  const signer = BunkerSigner.fromBunker(clientSecretKey, scopedPointer, { pool })
  const pubkey = await signer.getPublicKey()
  storeBunkerCredential(scopedPointer, pubkey)
  return { pubkey, signer }
}

export function clearStoredSigner(): void {
  purgeLegacyPersistentSecrets()
  sessionStorage.removeItem(signerStorageKey)
  sessionStorage.removeItem(clientKeyStorageKey)
}
