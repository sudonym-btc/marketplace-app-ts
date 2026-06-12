import { useMemo, useState } from 'react'
import type * as marketplace from 'nostr-tools/marketplace'
import { Link } from '@tanstack/react-router'
import { SearchIcon, XIcon } from 'lucide-react'

import { CodeHint } from '../codeHints/codeHints'
import { EmptyState } from '../components/EmptyState'
import { ListingCard } from '../components/ListingCard'
import { Badge, Button } from '../components/ui'
import { ListingSearchDialog, type ListingSearchValues } from '../components/widgets/ListingSearchDialog'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import { ScrollBatchStatus } from '../components/widgets/ScrollBatchStatus'
import { useScrollBatch } from '../hooks/useScrollBatch'

type Props = {
  listings: marketplace.MarketplaceListing[]
  signedIn: boolean
  label?: string
  title?: string
  emptyTitle?: string
  emptyBody?: string
  loading?: boolean
  error?: string
  marketplace?: ReturnType<typeof marketplace.bind>
  editable?: boolean
}

export function ListingsPage({
  listings,
  marketplace,
  editable = false,
  signedIn,
  label = 'Classifieds',
  title = 'Listings',
  emptyTitle = 'No listings loaded',
  emptyBody = 'Refresh relays or publish the first listing.',
  loading = false,
  error,
}: Props) {
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchValues, setSearchValues] = useState<ListingSearchValues>()
  const [searchResults, setSearchResults] = useState<marketplace.MarketplaceListing[] | null>(null)
  const [searchError, setSearchError] = useState<string>()
  const [searching, setSearching] = useState(false)
  const activeListings = searchResults ?? listings
  const { hasMore, loadNextBatch, sentinelRef, visibleCount } = useScrollBatch(activeListings.length, { batchSize: 6 })
  const visibleListings = activeListings.slice(0, visibleCount)
  const codeHint = useMemo(() => {
    if (!searchValues) return 'marketplace.listings.search({ limit: 80 })'
    const parts = [
      searchValues.categories.length ? `profiles: ${JSON.stringify(searchValues.categories)}` : '',
      searchValues.location ? 'tagFilters: { g: h3Cells }' : '',
    ].filter(Boolean)
    return `marketplace.listings.search({ ${parts.join(', ') || 'limit: 80'}, limit: 80 })`
  }, [searchValues])

  async function searchListings(values: ListingSearchValues): Promise<void> {
    if (!marketplace) return
    const categories = values.categories.map(category => category.trim()).filter(Boolean)
    const location = values.location.trim()
    if (!location && categories.length === 0) {
      clearSearch()
      return
    }

    setSearching(true)
    setSearchError(undefined)
    try {
      const locationTags = location ? await marketplace.locations.coverArea(location) : []
      const h3 = locationTags.map(tag => tag[1])
      const tagFilters = h3.length > 0 ? { g: h3 } : undefined
      const results = await marketplace.listings.search({
        ...(categories.length > 0 ? { profiles: categories } : {}),
        ...(tagFilters ? { tagFilters } : {}),
        limit: 80,
      })
      setSearchValues({ categories, location })
      setSearchResults(results)
      setSearchOpen(false)
    } catch (err) {
      setSearchError(err instanceof Error ? err.message : 'Unable to search listings')
    } finally {
      setSearching(false)
    }
  }

  function clearSearch(): void {
    setSearchValues(undefined)
    setSearchResults(null)
    setSearchError(undefined)
    setSearchOpen(false)
  }

  return (
    <Page>
      <PageHeader
        actions={(
          <div className="flex flex-wrap gap-2">
            {marketplace && (
              <Button variant="outline" onClick={() => setSearchOpen(true)}>
                <SearchIcon />
                Search
              </Button>
            )}
            <Button asChild>
              <Link to={signedIn ? '/edit-listing' : '/login'}>
                {signedIn ? 'Add listing' : 'Sign in to add listing'}
              </Link>
            </Button>
          </div>
        )}
        eyebrow={label}
        title={title}
      />
      <ListingSearchDialog
        error={searchError}
        loading={searching}
        open={searchOpen}
        values={searchValues}
        onClear={clearSearch}
        onOpenChange={setSearchOpen}
        onSubmit={searchListings}
      />
      {searchValues && (
        <div className="flex flex-wrap items-center gap-2">
          {searchValues.location && <Badge variant="secondary">{searchValues.location}</Badge>}
          {searchValues.categories.map(category => <Badge key={category} variant="secondary">{category}</Badge>)}
          <Button size="xs" variant="ghost" onClick={clearSearch}>
            <XIcon />
            Clear
          </Button>
        </div>
      )}
      <CodeHint
        code={codeHint}
        className="rounded-xl"
      >
        {activeListings.length === 0 ? (
          <EmptyState
            title={error ? 'Unable to load listings' : loading ? 'Loading listings' : searchValues ? 'No matching listings' : emptyTitle}
            body={error ?? (loading ? 'Checking marketplace relays.' : searchValues ? 'Try a different location or product category.' : emptyBody)}
          />
        ) : (
          <>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] gap-4">
              {visibleListings.map(listing => (
                <div className="grid gap-2" key={listing.event.id}>
                  <ListingCard listing={listing} />
                  {editable && (
                    <Button asChild size="sm" variant="secondary">
                      <Link search={{ listingId: listing.event.id }} to="/edit-listing">
                        Edit listing
                      </Link>
                    </Button>
                  )}
                </div>
              ))}
            </div>
            <ScrollBatchStatus
              ref={sentinelRef}
              hasMore={hasMore}
              itemLabel="listings"
              onLoadMore={loadNextBatch}
              totalCount={activeListings.length}
              visibleCount={visibleCount}
            />
          </>
        )}
      </CodeHint>
    </Page>
  )
}
