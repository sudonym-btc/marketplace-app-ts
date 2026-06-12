import { useEffect, useMemo, useState } from 'react'
import * as marketplaceSdk from 'nostr-tools/marketplace'

import { CodeHint } from '../codeHints/codeHints'
import { EmptyState } from '../components/EmptyState'
import { AuctionCard } from '../components/widgets/AuctionCard'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import { ScrollBatchStatus } from '../components/widgets/ScrollBatchStatus'
import { useScrollBatch } from '../hooks/useScrollBatch'
import type { AuctionListingResolution } from '../types'

type Props = {
  marketplace: ReturnType<typeof marketplaceSdk.bind>
  rows: AuctionListingResolution[]
  loading?: boolean
  error?: string
}

export function AuctionsPage({ marketplace, rows, loading = false, error }: Props) {
  const { hasMore, loadNextBatch, sentinelRef, visibleCount } = useScrollBatch(rows.length, { batchSize: 4 })
  const visibleRows = rows.slice(0, visibleCount)
  const [liveSnapshots, setLiveSnapshots] = useState<Record<string, marketplaceSdk.MarketplaceAuctionScopeSnapshot>>({})
  const [eoseByAuction, setEoseByAuction] = useState<Record<string, boolean>>({})
  const visibleAnchors = useMemo(
    () => visibleRows.map(row => row.auction.auctionAnchor).join('|'),
    [visibleRows],
  )

  useEffect(() => {
    setLiveSnapshots(Object.fromEntries(
      rows
        .filter((row): row is AuctionListingResolution & { snapshot: marketplaceSdk.MarketplaceAuctionScopeSnapshot } =>
          Boolean(row.snapshot),
        )
        .map(row => [row.auction.auctionAnchor, row.snapshot]),
    ))
    setEoseByAuction({})
  }, [rows])

  useEffect(() => {
    const closers = visibleRows.map(row => {
      const anchor = row.auction.auctionAnchor
      const stream = marketplace.auctions.scope({ auctionAnchor: anchor }).stream({ maxWait: 2500 })
      const snapshotSubscription = stream.snapshot.subscribe(snapshot => {
        setLiveSnapshots(current => ({
          ...current,
          [anchor]: snapshot,
        }))
      })
      const statusSubscription = stream.status.subscribe(status => {
        if (status instanceof marketplaceSdk.StreamEose || status instanceof marketplaceSdk.StreamLive) {
          setEoseByAuction(current => ({
            ...current,
            [anchor]: true,
          }))
        }
      })
      return {
        close(reason?: string) {
          snapshotSubscription.unsubscribe()
          statusSubscription.unsubscribe()
          stream.close(reason)
        },
      }
    })
    return () => {
      for (const closer of closers) closer.close('auction page scope changed')
    }
  }, [marketplace, visibleAnchors])

  return (
    <Page>
      <PageHeader eyebrow="Auctions" title="Auctions" />
      <CodeHint
        code={[
          'marketplace.auctions.scope({ auctionAnchor }).query({ maxWait: 2500 })',
          'marketplace.auctions.scope({ auctionAnchor }).stream({ maxWait: 2500 })',
          'auctionScope.filter(marketplace.auctionScopes.isBid)',
        ]}
        className="rounded-xl"
      >
        {rows.length === 0 ? (
          <EmptyState
            title={error ? 'Unable to load auctions' : loading ? 'Loading auctions' : 'No auctions loaded'}
            body={error ?? (loading ? 'Checking marketplace relays.' : 'Refresh relays or schedule an auction from one of your listings.')}
          />
        ) : (
          <>
            <div className="grid gap-4">
              {visibleRows.map(row => {
                const snapshot = liveSnapshots[row.auction.auctionAnchor] ?? row.snapshot
                return (
                  <AuctionCard
                    backfillComplete={Boolean(eoseByAuction[row.auction.auctionAnchor])}
                    key={row.auction.auctionAnchor}
                    row={row}
                    snapshot={snapshot}
                  />
                )
              })}
            </div>
            <ScrollBatchStatus
              ref={sentinelRef}
              hasMore={hasMore}
              itemLabel="auctions"
              onLoadMore={loadNextBatch}
              totalCount={rows.length}
              visibleCount={visibleCount}
            />
          </>
        )}
      </CodeHint>
    </Page>
  )
}
