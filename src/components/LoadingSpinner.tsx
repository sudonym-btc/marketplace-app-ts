type LoadingSpinnerProps = {
  label?: string
}

export function LoadingSpinner({ label = 'Loading' }: LoadingSpinnerProps) {
  return (
    <span
      aria-label={label}
      className="inline-block size-4 animate-spin rounded-full border-2 border-muted border-t-primary"
      role="status"
    />
  )
}
