import type { EvmMarketplaceChainConfig } from '@sudonym-btc/marketplace-evm'
import type { AppConfig } from '../config/appConfig'

export function createEvmChainConfigs(config: AppConfig): EvmMarketplaceChainConfig[] {
  if (!config.evm.enabled) return []

  return [
    {
      id: `evm-${config.evm.chainId}`,
      chainId: config.evm.chainId,
      name: config.evm.chainName,
      rpcUrl: config.evm.rpcUrl,
      nativeAsset: {
        chainId: config.evm.chainId,
        address: '0x0000000000000000000000000000000000000000',
        denomination: 'ETH',
        decimals: 18,
      },
      assets: config.evm.assets.map(asset => ({
        chainId: config.evm.chainId,
        address: asset.address,
        denomination: asset.denomination,
        decimals: asset.decimals,
        ...(asset.boltzCurrency ? { boltzCurrency: asset.boltzCurrency } : {}),
      })),
      ...(config.evm.boltzApiUrl ? { boltz: { apiUrl: config.evm.boltzApiUrl } } : {}),
      accountAbstraction: {
        entryPointAddress: config.evm.entryPointAddress,
        entryPointVersion: '0.7',
        factoryAddress: config.evm.accountFactoryAddress,
        bundlerUrl: config.evm.bundlerUrl,
        ...(config.evm.paymasterUrl ? { paymasterUrl: config.evm.paymasterUrl } : {}),
        ...(config.evm.paymasterAddress ? { paymasterAddress: config.evm.paymasterAddress } : {}),
        userOperationReceiptTimeoutMs: 120_000,
      },
      multiEscrowAddress: config.evm.multiEscrowAddress,
      ...(config.evm.multiEscrowBytecodeHash ? { multiEscrowBytecodeHash: config.evm.multiEscrowBytecodeHash } : {}),
      ...(config.evm.multiAuctionAddress ? { multiAuctionAddress: config.evm.multiAuctionAddress } : {}),
      ...(config.evm.multiAuctionBytecodeHash ? { multiAuctionBytecodeHash: config.evm.multiAuctionBytecodeHash } : {}),
    },
  ]
}
