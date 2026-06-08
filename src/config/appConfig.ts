type Address = `0x${string}`

export type AppAssetConfig = {
  denomination: string
  address: Address
  decimals: number
  boltzCurrency?: string
}

export type EvmAppConfig = {
  enabled: boolean
  chainId: number
  chainName: string
  rpcUrl: string
  boltzApiUrl?: string
  entryPointAddress: Address
  accountFactoryAddress: Address
  bundlerUrl: string
  paymasterUrl?: string
  paymasterAddress?: Address
  multiEscrowAddress: Address
  multiEscrowBytecodeHash?: `0x${string}`
  arbiterAddress: Address
  arbiterNostrPubkey?: string
  assets: AppAssetConfig[]
}

export type CashuMintConfig = {
  mintUrl: string
  unit: string
  denomination: string
  decimals: number
  policyHash?: string
}

export type CashuAppConfig = {
  enabled: boolean
  mints: CashuMintConfig[]
}

export type DemoAccountConfig = {
  id: string
  label: string
  nsec: string
}

export type AppConfig = {
  relays: string[]
  nip46Relays: string[]
  signetUrl?: string
  demoAccounts: DemoAccountConfig[]
  autoTrustEscrowPubkeys: string[]
  evm: EvmAppConfig
  cashu: CashuAppConfig
}

const zeroAddress = '0x0000000000000000000000000000000000000000' as Address
export const defaultRelay = 'ws://127.0.0.1:18080'

const defaultDemoAccounts: DemoAccountConfig[] = [
  { id: 'buyer', label: 'Buyer', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl' },
  { id: 'sellerOpen', label: 'Seller - no methods', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqyqsnlj9hy' },
  { id: 'sellerEvm', label: 'Seller - EVM', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqypqfr48f3' },
  { id: 'sellerCashu', label: 'Seller - Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqypsuzaluz' },
  { id: 'sellerBoth', label: 'Seller - EVM + Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqyzqcdyq5m' },
  { id: 'escrowEvm', label: 'Escrow - EVM', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgqst89hlq' },
  { id: 'escrowCashu', label: 'Escrow - Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgpq3mz4p4' },
  { id: 'escrowBoth', label: 'Escrow - EVM + Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgpsy62d5x' },
]

function env(name: string): string | undefined {
  const value = import.meta.env[name] as string | undefined
  return value && value.length > 0 ? value : undefined
}

function browserHost(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.hostname
}

function isLoopbackHost(hostname: string): boolean {
  return hostname === '127.0.0.1' ||
    hostname === 'localhost' ||
    hostname === '0.0.0.0' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname === 'host.docker.internal'
}

function isRemoteBrowserHost(hostname: string | undefined): hostname is string {
  return Boolean(hostname && !isLoopbackHost(hostname))
}

function browserReachableUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const host = browserHost()
  if (!isRemoteBrowserHost(host)) return value
  try {
    const url = new URL(value)
    if (!isLoopbackHost(url.hostname)) return value
    url.hostname = host
    return url.toString()
  } catch {
    return value
  }
}

function envAddress(name: string, fallback = zeroAddress): Address {
  return (env(name) ?? fallback) as Address
}

function parseRelays(name = 'VITE_RELAYS'): string[] {
  const raw = env(name)
  const relays = raw
    ?.split(',')
    .map(relay => relay.trim())
    .map(relay => browserReachableUrl(relay) ?? relay)
    .filter(Boolean)
  const unique = [...new Set(relays)]
  return unique.length > 0 ? unique : [browserReachableUrl(defaultRelay) ?? defaultRelay]
}

function parseCsv(name: string): string[] {
  return env(name)
    ?.split(',')
    .map(value => value.trim())
    .filter(Boolean) ?? []
}

function parseDemoAccounts(): DemoAccountConfig[] {
  const raw = env('VITE_DEMO_ACCOUNTS')
  if (!raw) return defaultDemoAccounts
  try {
    const parsed = JSON.parse(raw) as DemoAccountConfig[]
    const accounts = parsed.filter(account =>
      typeof account.id === 'string' &&
      typeof account.label === 'string' &&
      typeof account.nsec === 'string' &&
      account.nsec.startsWith('nsec1'),
    )
    return accounts.length > 0 ? accounts : defaultDemoAccounts
  } catch {
    return defaultDemoAccounts
  }
}

function parseAssets(): AppAssetConfig[] {
  const raw = env('VITE_EVM_ASSETS')
  if (!raw) return []
  try {
    return JSON.parse(raw) as AppAssetConfig[]
  } catch {
    return []
  }
}

function parseCashuMints(): CashuMintConfig[] {
  const raw = env('VITE_CASHU_MINTS')
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as CashuMintConfig[]
    return parsed.filter(mint =>
      typeof mint.mintUrl === 'string' &&
      typeof mint.unit === 'string' &&
      typeof mint.denomination === 'string' &&
      Number.isSafeInteger(mint.decimals),
    ).map(mint => ({ ...mint, mintUrl: browserReachableUrl(mint.mintUrl) ?? mint.mintUrl }))
  } catch {
    return []
  }
}

export function loadAppConfig(): AppConfig {
  const rpcUrl = env('VITE_EVM_RPC_URL') ?? ''
  const chainId = Number.parseInt(env('VITE_EVM_CHAIN_ID') ?? '0', 10)
  const evmEnabled = Boolean(rpcUrl && Number.isSafeInteger(chainId) && chainId > 0)
  const cashuMints = parseCashuMints()
  return {
    relays: parseRelays(),
    nip46Relays: parseRelays('VITE_NIP46_RELAYS'),
    signetUrl: browserReachableUrl(env('VITE_SIGNET_URL')),
    demoAccounts: parseDemoAccounts(),
    autoTrustEscrowPubkeys: parseCsv('VITE_MARKETPLACE_AUTO_TRUST_ESCROW_PUBKEYS'),
    evm: {
      enabled: evmEnabled,
      chainId,
      chainName: env('VITE_EVM_CHAIN_NAME') ?? `EVM ${chainId || ''}`.trim(),
      rpcUrl: browserReachableUrl(rpcUrl) ?? rpcUrl,
      boltzApiUrl: browserReachableUrl(env('VITE_EVM_BOLTZ_API_URL')),
      entryPointAddress: envAddress('VITE_EVM_ENTRY_POINT_ADDRESS'),
      accountFactoryAddress: envAddress('VITE_EVM_ACCOUNT_FACTORY_ADDRESS'),
      bundlerUrl: browserReachableUrl(env('VITE_EVM_BUNDLER_URL')) ?? '',
      paymasterUrl: browserReachableUrl(env('VITE_EVM_PAYMASTER_URL')),
      paymasterAddress: env('VITE_EVM_PAYMASTER_ADDRESS') as Address | undefined,
      multiEscrowAddress: envAddress('VITE_EVM_MULTI_ESCROW_ADDRESS'),
      multiEscrowBytecodeHash: env('VITE_EVM_MULTI_ESCROW_BYTECODE_HASH') as `0x${string}` | undefined,
      arbiterAddress: envAddress('VITE_EVM_ARBITER_ADDRESS'),
      arbiterNostrPubkey: env('VITE_EVM_ARBITER_NOSTR_PUBKEY'),
      assets: parseAssets(),
    },
    cashu: {
      enabled: cashuMints.length > 0,
      mints: cashuMints,
    },
  }
}
