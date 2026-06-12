import { Star } from 'lucide-react'
import type * as marketplace from 'nostr-tools/marketplace'

import { ProfileChip } from '../ProfileChip'
import { Badge, Card, CardContent, CardHeader, CardTitle, cn } from '../ui'
import type { NostrProfile } from '../../nostr/profiles'
import { useScrollBatch } from '../../hooks/useScrollBatch'
import { ScrollBatchStatus } from './ScrollBatchStatus'

export type ListingReviewItem = {
  review: marketplace.ParsedReview
  buyerPubkey?: string
}

type ListingReviewsProps = {
  reviews: ListingReviewItem[]
  profiles: Map<string, NostrProfile>
  loading: boolean
  error?: string
}

function clampRating(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(5, value * 5))
}

function reviewDate(review: marketplace.ParsedReview): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(review.event.created_at * 1000))
}

function RatingStars({ rating }: { rating: number }) {
  const stars = clampRating(rating)
  const filled = Math.round(stars)

  return (
    <span className="inline-flex items-center gap-1" aria-label={`${stars.toFixed(1)} out of 5 stars`}>
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          aria-hidden="true"
          className={cn('size-4 text-muted-foreground', index < filled && 'fill-primary text-primary')}
          key={index}
        />
      ))}
      <span className="ml-1 text-xs font-medium text-muted-foreground">{stars.toFixed(1)}</span>
    </span>
  )
}

function ReviewCard({ item, profile }: { item: ListingReviewItem; profile?: NostrProfile }) {
  const { review, buyerPubkey } = item

  return (
    <Card size="sm">
      <CardContent className="grid gap-3">
        <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
          {buyerPubkey ? (
            <ProfileChip pubkey={buyerPubkey} profile={profile} />
          ) : (
            <Badge variant="secondary">Buyer not revealed</Badge>
          )}
          <div className="flex shrink-0 flex-col items-end gap-1">
            <RatingStars rating={review.rating} />
            <time className="text-xs text-muted-foreground">{reviewDate(review)}</time>
          </div>
        </div>
        <p className="m-0 text-sm leading-6 text-foreground">
          {review.content.trim() || 'No written comment.'}
        </p>
      </CardContent>
    </Card>
  )
}

export function ListingReviews({ error, loading, profiles, reviews }: ListingReviewsProps) {
  const { hasMore, loadNextBatch, sentinelRef, visibleCount } = useScrollBatch(reviews.length, { batchSize: 4 })
  const visibleReviews = reviews.slice(0, visibleCount)

  return (
    <section className="mt-6 grid gap-3">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-medium uppercase tracking-normal text-muted-foreground">Reviews</p>
          <h2 className="m-0 text-lg font-medium">Buyer reviews</h2>
        </div>
        {reviews.length > 0 && <Badge variant="secondary">{reviews.length}</Badge>}
      </div>
      {loading && reviews.length === 0 ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Loading reviews</CardTitle>
          </CardHeader>
        </Card>
      ) : error ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Reviews unavailable</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="m-0 text-sm leading-6 text-destructive">{error}</p>
          </CardContent>
        </Card>
      ) : reviews.length === 0 ? (
        <Card size="sm">
          <CardContent>
            <p className="m-0 text-sm leading-6 text-muted-foreground">No reviews for this classified yet.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-3">
            {visibleReviews.map(item => (
              <ReviewCard
                item={item}
                key={item.review.event.id}
                profile={item.buyerPubkey ? profiles.get(item.buyerPubkey) : undefined}
              />
            ))}
          </div>
          <ScrollBatchStatus
            ref={sentinelRef}
            hasMore={hasMore}
            itemLabel="reviews"
            onLoadMore={loadNextBatch}
            totalCount={reviews.length}
            visibleCount={visibleCount}
          />
        </>
      )}
    </section>
  )
}
