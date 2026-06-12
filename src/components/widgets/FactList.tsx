import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'

type Fact = {
  label: ReactNode
  value: ReactNode
}

type FactListProps = HTMLAttributes<HTMLDListElement> & {
  compact?: boolean
  facts: Fact[]
}

export function Facts({ className, compact, facts, ...props }: FactListProps) {
  return (
    <dl className={cn('grid gap-3', compact ? 'grid-cols-1' : 'grid-cols-[repeat(auto-fit,minmax(140px,1fr))]', className)} {...props}>
      {facts.map(fact => (
        <div className="min-w-0" key={String(fact.label)}>
          <dt className="mb-1 text-[11px] font-medium uppercase leading-none tracking-wide text-muted-foreground">
            {fact.label}
          </dt>
          <dd className="m-0 text-sm font-medium [overflow-wrap:anywhere]">{fact.value}</dd>
        </div>
      ))}
    </dl>
  )
}
