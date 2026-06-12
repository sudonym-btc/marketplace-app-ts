import { useCallback, useEffect, useRef, useState } from 'react'

type ScrollBatchOptions = {
  batchSize?: number
  rootMargin?: string
}

export function useScrollBatch(totalCount: number, {
  batchSize = 12,
  rootMargin = '120px 0px',
}: ScrollBatchOptions = {}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState(() => Math.min(batchSize, totalCount))

  useEffect(() => {
    setVisibleCount(current => {
      if (totalCount === 0) return 0
      if (current === 0) return Math.min(batchSize, totalCount)
      if (current > totalCount) return Math.min(current, totalCount)
      return Math.min(Math.max(current, batchSize), totalCount)
    })
  }, [batchSize, totalCount])

  const loadNextBatch = useCallback(() => {
    setVisibleCount(current => Math.min(current + batchSize, totalCount))
  }, [batchSize, totalCount])

  const hasMore = visibleCount < totalCount

  useEffect(() => {
    if (!hasMore) return undefined
    const sentinel = sentinelRef.current
    if (!sentinel) return undefined

    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) loadNextBatch()
    }, { rootMargin })

    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasMore, loadNextBatch, rootMargin])

  return {
    hasMore,
    loadNextBatch,
    sentinelRef,
    visibleCount,
  }
}
