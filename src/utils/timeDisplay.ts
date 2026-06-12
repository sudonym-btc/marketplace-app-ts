export function formatDateTime(seconds: number | undefined): string {
  if (seconds === undefined) return 'Not set'
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(seconds * 1000))
}
