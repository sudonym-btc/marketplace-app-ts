import { useEffect, useState } from 'react'
import * as marketplaceSdk from 'nostr-tools/marketplace'

import type { AuctionListingResolution, MarketplaceClient, MarketplaceSession } from '../../types'
import { EmptyState } from '../EmptyState'
import { AuctionCard } from './AuctionCard'

type AuctionWidgetProps = {
  auctionAnchor: string
  marketplace?: MarketplaceClient
  marketplaceSession?: MarketplaceSession
  refreshRevision?: number
}

type AuctionWidgetState =
  | { status: 'loading'; row?: undefined; error?: undefined }
  | { status: 'loaded'; row: AuctionListingResolution; error?: undefined }
  | { status: 'error'; row?: undefined; error: string }

export function AuctionWidget({ auctionAnchor, marketplace, marketplaceSession, refreshRevision = 0 }: AuctionWidgetProps) {
  const [state, setState] = useState<AuctionWidgetState>({ status: 'loading' })
  const [liveSnapshot, setLiveSnapshot] = useState<marketplaceSdk.MarketplaceAuctionScopeSnapshot>()
  const [backfillComplete, setBackfillComplete] = useState(false)

  useEffect(() => {
    if (!marketplace) {
      setState({ status: 'error', error: 'Marketplace session is not ready' })
      return undefined
    }

    let closed = false
    setState({ status: 'loading' })
    setLiveSnapshot(undefined)
    setBackfillComplete(false)

    const stream = marketplace.auctions.watch({ auctionAnchor }, {
      maxWait: 2500,
    })

    async function applySnapshot(snapshot: marketplaceSdk.MarketplaceAuctionScopeSnapshot): Promise<void> {
      setLiveSnapshot(snapshot)
      if (!snapshot.auction) return
      try {
        const listing = await marketplace!.listings.findByAnchor(snapshot.auction.listingAnchor)
        if (closed) return
        setState({
          status: 'loaded',
          row: {
            auction: snapshot.auction,
            listing,
            snapshot,
          },
        })
      } catch (err) {
        if (!closed) {
          setState({
            status: 'error',
            error: err instanceof Error ? err.message : 'Unable to load auction listing',
          })
        }
      }
    }

    const snapshotSubscription = stream.snapshot.subscribe(snapshots => {
      const snapshot = snapshots[auctionAnchor]
      if (!snapshot) return
      void applySnapshot(snapshot)
    })
    const statusSubscription = stream.status.subscribe(status => {
      if (status instanceof marketplaceSdk.StreamEose || status instanceof marketplaceSdk.StreamLive) {
        setBackfillComplete(true)
        if (!stream.currentSnapshot?.[auctionAnchor]?.auction) {
          setState(current => current.status === 'loaded'
            ? current
            : { status: 'error', error: 'Auction event not loaded' })
        }
      }
      if (status instanceof marketplaceSdk.StreamError) {
        setState({ status: 'error', error: status.error.message })
      }
    })

    return () => {
      closed = true
      snapshotSubscription.unsubscribe()
      statusSubscription.unsubscribe()
      stream.close('auction widget changed')
    }
  }, [auctionAnchor, marketplace, refreshRevision])

  if (state.status === 'loading') {
    return <EmptyState title="Loading auction" body="Fetching auction details." />
  }

  if (state.status === 'error') {
    return <EmptyState title="Unable to load auction" body={state.error} />
  }

  return (
    <AuctionCard
      backfillComplete={backfillComplete}
      marketplaceSession={marketplaceSession}
      row={state.row}
      snapshot={liveSnapshot ?? state.row.snapshot}
    />
  )
}
