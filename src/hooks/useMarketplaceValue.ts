import { useSyncExternalStore } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'

export function useMarketplaceValue<T>(value?: marketplace.MarketplaceValue<T>): T | undefined {
  return useSyncExternalStore(
    onStoreChange => {
      if (!value) return () => {}
      const subscription = value.subscribe(() => onStoreChange(), { replay: false })
      return () => subscription.unsubscribe()
    },
    () => value?.value,
    () => value?.value,
  )
}
