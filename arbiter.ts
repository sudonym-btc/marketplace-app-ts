#!/usr/bin/env bun

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  createCashuAuctionPolicy,
  createCashuEscrowPolicy,
  type CashuEscrowOperation,
  type CashuEscrowOperationQuery,
  type CashuEscrowOperationStatus,
  type CashuEscrowStorage,
} from '@sudonym-btc/marketplace-cashu'
import {
  createEvmAuctionPolicy,
  createEvmEscrowPolicy,
  type EvmMarketplaceChainConfig,
  type EvmOperationQuery,
  type EvmOperationRecord,
  type EvmOperationStatus,
  type EvmOperationStore,
} from '@sudonym-btc/marketplace-evm'
import type { Event, EventTemplate, VerifiedEvent } from 'nostr-tools/core'
import { EventDeletion } from 'nostr-tools/kinds'
import * as marketplace from 'nostr-tools/marketplace'
import { BunkerSigner, createNostrConnectURI } from 'nostr-tools/nip46'
import { SimplePool } from 'nostr-tools/pool'
import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure'

import { createEvmChainConfigs } from './src/evm/config'
import type { AppConfig } from './src/config/appConfig'

type Address = `0x${string}`
type Hex = `0x${string}`

type CliArgs = {
  name: string
  policies: string[]
  relays: string[]
  connectTimeoutMs: number
  publishService: boolean
  help: boolean
}

type PoolWithAutomaticAuth = SimplePool & {
  automaticallyAuth?: (relayURL: string) => null | ((event: EventTemplate) => Promise<VerifiedEvent>)
}

type PolicyBuildResult = {
  orderPolicies: marketplace.MarketplaceOrderPolicy[]
  bidPolicies: marketplace.MarketplaceBidPolicy[]
  selected: Set<string>
  evmChains: EvmMarketplaceChainConfig[]
  cashuMints: Array<{ mintUrl: string; unit: string; denomination: string; decimals: number; policyHash?: string }>
}

const appDir = dirname(fileURLToPath(import.meta.url))
const nmdkDir = resolve(appDir, '../..')
const defaultRelay = 'ws://127.0.0.1:18080'
const defaultName = 'NMDK Marketplace Arbiter'
const defaultMaxDuration = 14 * 24 * 60 * 60
const zeroAddress = '0x0000000000000000000000000000000000000000' as Address
const devCaBundle = resolve(nmdkDir, 'docker/tls/ca/ca-bundle.crt')
const caReexecFlag = 'MARKETPLACE_ARBITER_CA_REEXEC'

function evmStatusMatches(record: EvmOperationRecord, status?: EvmOperationStatus | EvmOperationStatus[]): boolean {
  if (!status) return true
  return Array.isArray(status) ? status.includes(record.status) : record.status === status
}

function evmOperationMatches(record: EvmOperationRecord, query: EvmOperationQuery = {}): boolean {
  return (
    (!query.kind || record.kind === query.kind) &&
    evmStatusMatches(record, query.status) &&
    (!query.chainId || record.chainId === query.chainId) &&
    (!query.tradeId || record.tradeId === query.tradeId) &&
    (!query.swapId || record.swapId === query.swapId)
  )
}

class ArbiterEvmOperationStore implements EvmOperationStore {
  private readonly records = new Map<string, EvmOperationRecord>()

  async get(id: string): Promise<EvmOperationRecord | null> {
    return this.records.get(id) ?? null
  }

  async put(record: EvmOperationRecord): Promise<void> {
    this.records.set(record.id, record)
  }

  async list(query: EvmOperationQuery = {}): Promise<EvmOperationRecord[]> {
    return [...this.records.values()].filter(record => evmOperationMatches(record, query))
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }
}

function cashuStatusMatches(
  actual: CashuEscrowOperationStatus,
  expected?: CashuEscrowOperationStatus | CashuEscrowOperationStatus[],
): boolean {
  if (!expected) return true
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected
}

class ArbiterCashuEscrowStore implements CashuEscrowStorage {
  private readonly records = new Map<string, CashuEscrowOperation>()

  async get(id: string): Promise<CashuEscrowOperation | null> {
    return this.records.get(id) ?? null
  }

  async put(record: CashuEscrowOperation): Promise<void> {
    this.records.set(record.id, structuredClone(record))
  }

  async list(query: CashuEscrowOperationQuery = {}): Promise<CashuEscrowOperation[]> {
    return [...this.records.values()]
      .filter(record => cashuStatusMatches(record.status, query.status))
      .filter(record => !query.tradeId || record.tradeId === query.tradeId)
      .filter(record => !query.settlementId || record.settlementId === query.settlementId)
      .filter(record => !query.quoteId || record.quoteId === query.quoteId)
      .filter(record => !query.mintUrl || record.mintUrl === query.mintUrl)
      .map(record => structuredClone(record))
  }

  async delete(id: string): Promise<void> {
    this.records.delete(id)
  }
}

if (
  !process.env[caReexecFlag] &&
  !process.env.NODE_EXTRA_CA_CERTS &&
  !process.env.SSL_CERT_FILE &&
  existsSync(devCaBundle)
) {
  const proc = Bun.spawn({
    cmd: [process.execPath, ...process.argv.slice(1)],
    env: {
      ...process.env,
      [caReexecFlag]: '1',
      NODE_EXTRA_CA_CERTS: devCaBundle,
      SSL_CERT_FILE: devCaBundle,
    },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  process.exit(await proc.exited)
}

function usage(): string {
  return `
Usage:
  ./arbiter.ts --name='NMDK Arbiter' --policy evm-escrow --policy cashu-escrow

Options:
  --name <name>              Name shown in the NIP-46 connect request.
  --policy <policy>          Repeatable. Supported now: evm-escrow, evm-auction, cashu-escrow.
  --relay <relay>            Repeatable. Defaults to ws://127.0.0.1:18080.
  --connect-timeout-ms <ms>  NIP-46 connect timeout. Defaults to 300000.
  --no-service               Do not publish temporary escrow service events.
  --help                     Print this help.
`.trim()
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = {
    name: defaultName,
    policies: [],
    relays: [],
    connectTimeoutMs: 300_000,
    publishService: true,
    help: false,
  }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const [flag, inlineValue] = arg.includes('=') ? arg.split(/=(.*)/s, 2) : [arg, undefined]
    const value = inlineValue ?? argv[i + 1]
    const consume = inlineValue === undefined
    switch (flag) {
      case '--name':
        args.name = value && value.length > 0 ? value : defaultName
        if (consume) i += 1
        break
      case '--policy':
        if (!value) throw new Error('--policy requires a value')
        args.policies.push(value)
        if (consume) i += 1
        break
      case '--relay':
        if (!value) throw new Error('--relay requires a value')
        args.relays.push(value)
        if (consume) i += 1
        break
      case '--connect-timeout-ms':
        args.connectTimeoutMs = Number.parseInt(value ?? '', 10)
        if (!Number.isSafeInteger(args.connectTimeoutMs) || args.connectTimeoutMs < 1) {
          throw new Error(`Invalid --connect-timeout-ms: ${value}`)
        }
        if (consume) i += 1
        break
      case '--no-service':
        args.publishService = false
        break
      case '--help':
      case '-h':
        args.help = true
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  if (!args.help && args.policies.length === 0) throw new Error('At least one --policy is required')
  return args
}

function parseDotEnv(content: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const index = line.indexOf('=')
    if (index < 0) continue
    const key = line.slice(0, index).trim()
    let value = line.slice(index + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    values[key] = value
  }
  return values
}

function loadEnv(): Record<string, string> {
  const merged: Record<string, string> = {}
  for (const path of [
    resolve(appDir, '.env.development'),
    resolve(appDir, '.env.local'),
    resolve(nmdkDir, '.nmdk.local.env'),
  ]) {
    try {
      Object.assign(merged, parseDotEnv(readFileSync(path, 'utf8')))
    } catch (_) {
      // Optional env files are intentionally ignored.
    }
  }
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') merged[key] = value
  }
  return merged
}

function envValue(env: Record<string, string>, name: string): string | undefined {
  const value = env[name]
  return value && value.length > 0 ? value : undefined
}

function envAddress(env: Record<string, string>, name: string, fallback = zeroAddress): Address {
  return (envValue(env, name) ?? fallback) as Address
}

function envOptionalAddress(env: Record<string, string>, name: string): Address | undefined {
  return envValue(env, name) as Address | undefined
}

function envHex(env: Record<string, string>, name: string): Hex | undefined {
  return envValue(env, name) as Hex | undefined
}

function parseJsonArray<T>(raw: string | undefined, fallback: T[]): T[] {
  if (!raw) return fallback
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : fallback
  } catch (_) {
    return fallback
  }
}

function relaysFrom(env: Record<string, string>, cliRelays: string[]): string[] {
  if (cliRelays.length > 0) return cliRelays
  const envRelays = envValue(env, 'VITE_RELAYS')
    ?.split(',')
    .map(relay => relay.trim())
    .filter(Boolean)
  return envRelays && envRelays.length > 0 ? envRelays : [defaultRelay]
}

function appConfigFromEnv(env: Record<string, string>, relays: string[]): AppConfig {
  const chainId = Number.parseInt(envValue(env, 'VITE_EVM_CHAIN_ID') ?? '0', 10)
  const rpcUrl = envValue(env, 'VITE_EVM_RPC_URL') ?? ''
  const enabled = Boolean(rpcUrl && Number.isSafeInteger(chainId) && chainId > 0)
  return {
    relays,
    evm: {
      enabled,
      chainId,
      chainName: envValue(env, 'VITE_EVM_CHAIN_NAME') ?? `EVM ${chainId || ''}`.trim(),
      rpcUrl,
      boltzApiUrl: envValue(env, 'VITE_EVM_BOLTZ_API_URL'),
      entryPointAddress: envAddress(env, 'VITE_EVM_ENTRY_POINT_ADDRESS'),
      accountFactoryAddress: envAddress(env, 'VITE_EVM_ACCOUNT_FACTORY_ADDRESS'),
      bundlerUrl: envValue(env, 'VITE_EVM_BUNDLER_URL') ?? '',
      paymasterUrl: envValue(env, 'VITE_EVM_PAYMASTER_URL'),
      paymasterAddress: envOptionalAddress(env, 'VITE_EVM_PAYMASTER_ADDRESS'),
      multiEscrowAddress: envAddress(env, 'VITE_EVM_MULTI_ESCROW_ADDRESS'),
      multiEscrowBytecodeHash: envHex(env, 'VITE_EVM_MULTI_ESCROW_BYTECODE_HASH'),
      arbiterAddress: envAddress(env, 'VITE_EVM_ARBITER_ADDRESS'),
      arbiterNostrPubkey: envValue(env, 'VITE_EVM_ARBITER_NOSTR_PUBKEY'),
      assets: parseJsonArray(envValue(env, 'VITE_EVM_ASSETS'), []),
    },
  }
}

function cashuMintsFromEnv(env: Record<string, string>) {
  const configured = parseJsonArray<{
    mintUrl: string
    unit?: string
    denomination?: string
    decimals?: number
    policyHash?: string
  }>(
    envValue(env, 'MARKETPLACE_CASHU_MINTS') ?? envValue(env, 'VITE_CASHU_MINTS'),
    [],
  )
  if (configured.length > 0) {
    return configured.map(mint => ({
      mintUrl: mint.mintUrl,
      unit: mint.unit ?? 'sat',
      denomination: mint.denomination ?? 'SAT',
      decimals: mint.decimals ?? 0,
      ...(mint.policyHash ? { policyHash: mint.policyHash } : {}),
    }))
  }
  const mintUrl =
    envValue(env, 'CASHU_MINT_URL') ??
    envValue(env, 'MARKETPLACE_CASHU_PUBLIC_MINT_URL') ??
    envValue(env, 'VITE_CASHU_MINT_URL') ??
    'http://127.0.0.1:19338'
  return [{
    mintUrl,
    unit: envValue(env, 'CASHU_MINT_UNIT') ?? 'sat',
    denomination: envValue(env, 'CASHU_MINT_DENOMINATION') ?? 'SAT',
    decimals: Number.parseInt(envValue(env, 'CASHU_MINT_DECIMALS') ?? '0', 10),
  }]
}

function buildPolicies(config: AppConfig, env: Record<string, string>, requested: string[]): PolicyBuildResult {
  const selected = new Set(requested)
  const evmChains = createEvmChainConfigs(config)
  const cashuMints = cashuMintsFromEnv(env)
  const orderPolicies: marketplace.MarketplaceOrderPolicy[] = []
  const bidPolicies: marketplace.MarketplaceBidPolicy[] = []

  for (const policy of requested) {
    if (policy === 'evm-escrow') {
      if (evmChains.length === 0) throw new Error('evm-escrow requested but EVM chain config is disabled')
      orderPolicies.push(createEvmEscrowPolicy({
        chains: evmChains,
        operationStore: new ArbiterEvmOperationStore(),
        appId: 'marketplace',
      }) as marketplace.MarketplaceOrderPolicy)
    } else if (policy === 'evm-auction') {
      if (evmChains.length === 0) {
        throw new Error('evm-auction requested but EVM chain config is disabled')
      }
      bidPolicies.push(createEvmAuctionPolicy({
        chains: evmChains,
        operationStore: new ArbiterEvmOperationStore(),
        appId: 'marketplace',
      }) as marketplace.MarketplaceBidPolicy)
    } else if (policy === 'cashu-escrow') {
      orderPolicies.push(createCashuEscrowPolicy({
        mints: cashuMints,
        storage: new ArbiterCashuEscrowStore(),
        appId: 'marketplace',
      }) as marketplace.MarketplaceOrderPolicy)
    } else if (policy === 'cashu-auction') {
      bidPolicies.push(createCashuAuctionPolicy({
        mints: cashuMints,
        storage: new ArbiterCashuEscrowStore(),
        appId: 'marketplace',
      }) as marketplace.MarketplaceBidPolicy)
    } else {
      throw new Error(`Unknown policy: ${policy}`)
    }
  }

  return { orderPolicies, bidPolicies, selected, evmChains, cashuMints }
}

function randomHex(bytes: number): string {
  return [...crypto.getRandomValues(new Uint8Array(bytes))]
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('')
}

function signerPerms(): string[] {
  return [
    'get_public_key',
    'nip44_encrypt',
    'nip44_decrypt',
    'sign_event:5',
    'sign_event:30303',
    'sign_event:32124',
    'sign_event:32125',
    'sign_event:32127',
    'sign_event:22242',
  ]
}

async function connectSigner(pool: SimplePool, relays: string[], args: CliArgs): Promise<BunkerSigner> {
  const clientSecretKey = generateSecretKey()
  const clientPubkey = getPublicKey(clientSecretKey)
  const uri = createNostrConnectURI({
    clientPubkey,
    relays,
    secret: randomHex(16),
    name: args.name,
    perms: signerPerms(),
  })
  console.log('\nNostr Connect (NIP-46) URL:\n')
  console.log(uri)
  console.log('\nWaiting for signer connection...\n')
  const abort = new AbortController()
  const timeout = setTimeout(
    () => abort.abort(`NIP-46 connection timed out after ${args.connectTimeoutMs}ms`),
    args.connectTimeoutMs,
  )
  try {
    return await BunkerSigner.fromURI(clientSecretKey, uri, {
      pool,
      skipSwitchRelays: true,
      relayAuth: event => Promise.resolve(finalizeEvent(event, clientSecretKey)),
    }, abort.signal)
  } catch (error) {
    if (abort.signal.aborted) {
      throw new Error(String(abort.signal.reason ?? `NIP-46 connection timed out after ${args.connectTimeoutMs}ms`))
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

function enableRelayAuth(pool: SimplePool, signer: BunkerSigner): void {
  ;(pool as PoolWithAutomaticAuth).automaticallyAuth = () => event => signer.signEvent(event)
}

async function authenticateRelays(pool: SimplePool, relays: string[], signer: BunkerSigner): Promise<void> {
  enableRelayAuth(pool, signer)
  const signAuth = (event: EventTemplate) => signer.signEvent(event)
  const results = await Promise.allSettled(relays.map(async relayUrl => {
    const relay = await pool.ensureRelay(relayUrl)
    try {
      await relay.auth(signAuth)
    } catch (error) {
      if (error instanceof Error && error.message.includes("can't perform auth, no challenge")) return
      throw error
    }
  }))
  const failures = results.filter(result => result.status === 'rejected')
  if (failures.length === relays.length && relays.length > 0) {
    throw new Error(`NIP-42 relay authentication failed: ${failures.map(result => String(result.reason)).join('; ')}`)
  }
  if (failures.length > 0) {
    console.warn('[arbiter] some relays did not authenticate', { failures: failures.length, relayCount: relays.length })
  }
}

function publishFailure(result: PromiseSettledResult<string>): string | undefined {
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

async function publishEvent(
  pool: SimplePool,
  relays: string[],
  signer: BunkerSigner,
  event: Event,
): Promise<void> {
  const results = await Promise.allSettled(pool.publish(relays, event, {
    onauth: authEvent => signer.signEvent(authEvent),
  }))
  const failures = results.map(publishFailure).filter((failure): failure is string => failure !== undefined)
  if (failures.length === results.length) throw new Error(`Relay publish failed: ${failures.join('; ')}`)
  if (failures.length > 0) {
    console.warn('[arbiter] event publish partially failed', {
      eventId: event.id,
      kind: event.kind,
      failures: failures.length,
      relayCount: relays.length,
    })
  }
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'arbiter'
}

function policyHashFor(policy: marketplace.MarketplacePaymentPolicy): string | undefined {
  return typeof policy.hash === 'string' ? policy.hash : undefined
}

async function publishServiceEvents(input: {
  signer: BunkerSigner
  pubkey: string
  publish: (event: Event) => Promise<void>
  name: string
  config: AppConfig
  build: PolicyBuildResult
}): Promise<void> {
  const now = Math.floor(Date.now() / 1000)
  const baseD = slug(input.name)
  const signAndPublish = async (template: EventTemplate) => {
    const event = await input.signer.signEvent(template)
    await input.publish(event)
  }

  if (input.build.selected.has('evm-escrow')) {
    for (const chain of input.build.evmChains) {
      if (!chain.multiEscrowBytecodeHash) {
        console.warn('[arbiter] skipping EVM escrow service publish without multiEscrowBytecodeHash', {
          chainId: chain.chainId,
        })
        continue
      }
      await signAndPublish(marketplace.escrowServices.template({
        d: `${baseD}:evm-escrow:${chain.chainId}`,
        pubkey: input.pubkey,
        type: 'EVM',
        maxDuration: defaultMaxDuration,
        fee: { ppm: 0, base: '0', min: '0', max: '0' },
        params: {
          policyType: 'evm:multi-escrow',
          arbiterAddress: input.config.evm.arbiterAddress,
          contractAddress: chain.multiEscrowAddress,
          contractBytecodeHash: chain.multiEscrowBytecodeHash,
          chainId: chain.chainId,
        },
        createdAt: now,
      }))
    }
  }

  if (input.build.selected.has('evm-auction')) {
    for (const chain of input.build.evmChains) {
      if (!chain.multiEscrowBytecodeHash) {
        console.warn('[arbiter] skipping EVM auction service publish without multiEscrowBytecodeHash', {
          chainId: chain.chainId,
        })
        continue
      }
      await signAndPublish(marketplace.escrowServices.template({
        d: `${baseD}:evm-auction:${chain.chainId}`,
        pubkey: input.pubkey,
        type: 'EVM',
        maxDuration: defaultMaxDuration,
        fee: { ppm: 0, base: '0', min: '0', max: '0' },
        params: {
          policyType: 'evm:multi-escrow-auction-v1',
          arbiterAddress: input.config.evm.arbiterAddress,
          contractAddress: chain.multiEscrowAddress,
          contractBytecodeHash: chain.multiEscrowBytecodeHash,
          chainId: chain.chainId,
        },
        createdAt: now,
      }))
    }
  }

  if (input.build.selected.has('cashu-escrow')) {
    for (const policy of input.build.orderPolicies.filter(policy => policy.method === 'cashu')) {
      for (const descriptor of policy.policies()) {
        const mintUrl = typeof descriptor.data?.mintUrl === 'string' ? descriptor.data.mintUrl : undefined
        const unit = typeof descriptor.data?.unit === 'string' ? descriptor.data.unit : undefined
        await signAndPublish(marketplace.escrowServices.template({
          d: `${baseD}:cashu-escrow:${slug(mintUrl ?? descriptor.id ?? 'mint')}`,
          pubkey: input.pubkey,
          type: 'CASHU',
          maxDuration: defaultMaxDuration,
          fee: { ppm: 0, base: '0', min: '0', max: '0' },
          params: {
            policyType: descriptor.type ?? 'cashu:p2pk-escrow-v1',
            policyHash: policyHashFor(descriptor),
            mintUrl,
            unit,
            mints: input.build.cashuMints.map(mint => ({
              mintUrl: mint.mintUrl,
              unit: mint.unit,
              denomination: mint.denomination,
              decimals: mint.decimals,
            })),
          },
          createdAt: now,
        }))
      }
    }
  }

  if (input.build.selected.has('cashu-auction')) {
    for (const policy of input.build.bidPolicies.filter(policy => policy.method === 'cashu')) {
      for (const descriptor of policy.policies()) {
        const mintUrl = typeof descriptor.data?.mintUrl === 'string' ? descriptor.data.mintUrl : undefined
        const unit = typeof descriptor.data?.unit === 'string' ? descriptor.data.unit : undefined
        await signAndPublish(marketplace.escrowServices.template({
          d: `${baseD}:cashu-auction:${slug(mintUrl ?? descriptor.id ?? 'mint')}`,
          pubkey: input.pubkey,
          type: 'CASHU',
          maxDuration: defaultMaxDuration,
          fee: { ppm: 0, base: '0', min: '0', max: '0' },
          params: {
            policyType: descriptor.type ?? 'cashu:p2pk-auction-v1',
            policyHash: policyHashFor(descriptor),
            mintUrl,
            unit,
            mints: input.build.cashuMints.map(mint => ({
              mintUrl: mint.mintUrl,
              unit: mint.unit,
              denomination: mint.denomination,
              decimals: mint.decimals,
            })),
          },
          createdAt: now,
        }))
      }
    }
  }
}

function deletionTags(events: Event[]): string[][] {
  const tags: string[][] = []
  for (const event of events) {
    tags.push(['e', event.id])
    const d = event.tags.find(tag => tag[0] === 'd')?.[1]
    if (d && event.kind >= 30000 && event.kind < 40000) {
      tags.push(['a', `${event.kind}:${event.pubkey}:${d}`])
    }
  }
  return tags
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    console.log(usage())
    return
  }

  const env = loadEnv()
  const relays = relaysFrom(env, args.relays)
  const config = appConfigFromEnv(env, relays)
  const build = buildPolicies(config, env, args.policies)
  const pool = new SimplePool({ enableReconnect: true })
  const createdEvents = new Map<string, Event>()
  let signer: BunkerSigner | undefined
  let escrowRuntime: marketplace.MarketplaceEscrowRuntime | undefined
  let shuttingDown = false

  const publishTracked = async (event: Event): Promise<void> => {
    if (!signer) throw new Error('Signer is not connected')
    await publishEvent(pool, relays, signer, event)
    createdEvents.set(event.id, event)
    console.log('[arbiter] published event', { kind: event.kind, id: event.id })
  }

  const cleanup = async (reason: string): Promise<void> => {
    if (shuttingDown) return
    shuttingDown = true
    console.log('[arbiter] shutting down', { reason, createdEvents: createdEvents.size })
    escrowRuntime?.close(reason)
    if (signer && createdEvents.size > 0) {
      const events = [...createdEvents.values()]
      const deletion = await signer.signEvent({
        kind: EventDeletion,
        created_at: Math.floor(Date.now() / 1000),
        content: `arbiter shutdown: ${reason}`,
        tags: deletionTags(events),
      })
      try {
        await publishEvent(pool, relays, signer, deletion)
        console.log('[arbiter] published deletion event', { id: deletion.id, deletedEvents: events.length })
      } catch (error) {
        console.warn('[arbiter] failed to publish deletion event', error)
      }
    }
    await signer?.close().catch(() => undefined)
    pool.close(relays)
  }

  process.on('SIGINT', () => void cleanup('SIGINT').finally(() => process.exit(0)))
  process.on('SIGTERM', () => void cleanup('SIGTERM').finally(() => process.exit(0)))
  process.on('uncaughtException', error => {
    console.error('[arbiter] uncaught exception', error)
    void cleanup('uncaughtException').finally(() => process.exit(1))
  })
  process.on('unhandledRejection', error => {
    console.error('[arbiter] unhandled rejection', error)
    void cleanup('unhandledRejection').finally(() => process.exit(1))
  })

  try {
    console.log('[arbiter] configured', {
      relays,
      orderPolicies: build.orderPolicies.map(policy => policy.id ?? policy.method),
      bidPolicies: build.bidPolicies.map(policy => policy.id ?? policy.method),
    })

    signer = await connectSigner(pool, relays, args)
    const pubkey = await signer.getPublicKey()
    await authenticateRelays(pool, relays, signer)
    console.log('[arbiter] signer connected', { pubkey, relays })

    const runtime = await marketplace.session(pool, relays, signer, {
      pubkey,
      orderPolicies: build.orderPolicies,
      bidPolicies: build.bidPolicies,
      publish: publishTracked,
    })
    const started = await runtime.start({ unusedWindow: 25 })
    console.log('[arbiter] marketplace runtime started', {
      seedCreated: runtime.seed.created,
      maxUsedIndex: started.discovery.maxUsedIndex,
      nextUnusedIndex: started.discovery.nextUnusedIndex,
      policies: started.policies.length,
      assets: started.assets.length,
    })

    if (args.publishService) {
      await publishServiceEvents({
        signer,
        pubkey,
        publish: publishTracked,
        name: args.name,
        config,
        build,
      })
    }

    escrowRuntime = runtime.escrow.start({
      autoAck: true,
      autoNack: true,
      onstate(event) {
        if (event.type === 'payment_seen') {
          console.log('[arbiter] payment seen', { group: event.group.id, payment: event.payment.event.id })
        } else if (event.type === 'payment_validated') {
          console.log('[arbiter] payment validated', {
            group: event.group.id,
            payment: event.payment.event.id,
            status: event.validation.status,
          })
        } else if (event.type === 'payment_ack_published' || event.type === 'payment_nack_published') {
          console.log('[arbiter] payment decision published', {
            type: event.type,
            group: event.group.id,
            payment: event.payment.event.id,
            eventId: event.event.id,
          })
        } else if (event.type === 'error') {
          console.warn('[arbiter] escrow watcher error', event.error)
        } else if (event.type === 'eose') {
          console.log('[arbiter] initial escrow subscription EOSE')
        } else if (event.type === 'closed') {
          console.log('[arbiter] escrow subscription closed', { reasons: event.reasons })
        }
      },
    })
    console.log('[arbiter] escrow watcher started')
    await new Promise(() => undefined)
  } catch (error) {
    await cleanup('error')
    throw error
  }
}

main().catch(error => {
  console.error('[arbiter] failed', error)
  process.exit(1)
})
