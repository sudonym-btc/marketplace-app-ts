import { useEffect, useMemo, useState } from 'react'
import * as marketplaceSdk from 'nostr-tools/marketplace'

import { CodeHint } from '../codeHints/codeHints'
import { EmptyState } from '../components/EmptyState'
import { AuctionCard } from '../components/widgets/AuctionCard'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import { ScrollBatchStatus } from '../components/widgets/ScrollBatchStatus'
import { useScrollBatch } from '../hooks/useScrollBatch'
import { fetchProfiles, type NostrProfile } from '../nostr/profiles'
import type { AppSession, AuctionListingResolution, MarketplaceSession } from '../types'

type Props = {
  marketplace: ReturnType<typeof marketplaceSdk.bind>
  rows: AuctionListingResolution[]
  marketplaceSession?: MarketplaceSession
  session?: AppSession
  loading?: boolean
  error?: string
}

const auctionListHint = `const auctions = await marketplace.auctions.search({ limit: 80 })

const auctionSnapshots = await Promise.all(auctions.map(async auction => {
  const snapshots = await marketplace.auctions.get({
    auctionAnchor: auction.auctionAnchor,
  })
  return snapshots[auction.auctionAnchor]
}))`

export function AuctionsPage({ marketplace, marketplaceSession, rows, session, loading = false, error }: Props) {
  const { hasMore, loadNextBatch, sentinelRef, visibleCount } = useScrollBatch(rows.length, { batchSize: 4 })
  const visibleRows = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount])
  const [liveSnapshots, setLiveSnapshots] = useState<Record<string, marketplaceSdk.MarketplaceAuctionScopeSnapshot>>({})
  const [eoseByAuction, setEoseByAuction] = useState<Record<string, boolean>>({})
  const [arbiterProfiles, setArbiterProfiles] = useState<Map<string, NostrProfile>>(() => new Map())
  const visibleAnchors = useMemo(
    () => visibleRows.map(row => row.auction.auctionAnchor).join('|'),
    [visibleRows],
  )
  const visibleArbiterPubkeys = useMemo(
    () => [...new Set(visibleRows.map(row => row.auction.arbiterPubkey).filter(Boolean))],
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
    if (!session || visibleArbiterPubkeys.length === 0) {
      setArbiterProfiles(new Map())
      return
    }

    let closed = false
    void fetchProfiles(session, visibleArbiterPubkeys)
      .then(profiles => {
        if (!closed) setArbiterProfiles(profiles)
      })
      .catch(err => {
        console.warn('[marketplace-app] unable to fetch auction arbiter profiles', { pubkeyCount: visibleArbiterPubkeys.length }, err)
        if (!closed) setArbiterProfiles(new Map())
      })

    return () => {
      closed = true
    }
  }, [session, visibleArbiterPubkeys])

  useEffect(() => {
    const closers = visibleRows.map(row => {
      const anchor = row.auction.auctionAnchor
      const stream = marketplace.auctions.watch({ auctionAnchor: anchor }, { maxWait: 2500 })
      const snapshotSubscription = stream.snapshot.subscribe(snapshots => {
        const snapshot = snapshots[anchor]
        if (!snapshot) return
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
        code={auctionListHint}
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
                    arbiterProfile={arbiterProfiles.get(row.auction.arbiterPubkey)}
                    backfillComplete={Boolean(eoseByAuction[row.auction.auctionAnchor])}
                    key={row.auction.auctionAnchor}
                    marketplaceSession={marketplaceSession}
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
