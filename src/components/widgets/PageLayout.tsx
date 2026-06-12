import type { HTMLAttributes, ReactNode } from 'react'

import { cn } from '@/lib/utils'
import { Eyebrow } from './Eyebrow'

type PageProps = HTMLAttributes<HTMLElement> & {
  narrow?: boolean
}

type PageHeaderProps = {
  actions?: ReactNode
  eyebrow?: ReactNode
  title: ReactNode
}

export function Page({ className, narrow, ...props }: PageProps) {
  return <section className={cn('grid gap-6 p-7', narrow && 'max-w-5xl', className)} {...props} />
}

export function PageHeader({ actions, eyebrow, title }: PageHeaderProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-5">
      <div className="min-w-0">
        {eyebrow && <Eyebrow className="mb-2">{eyebrow}</Eyebrow>}
        <h1 className="text-3xl font-medium leading-tight">{title}</h1>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
