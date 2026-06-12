import type { EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { decode } from 'nostr-tools/nip19'
import { decrypt, encrypt, getConversationKey } from 'nostr-tools/nip44'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'
import type { SimplePool } from 'nostr-tools/pool'
import { BunkerSigner, parseBunkerInput, toBunkerURL, type BunkerPointer } from 'nostr-tools/nip46'

import type { AppSigner } from '../types'
import { bytesToHex, hexToBytes } from '../utils/hex'

const clientKeyStorageKey = 'marketplace-app:nip46-client-key'
const signerStorageKey = 'marketplace-app:signer'
const legacyBunkerStorageKey = 'marketplace-app:bunker'
const legacyPubkeyStorageKey = 'marketplace-app:pubkey'

type StoredSigner =
  | { kind: 'bunker'; bunker: string; pubkey?: string }
  | { kind: 'nsec'; nsec: string; pubkey?: string }

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

function readStoredSigner(): StoredSigner | null {
  const stored = localStorage.getItem(signerStorageKey)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as StoredSigner
      if (parsed.kind === 'bunker' && parsed.bunker) return parsed
      if (parsed.kind === 'nsec' && parsed.nsec) return parsed
    } catch (err) {
      console.warn('[marketplace-app] stored signer record could not be parsed', err)
    }
  }

  const legacyBunker = localStorage.getItem(legacyBunkerStorageKey)
  if (!legacyBunker) return null
  return {
    kind: 'bunker',
    bunker: legacyBunker,
    pubkey: localStorage.getItem(legacyPubkeyStorageKey) ?? undefined,
  }
}

export function getOrCreateClientSecretKey(): Uint8Array {
  const stored = localStorage.getItem(clientKeyStorageKey)
  if (stored) return hexToBytes(stored)
  const secretKey = generateSecretKey()
  localStorage.setItem(clientKeyStorageKey, bytesToHex(secretKey))
  return secretKey
}

export async function signerFromLocalSecret(nsec: string): Promise<{ pubkey: string; signer: AppSigner }> {
  const signer = new StoredNsecSigner(parseNsec(nsec))
  return { pubkey: await signer.getPublicKey(), signer }
}

export function storeLocalSecretCredential(nsec: string, pubkey: string): void {
  const stored: StoredSigner = { kind: 'nsec', nsec: nsec.trim(), pubkey }
  localStorage.setItem(signerStorageKey, JSON.stringify(stored))
  localStorage.removeItem(legacyBunkerStorageKey)
  localStorage.setItem(legacyPubkeyStorageKey, pubkey)
}

export function storeBunkerCredential(pointer: BunkerPointer, pubkey: string): void {
  const bunker = toBunkerURL(pointer)
  const stored: StoredSigner = { kind: 'bunker', bunker, pubkey }
  localStorage.setItem(signerStorageKey, JSON.stringify(stored))
  localStorage.setItem(legacyBunkerStorageKey, bunker)
  localStorage.setItem(legacyPubkeyStorageKey, pubkey)
}

export async function restoreStoredSigner(
  pool: SimplePool,
  relays: string[],
  clientSecretKey: Uint8Array,
): Promise<{ pubkey: string; signer: AppSigner } | null> {
  const stored = readStoredSigner()
  if (!stored) return null

  if (stored.kind === 'nsec') return signerFromLocalSecret(stored.nsec)

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
  localStorage.removeItem(signerStorageKey)
  localStorage.removeItem(legacyBunkerStorageKey)
  localStorage.removeItem(legacyPubkeyStorageKey)
  localStorage.removeItem(clientKeyStorageKey)
}
