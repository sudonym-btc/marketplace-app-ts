import type { MarketplaceLogItem } from '../../types'
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '../ui'

type MarketplaceLogPanelProps = {
  entries: MarketplaceLogItem[]
  onClear(): void
}

function stringifyLogValue(value: unknown): string {
  return JSON.stringify(value, (_key, item) => {
    if (typeof item === 'bigint') return item.toString()
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
        stack: item.stack,
      }
    }
    return item
  }, 2)
}

function logBadgeVariant(level: MarketplaceLogItem['level']): 'default' | 'secondary' | 'destructive' {
  if (level === 'error') return 'destructive'
  if (level === 'warn') return 'secondary'
  return 'default'
}

export function MarketplaceLogPanel({ entries, onClear }: MarketplaceLogPanelProps) {
  return (
    <Card className="col-span-2 max-[860px]:col-span-1">
      <CardHeader className="flex flex-row items-center justify-between gap-3">
        <CardTitle>Marketplace log</CardTitle>
        <Button disabled={entries.length === 0} size="sm" type="button" variant="secondary" onClick={onClear}>
          Clear
        </Button>
      </CardHeader>
      <CardContent>
        {entries.length === 0 ? (
          <p className="m-0 text-sm text-muted-foreground">No marketplace log entries yet.</p>
        ) : (
          <div className="max-h-[440px] overflow-auto rounded-lg border bg-muted/30">
            {entries.map(entry => (
              <article className="grid gap-2 border-b p-3 last:border-b-0" key={entry.id}>
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge variant={logBadgeVariant(entry.level)}>{entry.level}</Badge>
                  <time className="text-xs text-muted-foreground">{new Date(entry.at).toLocaleString()}</time>
                  <code className="min-w-0 rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                    {entry.scope}
                  </code>
                  {entry.span && (
                    <code className="min-w-0 rounded bg-background px-1.5 py-0.5 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                      {entry.span}
                    </code>
                  )}
                </div>
                <p className="m-0 text-sm font-medium leading-6">{entry.message}</p>
                {Boolean(entry.data || entry.error) && (
                  <pre className="m-0 max-h-56 overflow-auto rounded-md bg-background p-3 text-xs leading-5 text-foreground whitespace-pre-wrap [overflow-wrap:anywhere]">
                    {stringifyLogValue({ ...(entry.data ? { data: entry.data } : {}), ...(entry.error ? { error: entry.error } : {}) })}
                  </pre>
                )}
              </article>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
