import type { ReactNode } from 'react'

import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

type FieldProps = {
  className?: string
  description?: ReactNode
  label: ReactNode
  children: ReactNode
}

export function Field({ children, className, description, label }: FieldProps) {
  return (
    <Label className={cn('grid items-start gap-2', className)}>
      <span>{label}</span>
      {children}
      {description && <span className="text-xs font-normal leading-5 text-muted-foreground">{description}</span>}
    </Label>
  )
}

export function CheckboxField({
  children,
  className,
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  children: ReactNode
  className?: string
  disabled?: boolean
  onChange(event: { target: { checked: boolean } }): void
}) {
  return (
    <Label className={cn('flex items-center gap-2', className)}>
      <Checkbox
        checked={checked}
        disabled={disabled}
        onCheckedChange={value => onChange({ target: { checked: value === true } })}
      />
      <span>{children}</span>
    </Label>
  )
}
