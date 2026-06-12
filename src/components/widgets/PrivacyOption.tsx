import { Checkbox } from '../ui'

type PrivacyOptionProps = {
  id: string
  label: string
  description?: string
  checked: boolean
  disabled?: boolean
  onChange(checked: boolean): void
}

export function PrivacyOption({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: PrivacyOptionProps) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-border bg-muted/30 p-3">
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled}
        onCheckedChange={value => onChange(value === true)}
      />
      <label htmlFor={id} className="grid gap-1 text-sm">
        <span className="font-medium leading-none">{label}</span>
        {description && <span className="text-muted-foreground">{description}</span>}
      </label>
    </div>
  )
}
