import { cn } from '../ui'

type PaymentFlowStatus = 'idle' | 'working' | 'success' | 'error'

type PaymentStatusPanelProps = {
  status: PaymentFlowStatus
  error?: string
  hasInvoice: boolean
  labels: {
    successTitle: string
    errorTitle: string
    invoiceTitle: string
    workingTitle: string
    successBody: string
    errorBody: string
    invoiceBody: string
    workingBody: string
  }
}

export function PaymentStatusPanel({ error, hasInvoice, labels, status }: PaymentStatusPanelProps) {
  if (status === 'idle') return null

  const title = status === 'success'
    ? labels.successTitle
    : status === 'error'
      ? labels.errorTitle
      : hasInvoice
        ? labels.invoiceTitle
        : labels.workingTitle
  const body = status === 'success'
    ? labels.successBody
    : status === 'error'
      ? error ?? labels.errorBody
      : hasInvoice
        ? labels.invoiceBody
        : labels.workingBody

  return (
    <div
      className={cn(
        'grid gap-1 rounded-md border p-3 text-sm leading-6',
        status === 'success' && 'border-border bg-muted/50 text-foreground',
        status === 'error' && 'border-destructive/20 bg-card text-destructive',
        status === 'working' && 'border-border bg-muted/50 text-foreground',
      )}
      role={status === 'error' ? 'alert' : 'status'}
    >
      <strong>{title}</strong>
      <p className="m-0">{body}</p>
    </div>
  )
}
