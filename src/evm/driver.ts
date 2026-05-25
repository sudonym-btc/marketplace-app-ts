import {
  createMarketplaceEvmClient,
  erc20Abi,
  multiEscrowRuntimeBytecodeHash,
  type EvmChainConfig,
  type EvmHash,
  type EvmHighWatermarkDiscovery,
  type MarketplaceEvmClient,
  zeroAddress,
} from '@sudonym-btc/marketplace-evm'
import type { EventTemplate } from 'nostr-tools/core'
import * as marketplace from 'nostr-tools/marketplace'
import { createPublicClient, http } from 'viem'
import type { Address } from 'viem'

import type { AppConfig, AppTokenConfig } from '../config/appConfig'
import type { EvmDriverState } from '../types'
import { LocalOperationStore } from './operationStore'

export type EvmOrderAndPayResult =
  | {
      type: 'escrow-funded'
      orderDraft: EventTemplate
      tradeIndex: number
      txHash: EvmHash
      validationStatus: string
      buyerAddress: Address
    }
  | {
      type: 'external-payment-required'
      orderDraft: EventTemplate
      tradeIndex: number
      invoice: string
      swapId: string
      preimageHash: string
      buyerAddress: Address
    }

export type EvmMarketplaceDriver = marketplace.MarketplacePaymentDriver<EvmOrderAndPayResult> & {
  client: MarketplaceEvmClient
  state(): EvmDriverState
  sweep(): Promise<string>
}

function tokenTag(chainId: number, token: AppTokenConfig): string {
  return `${chainId}:${token.address.toLowerCase()}`
}

function tagValue(template: EventTemplate, name: string): string | undefined {
  return template.tags.find(tag => tag[0] === name)?.[1]
}

function parseOrderContent(template: EventTemplate): marketplace.OrderContent {
  return JSON.parse(template.content) as marketplace.OrderContent
}

function withOrderContent(template: EventTemplate, content: marketplace.OrderContent): EventTemplate {
  return { ...template, content: JSON.stringify(content) }
}

function withParticipant(template: EventTemplate, pubkey: string, role: string): EventTemplate {
  const hasParticipant = template.tags.some(tag => tag[0] === 'p' && tag[1] === pubkey && tag[3] === role)
  if (hasParticipant) return template
  return { ...template, tags: [...template.tags, ['p', pubkey, '', role]] }
}

function tokenForAmount(config: AppConfig, amount: marketplace.MarketplaceAmount): AppTokenConfig {
  const token = config.evm.tokens.find(candidate => candidate.denomination === amount.denomination)
  if (!token) throw new Error(`No EVM token configured for ${amount.denomination}`)
  return token
}

function unlockAt(content: marketplace.OrderContent, maxDuration: number): bigint {
  if (content.end) {
    const parsed = Date.parse(content.end)
    if (Number.isFinite(parsed)) return BigInt(Math.floor(parsed / 1000))
  }
  return BigInt(Math.floor(Date.now() / 1000) + Math.max(maxDuration, 3600))
}

function proofOrderContent(options: {
  content: marketplace.OrderContent
  listing: marketplace.MarketplaceListing
  escrowMethod: marketplace.ParsedEscrowMethod
  escrowService: marketplace.ParsedEscrowService
  txHash?: EvmHash
  chainId: number
  contractAddress: Address
  tradeId: string
  buyerAddress: Address
  sellerAddress: Address
  arbiterAddress: Address
  tokenAddress: Address
  amount: marketplace.MarketplaceAmount
  stage: marketplace.OrderStage
}): marketplace.OrderContent {
  return {
    ...options.content,
    stage: options.stage,
    proof: {
      listing: options.listing.event,
      paymentProof: options.txHash
        ? {
            method: 'evm',
            params: {
              txHash: options.txHash,
              chainId: options.chainId,
              contractAddress: options.contractAddress,
              tradeId: options.tradeId,
              buyerAddress: options.buyerAddress,
              sellerAddress: options.sellerAddress,
              arbiterAddress: options.arbiterAddress,
              tokenAddress: options.tokenAddress,
              value: options.amount.value,
              denomination: options.amount.denomination,
              decimals: options.amount.decimals,
            },
          }
        : null,
      escrow: {
        escrowService: JSON.stringify(options.escrowService.event),
        sellerEscrowMethod: JSON.stringify(options.escrowMethod.event),
      },
    },
  }
}

export function evmPaymentForms(config: AppConfig): marketplace.AcceptedPaymentForm[] {
  return config.evm.tokens.map(token => ({
    denomination: token.denomination,
    tokenTagId: tokenTag(config.evm.chainId, token),
    appId: 'marketplace-evm-ts',
  }))
}

function chainConfig(config: AppConfig): EvmChainConfig {
  return {
    id: `evm-${config.evm.chainId}`,
    chainId: config.evm.chainId,
    name: config.evm.chainName,
    rpcUrl: config.evm.rpcUrl,
    publicClient: createPublicClient({
      chain: {
        id: config.evm.chainId,
        name: config.evm.chainName,
        nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
        rpcUrls: { default: { http: [config.evm.rpcUrl] } },
      },
      transport: http(config.evm.rpcUrl),
    }),
    nativeToken: {
      chainId: config.evm.chainId,
      address: '0x0000000000000000000000000000000000000000',
      denomination: 'ETH',
      decimals: 18,
    },
    tokens: config.evm.tokens.map(token => ({
      chainId: config.evm.chainId,
      address: token.address,
      denomination: token.denomination,
      decimals: token.decimals,
    })),
    accountAbstraction: {
      entryPointAddress: config.evm.entryPointAddress,
      entryPointVersion: '0.7',
      factoryAddress: config.evm.accountFactoryAddress,
      bundlerUrl: config.evm.bundlerUrl,
      ...(config.evm.paymasterUrl ? { paymasterUrl: config.evm.paymasterUrl } : {}),
      ...(config.evm.paymasterAddress ? { paymasterAddress: config.evm.paymasterAddress } : {}),
      userOperationReceiptTimeoutMs: 120_000,
    },
  }
}

function stateFromDiscovery(discovery: EvmHighWatermarkDiscovery, sweepSummary: string): EvmDriverState {
  return {
    enabled: true,
    started: true,
    maxUsedIndex: discovery.maxUsedIndex,
    nextTradeIndex: discovery.nextUnusedIndex,
    sweepSummary,
  }
}

export function createEvmMarketplaceDriver(config: AppConfig, seed: string): EvmMarketplaceDriver | null {
  if (!config.evm.enabled) return null
  const store = new LocalOperationStore()
  const chain = chainConfig(config)
  const client = createMarketplaceEvmClient({
    chains: [chain],
    operationStore: store,
    seed,
    boltz: config.evm.boltzApiUrl ? { apiUrl: config.evm.boltzApiUrl } : undefined,
  })

  let currentState: EvmDriverState = {
    enabled: true,
    started: false,
    maxUsedIndex: -1,
    nextTradeIndex: 0,
    sweepSummary: 'Not started',
  }

  async function sweep(): Promise<string> {
    const active = await store.list()
    const withdrawable = active.filter(record => record.status === 'completed' || record.status === 'refunded')
    return withdrawable.length === 0
      ? 'No locally cached withdrawable EVM balances found'
      : `${withdrawable.length} completed/refunded operations need withdrawal review`
  }

  return {
    method: 'evm',
    id: 'evm',
    client,
    state: () => currentState,
    sweep,
    async discoverHighWatermark(context) {
      if (!client.discoverHighWatermark) throw new Error('EVM high watermark discovery is unavailable')
      const discovery = await client.discoverHighWatermark({
        highWaterMark: context.highWaterMark,
        unusedWindow: context.unusedWindow,
      })
      return {
        driver: 'evm',
        maxUsedIndex: discovery.maxUsedIndex,
        nextUnusedIndex: discovery.nextUnusedIndex,
        scannedFrom: discovery.scannedFrom,
        scannedThrough: discovery.scannedThrough,
        unusedWindow: discovery.unusedWindow,
        usedIndexes: discovery.usedTradeIndexes,
        recoveryActions: discovery.recoveryActions,
      }
    },
    async start(context) {
      if (!client.discoverHighWatermark) throw new Error('EVM high watermark discovery is unavailable')
      const discovery = await client.discoverHighWatermark({
        highWaterMark: context.highWaterMark,
        unusedWindow: context.unusedWindow,
      })
      const sweepSummary = await sweep()
      currentState = stateFromDiscovery(discovery, sweepSummary)
      return { driver: 'evm', data: { sweepSummary } }
    },
    async canHandle({ escrowService }) {
      const params = escrowService.content.params
      const supported =
        escrowService.content.type === 'EVM' &&
        params.chainId === config.evm.chainId &&
        params.contractAddress.toLowerCase() === config.evm.multiEscrowAddress.toLowerCase()
      return {
        supported,
        score: supported ? 100 : 0,
        reason: supported ? 'EVM escrow service matches configured chain' : 'Unsupported EVM escrow service',
      }
    },
    async orderAndPay({ listing, escrowMethod, escrowService, orderDraft }) {
      const tradeId = tagValue(orderDraft, 'd')
      if (!tradeId) throw new Error('Order draft is missing trade id')
      if (!escrowMethod.evmAddress) throw new Error('Seller escrow method is missing an EVM address')
      const content = parseOrderContent(orderDraft)
      if (!content.amount) throw new Error('Order draft is missing payment amount')

      const token = tokenForAmount(config, content.amount)
      const tradeIndex = currentState.nextTradeIndex
      if (!client.accounts) throw new Error('EVM deterministic accounts are unavailable')
      const executor = client.accounts.executorForTradeIndex(tradeIndex)
      const buyerAddress = await executor.getAddress(config.evm.chainId)
      const sellerAddress = escrowMethod.evmAddress as Address
      const arbiterAddress = escrowService.content.params.arbiterAddress as Address
      const contractAddress = escrowService.content.params.contractAddress as Address
      const paymentAmount = {
        value: BigInt(content.amount.value),
        denomination: content.amount.denomination,
        decimals: token.decimals,
      }
      const escrowFee = marketplace.escrowServices.calculateFee(
        escrowService.content.fee,
        paymentAmount.value,
        token.denomination,
      )
      const calls = client.escrow.createTrade({
        tradeId,
        buyerAddress,
        sellerAddress,
        arbiterAddress,
        tokenAddress: token.address,
        paymentAmount,
        escrowFee: {
          value: escrowFee,
          denomination: token.denomination,
          decimals: token.decimals,
        },
        contractAddress,
        unlockAt: unlockAt(content, escrowService.content.maxDuration),
      })

      const balance = token.address.toLowerCase() === zeroAddress
        ? await chain.publicClient.getBalance({ address: buyerAddress })
        : (await chain.publicClient.readContract({
            address: token.address,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [buyerAddress],
          }) as bigint)
      const requiredBalance = paymentAmount.value + escrowFee
      const baseDraft = withParticipant(orderDraft, escrowService.event.pubkey, 'escrow')

      if (balance >= requiredBalance) {
        const execution = await executor.execute(calls, {
          chainId: config.evm.chainId,
          operationId: `escrow-${tradeId}`,
          waitForReceipt: true,
        })
        const validation = await client.escrow.validate({
          chainId: config.evm.chainId,
          txHash: execution.txHash,
          tradeId,
          contractAddress,
          contractBytecodeHash: configuredEscrowBytecodeHash(config),
          sellerAddress,
          arbiterAddress,
          tokenAddress: token.address,
          paymentAmount,
          escrowFee: {
            value: escrowFee,
            denomination: token.denomination,
            decimals: token.decimals,
          },
          minConfirmations: 1,
        })
        currentState = { ...currentState, nextTradeIndex: tradeIndex + 1, maxUsedIndex: Math.max(currentState.maxUsedIndex, tradeIndex) }
        return {
          type: 'escrow-funded',
          orderDraft: withOrderContent(baseDraft, proofOrderContent({
            content,
            listing,
            escrowMethod,
            escrowService,
            txHash: execution.txHash,
            chainId: config.evm.chainId,
            contractAddress,
            tradeId,
            buyerAddress,
            sellerAddress,
            arbiterAddress,
            tokenAddress: token.address,
            amount: { ...content.amount, decimals: token.decimals },
            stage: 'commit',
          })),
          tradeIndex,
          txHash: execution.txHash,
          validationStatus: validation.status,
          buyerAddress,
        } satisfies EvmOrderAndPayResult
      }

      if (!client.swaps || !token.boltzCurrency) {
        throw new Error(`Insufficient ${token.denomination} balance and no Boltz swap route is configured`)
      }

      const swap = await client.swaps.swapIn({
        tradeIndex,
        attemptIndex: 0,
        chainId: config.evm.chainId,
        boltzCurrency: token.boltzCurrency,
        tokenAddress: token.address,
        amount: paymentAmount,
        description: `Marketplace escrow ${tradeId}`,
        postClaimCalls: calls,
      })
      if (swap.type !== 'external_payment_required') throw new Error('Unexpected swap-in result')
      currentState = { ...currentState, nextTradeIndex: tradeIndex + 1, maxUsedIndex: Math.max(currentState.maxUsedIndex, tradeIndex) }
      return {
        type: 'external-payment-required',
        orderDraft: withOrderContent(baseDraft, proofOrderContent({
          content,
          listing,
          escrowMethod,
          escrowService,
          chainId: config.evm.chainId,
          contractAddress,
          tradeId,
          buyerAddress,
          sellerAddress,
          arbiterAddress,
          tokenAddress: token.address,
          amount: { ...content.amount, decimals: token.decimals },
          stage: 'negotiate',
        })),
        tradeIndex,
        invoice: swap.invoice,
        swapId: swap.swapId,
        preimageHash: swap.preimageHash,
        buyerAddress,
      }
    },
  }
}

export function configuredEscrowBytecodeHash(config: AppConfig): `0x${string}` {
  return config.evm.multiEscrowBytecodeHash ?? multiEscrowRuntimeBytecodeHash
}
