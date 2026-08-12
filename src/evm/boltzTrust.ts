import type {
  EvmBoltzChainTrust,
  EvmTrustedCallDecoder,
  EvmTrustedCallFunction,
  EvmTrustedCallTarget,
  EvmTrustedContract,
} from '@sudonym-btc/marketplace-evm'

const addressPattern = /^0x[0-9a-fA-F]{40}$/
const hashPattern = /^0x[0-9a-fA-F]{64}$/
const selectorPattern = /^0x[0-9a-fA-F]{8}$/
const zeroAddress = /^0x0{40}$/i
const zeroHash = /^0x0{64}$/i
const trustedCallDecoders = new Set<EvmTrustedCallDecoder>([
  'exact-input-v1',
  'permit2-approve-v1',
  'uniswap-universal-router-v3-exact-in-v1',
])

type ParseResult =
  | { trust: EvmBoltzChainTrust; error?: never }
  | { trust?: never; error: string }

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function exactKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unexpected = Object.keys(value).filter(key => !allowed.includes(key))
  if (unexpected.length > 0) throw new Error(`${label} has unknown field ${unexpected[0]}`)
}

function address(value: unknown, label: string): `0x${string}` {
  if (typeof value !== 'string' || !addressPattern.test(value) || zeroAddress.test(value)) {
    throw new Error(`${label} must be a non-zero 20-byte address`)
  }
  return value as `0x${string}`
}

function runtimeBytecodeHash(value: unknown, label: string): `0x${string}` {
  if (typeof value !== 'string' || !hashPattern.test(value) || zeroHash.test(value)) {
    throw new Error(`${label} must be a non-zero SHA-256 runtime bytecode hash`)
  }
  return value as `0x${string}`
}

function trustedContract(value: unknown, label: string): EvmTrustedContract {
  const parsed = record(value, label)
  exactKeys(parsed, ['address', 'runtimeBytecodeHash'], label)
  return {
    address: address(parsed.address, `${label}.address`),
    runtimeBytecodeHash: runtimeBytecodeHash(parsed.runtimeBytecodeHash, `${label}.runtimeBytecodeHash`),
  }
}

function trustedFunction(value: unknown, label: string): EvmTrustedCallFunction {
  const parsed = record(value, label)
  exactKeys(parsed, ['selector', 'decoder'], label)
  if (typeof parsed.selector !== 'string' || !selectorPattern.test(parsed.selector)) {
    throw new Error(`${label}.selector must be an exact 4-byte function selector`)
  }
  if (typeof parsed.decoder !== 'string' || !trustedCallDecoders.has(parsed.decoder as EvmTrustedCallDecoder)) {
    throw new Error(`${label}.decoder is not supported by this client`)
  }
  return {
    selector: parsed.selector as `0x${string}`,
    decoder: parsed.decoder as EvmTrustedCallDecoder,
  }
}

function maximumValue(value: unknown, label: string): bigint | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)$/.test(value)) {
    throw new Error(`${label} must be a non-negative decimal string`)
  }
  return BigInt(value)
}

function trustedTarget(value: unknown, label: string): EvmTrustedCallTarget {
  const parsed = record(value, label)
  exactKeys(parsed, ['address', 'runtimeBytecodeHash', 'functions', 'maxValue'], label)
  if (!Array.isArray(parsed.functions) || parsed.functions.length === 0) {
    throw new Error(`${label}.functions must contain at least one selector and decoder`)
  }
  const functions = parsed.functions.map((item, index) => trustedFunction(item, `${label}.functions[${index}]`))
  const selectors = new Set<string>()
  for (const fn of functions) {
    const normalized = fn.selector.toLowerCase()
    if (selectors.has(normalized)) throw new Error(`${label}.functions contains duplicate selector ${fn.selector}`)
    selectors.add(normalized)
  }
  const contract = trustedContract({
    address: parsed.address,
    runtimeBytecodeHash: parsed.runtimeBytecodeHash,
  }, label)
  const maxValue = maximumValue(parsed.maxValue, `${label}.maxValue`)
  return {
    ...contract,
    functions,
    ...(maxValue !== undefined ? { maxValue } : {}),
  }
}

/** Parse deployment-pinned Boltz roots. Invalid or incomplete data fails closed. */
export function parseEvmBoltzTrust(raw: string | undefined): ParseResult {
  if (!raw) return { error: 'VITE_EVM_BOLTZ_TRUST is not configured' }
  try {
    const value = record(JSON.parse(raw), 'VITE_EVM_BOLTZ_TRUST')
    exactKeys(value, ['erc20Swap', 'dexCallTargets'], 'VITE_EVM_BOLTZ_TRUST')
    const erc20Swap = trustedContract(value.erc20Swap, 'VITE_EVM_BOLTZ_TRUST.erc20Swap')
    let dexCallTargets: EvmTrustedCallTarget[] | undefined
    if (value.dexCallTargets !== undefined) {
      if (!Array.isArray(value.dexCallTargets)) {
        throw new Error('VITE_EVM_BOLTZ_TRUST.dexCallTargets must be an array')
      }
      dexCallTargets = value.dexCallTargets.map((item, index) =>
        trustedTarget(item, `VITE_EVM_BOLTZ_TRUST.dexCallTargets[${index}]`),
      )
      const targets = new Set<string>()
      for (const target of dexCallTargets) {
        const normalized = target.address.toLowerCase()
        if (targets.has(normalized)) throw new Error(`VITE_EVM_BOLTZ_TRUST contains duplicate target ${target.address}`)
        targets.add(normalized)
      }
    }
    return {
      trust: {
        erc20Swap,
        ...(dexCallTargets ? { dexCallTargets } : {}),
      },
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : 'invalid JSON'
    return { error: `Invalid VITE_EVM_BOLTZ_TRUST: ${detail}` }
  }
}
