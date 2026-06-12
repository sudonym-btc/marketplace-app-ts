import type { HTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

export function Eyebrow({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
  return (
    <span
      className={cn('block text-xs font-medium uppercase leading-none tracking-wide text-muted-foreground', className)}
      {...props}
    />
  )
}
