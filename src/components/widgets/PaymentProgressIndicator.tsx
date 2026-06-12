import { LoadingSpinner } from '../LoadingSpinner'

type PaymentProgressIndicatorProps = {
  label: string
}

export function PaymentProgressIndicator({ label }: PaymentProgressIndicatorProps) {
  return (
    <div className="grid justify-items-center gap-3 rounded-lg border bg-muted/50 p-6 text-center">
      <LoadingSpinner label={label} />
      <p className="m-0 text-sm text-muted-foreground">{label}</p>
    </div>
  )
}
