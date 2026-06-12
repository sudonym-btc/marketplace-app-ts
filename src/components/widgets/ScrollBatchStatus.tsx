import { forwardRef } from 'react'

import { Button } from '../ui'

type ScrollBatchStatusProps = {
  hasMore: boolean
  itemLabel: string
  onLoadMore(): void
  totalCount: number
  visibleCount: number
}

export const ScrollBatchStatus = forwardRef<HTMLDivElement, ScrollBatchStatusProps>(function ScrollBatchStatus({
  hasMore,
  itemLabel,
  onLoadMore,
  totalCount,
  visibleCount,
}, ref) {
  if (totalCount === 0) return null

  return (
    <div
      ref={ref}
      className="flex min-h-14 flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground"
    >
      {hasMore ? (
        <>
          <Button onClick={onLoadMore} type="button" variant="secondary">
            Load more {itemLabel}
          </Button>
          <span>{visibleCount} of {totalCount}</span>
        </>
      ) : (
        <span>{visibleCount} of {totalCount} {itemLabel}</span>
      )}
    </div>
  )
})
