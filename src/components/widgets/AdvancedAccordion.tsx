import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronDownIcon } from 'lucide-react'

import { cn } from '../ui'

type AdvancedAccordionProps = {
  children: ReactNode
  className?: string
  defaultOpen?: boolean
  summary?: ReactNode
  title?: string
}

export function AdvancedAccordion({
  children,
  className,
  defaultOpen = false,
  summary,
  title = 'Advanced',
}: AdvancedAccordionProps) {
  const contentId = useId()
  const [open, setOpen] = useState(defaultOpen)

  return (
    <section className={cn('rounded-lg border border-border bg-muted/20', className)}>
      <button
        aria-controls={contentId}
        aria-expanded={open}
        className="flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        type="button"
        onClick={() => setOpen(current => !current)}
      >
        <span className="grid min-w-0 gap-1">
          <span className="text-sm font-medium leading-none">{title}</span>
          {summary && <span className="truncate text-xs leading-5 text-muted-foreground">{summary}</span>}
        </span>
        <ChevronDownIcon
          aria-hidden="true"
          className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="grid gap-4 border-t border-border p-3" id={contentId}>
          {children}
        </div>
      )}
    </section>
  )
}
