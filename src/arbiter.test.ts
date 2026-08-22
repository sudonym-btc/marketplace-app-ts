import { afterEach, describe, expect, test } from 'bun:test'
import { lstatSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { EvmExecutor } from '@sudonym-btc/marketplace-evm'

import {
  ArbiterEvmOperationStore,
  buildPolicies,
  ensureArbiterStateDirectory,
  evmSettlementAccountFromEnv,
} from '../arbiter'
import type { AppConfig } from './config/appConfig'

const arbiterPrivateKey = '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6'
const arbiterAddress = '0x90F79bf6EB2c4f870365E785982E1f101E93b906'
const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'nmdk-arbiter-test-'))
  temporaryDirectories.push(directory)
  return directory
}

function evmAppConfig(): AppConfig {
  return {
    relays: ['ws://127.0.0.1:18080'],
    nip46Relays: ['ws://127.0.0.1:18080'],
    demoAccounts: [],
    autoTrustArbiterPubkeys: [],
    evm: {
      enabled: true,
      chainId: 412346,
      chainName: 'Arbitrum Regtest',
      rpcUrl: 'http://127.0.0.1:18546',
      entryPointAddress: '0x0000000071727De22E5E9d8BAf0edAc6f37da032',
      accountFactoryAddress: '0x91E60e0613810449d098b0b5Ec8b51A0FE8c8985',
      bundlerUrl: 'http://127.0.0.1:4337',
      multiEscrowAddress: '0x663F3ad617193148711d28f5334eE4Ed07016602',
      arbiterAddress,
      assets: [],
    },
    cashu: { enabled: false, mints: [] },
  }
}

function stackConfig(directory: string, privateKey = arbiterPrivateKey): string {
  const path = join(directory, 'evm-stack.json')
  writeFileSync(path, JSON.stringify({
    accounts: { arbiter: { address: arbiterAddress, privateKey } },
  }))
  return path
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

describe('composed arbiter recovery', () => {
  test('wires the matching EVM settlement account, executor, and durable store into auction policy', () => {
    const directory = temporaryDirectory()
    const build = buildPolicies(
      evmAppConfig(),
      { MARKETPLACE_EVM_STACK_CONFIG: stackConfig(directory) },
      ['evm-auction'],
      join(directory, 'state'),
    )

    expect(build.evmSettlementAddress).toBe(arbiterAddress)
    expect(build.bidPolicies).toHaveLength(1)
    const policy = build.bidPolicies[0] as unknown as {
      operationStore?: unknown
      settlementAccount?: { address: string }
      settlementExecutor?: EvmExecutor
    }
    expect(policy.operationStore).toBeInstanceOf(ArbiterEvmOperationStore)
    expect(policy.settlementAccount?.address).toBe(arbiterAddress)
    expect(typeof policy.settlementExecutor?.execute).toBe('function')
    expect(typeof policy.settlementExecutor?.waitForSubmission).toBe('function')
  })

  test('fails closed when settlement credentials do not control the configured arbiter address', () => {
    expect(() => evmSettlementAccountFromEnv(
      { MARKETPLACE_EVM_ARBITER_PRIVATE_KEY: `0x${'11'.repeat(32)}` },
      arbiterAddress,
    )).toThrow('does not match VITE_EVM_ARBITER_ADDRESS')
  })

  test('reloads operation records after restart and restricts state permissions', async () => {
    const directory = join(temporaryDirectory(), 'state')
    ensureArbiterStateDirectory(directory)
    const path = join(directory, 'evm-operations.json')
    const record = {
      id: 'auction:settlement:restart',
      kind: 'escrow' as const,
      status: 'settling' as const,
      chainId: 412346,
      tradeId: 'trade-id',
      data: { userOperationHash: `0x${'ab'.repeat(32)}` },
      createdAt: 1_800_000_000,
      updatedAt: 1_800_000_001,
    }

    await new ArbiterEvmOperationStore(path).put(record)
    const restarted = new ArbiterEvmOperationStore(path)

    expect(await restarted.get(record.id)).toEqual(record)
    expect(statSync(directory).mode & 0o777).toBe(0o700)
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(lstatSync(path).isSymbolicLink()).toBe(false)
  })
})
