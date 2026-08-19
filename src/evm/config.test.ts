import { describe, expect, test } from 'bun:test'

import type { AppConfig } from '../config/appConfig'
import { parseEvmBoltzTrust } from './boltzTrust'
import { createEvmChainConfigs } from './config'

const erc20Swap = '0x71C95911E9a5D330f4D621842EC243EE1343292e'
const permit2 = '0xcf27F781841484d5CF7e155b44954D7224caF1dD'
const token = '0x712516e61c8B383dF4a63CFe83D7701Bce54B03e'
const runtimeBytecodeHash = `0x${'ab'.repeat(32)}`

function validTrustJson(): string {
  return JSON.stringify({
    erc20Swap: { address: erc20Swap, runtimeBytecodeHash },
    dexCallTargets: [
      {
        address: token,
        runtimeBytecodeHash,
        functions: [
          { selector: '0x095ea7b3', decoder: 'erc20-approve-v1' },
          { selector: '0xa9059cbb', decoder: 'erc20-transfer-v1' },
        ],
      },
      {
        address: permit2,
        runtimeBytecodeHash,
        functions: [{ selector: '0x87517c45', decoder: 'permit2-approve-v1' }],
        maxValue: '0',
      },
    ],
  })
}

function appConfig(): AppConfig {
  return {
    relays: ['ws://127.0.0.1:18080'],
    nip46Relays: ['ws://127.0.0.1:18080'],
    demoAccounts: [],
    autoTrustArbiterPubkeys: [],
    evm: {
      enabled: true,
      chainId: 412346,
      chainName: 'Arbitrum Regtest',
      boltzCurrency: 'ARB',
      rpcUrl: 'http://127.0.0.1:18546',
      boltzApiUrl: 'http://127.0.0.1:19001/v2',
      entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      accountFactoryAddress: '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985',
      bundlerUrl: 'http://127.0.0.1:4337',
      multiEscrowAddress: '0x663F3ad617193148711d28f5334eE4Ed07016602',
      arbiterAddress: '0x90F79bf6EB2c4f870365E785982E1f101E93b906',
      assets: [],
    },
    cashu: { enabled: false, mints: [] },
  }
}

describe('Boltz trust configuration', () => {
  test('parses only deployment-pinned contract roots and semantic decoders', () => {
    const parsed = parseEvmBoltzTrust(validTrustJson())
    expect(parsed.error).toBeUndefined()
    expect(parsed.trust?.erc20Swap.address).toBe(erc20Swap)
    expect(parsed.trust?.dexCallTargets?.[0]?.functions[1]?.decoder).toBe('erc20-transfer-v1')
    expect(parsed.trust?.dexCallTargets?.[1]?.maxValue).toBe(0n)
    expect(parsed.trust?.dexCallTargets?.[1]?.functions[0]?.decoder).toBe('permit2-approve-v1')
  })

  test('fails closed for unknown decoder configuration', () => {
    const raw = validTrustJson().replace('permit2-approve-v1', 'provider-defined-decoder')
    const parsed = parseEvmBoltzTrust(raw)
    expect(parsed.trust).toBeUndefined()
    expect(parsed.error).toContain('decoder is not supported')
  })

  test('does not enable a provider from its URL alone', () => {
    const chains = createEvmChainConfigs(appConfig())
    expect(chains).toHaveLength(1)
    expect(chains[0]?.boltz).toBeUndefined()
  })

  test('maps trusted roots to the configured chain id', () => {
    const parsed = parseEvmBoltzTrust(validTrustJson())
    if (!parsed.trust) throw new Error(parsed.error)
    const config = appConfig()
    config.evm.boltzTrust = parsed.trust
    const chains = createEvmChainConfigs(config)
    expect(chains[0]?.boltz?.trustByChainId?.[412346]).toEqual(parsed.trust)
    expect(chains[0]?.boltz?.apiUrl).toBe('http://127.0.0.1:19001/v2')
  })
})
