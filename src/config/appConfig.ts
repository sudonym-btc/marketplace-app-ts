type Address = `0x${string}`

export type AppAssetConfig = {
  denomination: string
  address: Address
  decimals: number
  boltzCurrency?: string
  boltzRouteVia?: {
    boltzCurrency: string
    assetAddress: Address
    decimals: number
    quoteCurrency?: string
  }
}

export type EvmAppConfig = {
  enabled: boolean
  chainId: number
  chainName: string
  boltzCurrency?: string
  rpcUrl: string
  /** Optional base URL for a human-facing block explorer for this EVM chain. */
  blockExplorerUrl?: string
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
  blossomUploadUrl?: string
  demoAccounts: DemoAccountConfig[]
  autoTrustArbiterPubkeys: string[]
  evm: EvmAppConfig
  cashu: CashuAppConfig
}

const zeroAddress = '0x0000000000000000000000000000000000000000' as Address
export const defaultRelay = 'ws://127.0.0.1:18080'
const developmentDomains = ['marketplace.test']
const developmentServiceHostPrefixes: Record<string, string> = {
  '18080': 'relay',
  '13047': 'signet',
  '13046': 'signet.api',
  '13096': 'blossom',
  '18545': 'rootstock.evm',
  '18546': 'arbitrum.evm',
  '4337': 'bundler.evm',
  '3010': 'paymaster.evm',
  '19001': 'boltz.evm',
  '19000': 'boltz.backend.evm',
  '19338': 'mint.cashu',
  '19339': 'mint-usd.cashu',
}

const defaultDemoAccounts: DemoAccountConfig[] = [
  { id: 'buyer', label: 'Buyer', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqsmhltgl' },
  { id: 'buyerOne', label: 'Buyer One', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgscfuyzx' },
  { id: 'buyerTwo', label: 'Buyer Two', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqfqz4mxun' },
  { id: 'sellerOpen', label: 'Seller - no methods', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqyqsnlj9hy' },
  { id: 'sellerEvm', label: 'Seller - EVM', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqypqfr48f3' },
  { id: 'sellerCashu', label: 'Seller - Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqypsuzaluz' },
  { id: 'sellerBoth', label: 'Seller - EVM + Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqyzqcdyq5m' },
  { id: 'arbiterEvm', label: 'Arbiter - EVM', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgqst89hlq' },
  { id: 'arbiterCashu', label: 'Arbiter - Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgpq3mz4p4' },
  { id: 'arbiterBoth', label: 'Arbiter - EVM + Cashu', nsec: 'nsec1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqgpsy62d5x' },
]

function env(name: string): string | undefined {
  const value = import.meta.env[name] as string | undefined
  return value && value.length > 0 ? value : undefined
}

function browserHost(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.hostname
}

function browserProtocol(): string | undefined {
  return typeof window === 'undefined' ? undefined : window.location.protocol
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

function developmentDomainForHost(hostname: string): string | undefined {
  return developmentDomains.find(domain => hostname === domain || hostname.endsWith(`.${domain}`))
}

function browserReachableUrl(value: string | undefined): string | undefined {
  if (!value) return undefined
  const host = browserHost()
  try {
    const url = new URL(value)
    const developmentDomain = host ? developmentDomainForHost(host) : undefined
    if (isRemoteBrowserHost(host) && isLoopbackHost(url.hostname)) {
      if (developmentDomain) {
        const serviceHostPrefix = developmentServiceHostPrefixes[url.port]
        if (serviceHostPrefix) {
          url.hostname = `${serviceHostPrefix}.${developmentDomain}`
          url.port = ''
        } else {
          url.hostname = host
        }
      } else {
        url.hostname = host
      }
    }
    if (browserProtocol() === 'https:' && developmentDomainForHost(url.hostname)) {
      if (url.protocol === 'ws:') url.protocol = 'wss:'
      if (url.protocol === 'http:') url.protocol = 'https:'
    }
    if (!isRemoteBrowserHost(host)) return url.toString()
    if (!isLoopbackHost(url.hostname)) return url.toString()
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

function normalizeCashuMintUrl(mintUrl: string): string {
  return mintUrl.replace(/\/+$/, '')
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
    ).map(mint => ({
      ...mint,
      mintUrl: normalizeCashuMintUrl(browserReachableUrl(mint.mintUrl) ?? mint.mintUrl),
    }))
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
    blossomUploadUrl: browserReachableUrl(env('VITE_BLOSSOM_UPLOAD_URL')),
    demoAccounts: parseDemoAccounts(),
    autoTrustArbiterPubkeys: parseCsv('VITE_MARKETPLACE_AUTO_TRUST_ARBITER_PUBKEYS'),
    evm: {
      enabled: evmEnabled,
      chainId,
      chainName: env('VITE_EVM_CHAIN_NAME') ?? `EVM ${chainId || ''}`.trim(),
      boltzCurrency: env('VITE_EVM_BOLTZ_CURRENCY'),
      rpcUrl: browserReachableUrl(rpcUrl) ?? rpcUrl,
      blockExplorerUrl: browserReachableUrl(env('VITE_EVM_BLOCK_EXPLORER_URL')),
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
