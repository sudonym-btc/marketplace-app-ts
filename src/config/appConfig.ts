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
  multiAuctionAddress?: Address
  multiAuctionBytecodeHash?: `0x${string}`
  arbiterAddress: Address
  arbiterNostrPubkey?: string
  assets: AppAssetConfig[]
}

export type AppConfig = {
  relays: string[]
  evm: EvmAppConfig
}

const zeroAddress = '0x0000000000000000000000000000000000000000' as Address
export const hostrDevelopmentRelay = 'wss://relay.hostr.development'

function env(name: string): string | undefined {
  const value = import.meta.env[name] as string | undefined
  return value && value.length > 0 ? value : undefined
}

function envAddress(name: string, fallback = zeroAddress): Address {
  return (env(name) ?? fallback) as Address
}

function parseRelays(): string[] {
  return [hostrDevelopmentRelay]
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

export function loadAppConfig(): AppConfig {
  const rpcUrl = env('VITE_EVM_RPC_URL') ?? ''
  const chainId = Number.parseInt(env('VITE_EVM_CHAIN_ID') ?? '0', 10)
  const evmEnabled = Boolean(rpcUrl && Number.isSafeInteger(chainId) && chainId > 0)
  return {
    relays: parseRelays(),
    evm: {
      enabled: evmEnabled,
      chainId,
      chainName: env('VITE_EVM_CHAIN_NAME') ?? `EVM ${chainId || ''}`.trim(),
      rpcUrl,
      boltzApiUrl: env('VITE_EVM_BOLTZ_API_URL'),
      entryPointAddress: envAddress('VITE_EVM_ENTRY_POINT_ADDRESS'),
      accountFactoryAddress: envAddress('VITE_EVM_ACCOUNT_FACTORY_ADDRESS'),
      bundlerUrl: env('VITE_EVM_BUNDLER_URL') ?? '',
      paymasterUrl: env('VITE_EVM_PAYMASTER_URL'),
      paymasterAddress: env('VITE_EVM_PAYMASTER_ADDRESS') as Address | undefined,
      multiEscrowAddress: envAddress('VITE_EVM_MULTI_ESCROW_ADDRESS'),
      multiEscrowBytecodeHash: env('VITE_EVM_MULTI_ESCROW_BYTECODE_HASH') as `0x${string}` | undefined,
      multiAuctionAddress: env('VITE_EVM_MULTI_AUCTION_ADDRESS') as Address | undefined,
      multiAuctionBytecodeHash: env('VITE_EVM_MULTI_AUCTION_BYTECODE_HASH') as `0x${string}` | undefined,
      arbiterAddress: envAddress('VITE_EVM_ARBITER_ADDRESS'),
      arbiterNostrPubkey: env('VITE_EVM_ARBITER_NOSTR_PUBKEY'),
      assets: parseAssets(),
    },
  }
}
