import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { PlusIcon, RefreshCwIcon, Trash2Icon } from 'lucide-react'
import { decode } from 'nostr-tools/nip19'
import * as marketplaceSdk from 'nostr-tools/marketplace'

import { ProfileChip } from '../ProfileChip'
import type { AppSession, LoadedMarketplace } from '../../types'
import { shortPubkey } from '../../nostr/inboxThreads'
import { fetchProfiles, type NostrProfile } from '../../nostr/profiles'
import {
  Badge,
  Button,
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Textarea,
  cn,
} from '../ui'

type TrustedArbitersSettingsProps = {
  autoTrustedArbiterPubkeys: string[]
  marketplace?: LoadedMarketplace
  session?: AppSession
  onUpdated?(): void | Promise<void>
}

type WidgetStatus = {
  variant: 'default' | 'secondary' | 'destructive' | 'outline'
  text: string
}

const hexPubkeyPattern = /^[a-f0-9]{64}$/i

function uniqueSortedPubkeys(pubkeys: Iterable<string | undefined>): string[] {
  return [...new Set([...pubkeys]
    .filter((pubkey): pubkey is string => Boolean(pubkey))
    .map(pubkey => pubkey.toLowerCase()))]
    .sort((left, right) => left.localeCompare(right))
}

function pubkeyInputParts(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map(part => part.trim())
    .filter(Boolean)
}

function normalizePubkey(value: string): string {
  const trimmed = value.trim()
  if (hexPubkeyPattern.test(trimmed)) return trimmed.toLowerCase()
  if (trimmed.startsWith('npub1')) {
    const decoded = decode(trimmed)
    if (decoded.type === 'npub' && typeof decoded.data === 'string' && hexPubkeyPattern.test(decoded.data)) {
      return decoded.data.toLowerCase()
    }
  }
  throw new Error(`${shortPubkey(trimmed)} is not a valid Nostr pubkey`)
}

function normalizePubkeyInput(value: string): string[] {
  const parts = pubkeyInputParts(value)
  if (parts.length === 0) return []
  return uniqueSortedPubkeys(parts.map(normalizePubkey))
}

function paymentFormLabel(form: marketplaceSdk.AcceptedPaymentForm): string {
  return [form.denomination, form.assetId, form.appId].filter(Boolean).join(' / ')
}

function statusForMethod(method: marketplaceSdk.ParsedPaymentMethod | null | undefined, loading: boolean): WidgetStatus {
  if (loading) return { text: 'Loading', variant: 'secondary' }
  if (method) return { text: 'Published', variant: 'default' }
  return { text: 'Unpublished', variant: 'outline' }
}

function resultMessage(result: marketplaceSdk.MarketplacePaymentMethodEnsureResult): string {
  if (result.status === 'created') return `Created payment method ${shortPubkey(result.event.id)}`
  if (result.status === 'updated') return `Updated payment method ${shortPubkey(result.event.id)}`
  if (result.status === 'unchanged') return `Payment method unchanged ${shortPubkey(result.event.id)}`
  if (result.reason === 'no_policy_contributions') return 'No active payment policies are available'
  if (result.reason === 'no_trusted_arbiters') return 'Add at least one trusted arbiter'
  return 'No listings found for this account'
}

export function TrustedArbitersSettings({
  autoTrustedArbiterPubkeys,
  marketplace,
  session,
  onUpdated,
}: TrustedArbitersSettingsProps) {
  const [method, setMethod] = useState<marketplaceSdk.ParsedPaymentMethod | null>()
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [profiles, setProfiles] = useState<Map<string, NostrProfile>>(() => new Map())

  const configuredTrusted = useMemo(
    () => new Set(uniqueSortedPubkeys(autoTrustedArbiterPubkeys)),
    [autoTrustedArbiterPubkeys],
  )
  const trustedArbiters = useMemo(
    () => uniqueSortedPubkeys([
      ...autoTrustedArbiterPubkeys,
      ...(method?.trustedArbiterPubkeys ?? []),
    ]),
    [autoTrustedArbiterPubkeys, method?.trustedArbiterPubkeys],
  )
  const status = statusForMethod(method, loading)

  const loadPaymentMethod = useCallback(async () => {
    if (!session || !marketplace) {
      setMethod(undefined)
      setError(undefined)
      setNotice(undefined)
      return
    }

    setLoading(true)
    setError(undefined)
    try {
      setMethod(await marketplace.runtime.paymentMethod.find())
    } catch (err) {
      console.warn('[marketplace-app] payment method load failed', err)
      setError(err instanceof Error ? err.message : 'Unable to load payment method')
    } finally {
      setLoading(false)
    }
  }, [marketplace, session])

  useEffect(() => {
    void loadPaymentMethod()
  }, [loadPaymentMethod])

  useEffect(() => {
    if (!session || trustedArbiters.length === 0) {
      setProfiles(new Map())
      return undefined
    }

    let cancelled = false
    fetchProfiles(session, trustedArbiters)
      .then(nextProfiles => {
        if (!cancelled) setProfiles(nextProfiles)
      })
      .catch(err => {
        if (cancelled) return
        console.warn('[marketplace-app] trusted arbiter profile fetch failed', err)
      })

    return () => {
      cancelled = true
    }
  }, [session, trustedArbiters])

  async function publishTrustedArbiters(nextTrustedArbiters: string[], successInput = ''): Promise<void> {
    if (!marketplace || !session) return

    setSaving(true)
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await marketplace.runtime.paymentMethod.ensureUpToDate({
        trustedArbiterPubkeys: uniqueSortedPubkeys(nextTrustedArbiters),
        requireListings: false,
        force: true,
      })
      if (result.status === 'skipped') {
        setNotice(resultMessage(result))
        await loadPaymentMethod()
        return
      }

      setMethod(marketplaceSdk.paymentMethod.parse(result.event))
      setInput(successInput)
      setNotice(resultMessage(result))
      await Promise.resolve(onUpdated?.())
    } catch (err) {
      console.warn('[marketplace-app] payment method update failed', err)
      setError(err instanceof Error ? err.message : 'Unable to update payment method')
    } finally {
      setSaving(false)
    }
  }

  async function addTrustedArbiters(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!input.trim()) return

    try {
      const nextInputPubkeys = normalizePubkeyInput(input)
      const nextTrustedArbiters = uniqueSortedPubkeys([...trustedArbiters, ...nextInputPubkeys])
      if (nextTrustedArbiters.length === trustedArbiters.length) {
        setNotice('Already trusted')
        setError(undefined)
        return
      }
      await publishTrustedArbiters(nextTrustedArbiters)
    } catch (err) {
      setNotice(undefined)
      setError(err instanceof Error ? err.message : 'Invalid arbiter pubkey')
    }
  }

  async function removeTrustedArbiter(pubkey: string): Promise<void> {
    const nextTrustedArbiters = trustedArbiters.filter(candidate => candidate !== pubkey)
    await publishTrustedArbiters(nextTrustedArbiters, input)
  }

  return (
    <Card className="col-span-2 max-[860px]:col-span-1">
      <CardHeader>
        <CardTitle>Trusted arbiters</CardTitle>
        <CardDescription>Payment method trust list</CardDescription>
        <CardAction>
          <Button
            aria-label="Refresh trusted arbiters"
            disabled={!session || !marketplace || loading || saving}
            onClick={() => void loadPaymentMethod()}
            size="icon-sm"
            type="button"
            variant="secondary"
          >
            <RefreshCwIcon className={cn('size-4', loading && 'animate-spin')} aria-hidden />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="grid gap-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="m-0 text-sm font-medium">Payment method</p>
              <p className="m-0 mt-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
                {method?.event.id ? shortPubkey(method.event.id) : session ? 'No event found' : 'Not signed in'}
              </p>
            </div>
            <Badge variant={status.variant}>{status.text}</Badge>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="m-0 text-[11px] font-medium uppercase leading-none text-muted-foreground">Trusted</p>
              <p className="m-0 mt-1 text-sm font-medium">{trustedArbiters.length}</p>
            </div>
            <div>
              <p className="m-0 text-[11px] font-medium uppercase leading-none text-muted-foreground">Payment forms</p>
              <p className="m-0 mt-1 text-sm font-medium">{method?.acceptedPaymentForms.length ?? 0}</p>
            </div>
            <div>
              <p className="m-0 text-[11px] font-medium uppercase leading-none text-muted-foreground">Policies</p>
              <p className="m-0 mt-1 text-sm font-medium">{method?.supportedContractBytecodeHashes.length ?? 0}</p>
            </div>
          </div>
        </div>

        <form className="grid gap-2" onSubmit={event => void addTrustedArbiters(event)}>
          <Textarea
            aria-label="Arbiter pubkeys"
            className="min-h-20 font-mono text-xs"
            disabled={!session || !marketplace || saving}
            onChange={event => setInput(event.target.value)}
            placeholder="npub1... or 64-char hex pubkey"
            value={input}
          />
          <div className="flex justify-end">
            <Button disabled={!session || !marketplace || saving || !input.trim()} type="submit">
              <PlusIcon aria-hidden className="size-4" />
              {saving ? 'Updating' : 'Add trusted'}
            </Button>
          </div>
        </form>

        {trustedArbiters.length === 0 ? (
          <p className="m-0 rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
            No trusted arbiters configured.
          </p>
        ) : (
          <div className="grid gap-2">
            {trustedArbiters.map(pubkey => {
              const configured = configuredTrusted.has(pubkey)
              return (
                <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-background p-2" key={pubkey}>
                  <div className="grid min-w-0 gap-2">
                    <ProfileChip pubkey={pubkey} profile={profiles.get(pubkey)} />
                    <p className="m-0 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{pubkey}</p>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="text-xs text-muted-foreground">{shortPubkey(pubkey)}</span>
                      {configured && <Badge variant="secondary">config</Badge>}
                    </div>
                  </div>
                  {!configured && (
                    <Button
                      aria-label={`Remove trusted arbiter ${shortPubkey(pubkey)}`}
                      disabled={saving || !session || !marketplace}
                      onClick={() => void removeTrustedArbiter(pubkey)}
                      size="icon-sm"
                      type="button"
                      variant="ghost"
                    >
                      <Trash2Icon className="size-4" aria-hidden />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {method?.acceptedPaymentForms.length ? (
          <div className="grid gap-2">
            <p className="m-0 text-xs font-medium uppercase leading-none text-muted-foreground">Accepted forms</p>
            <div className="grid gap-2">
              {method.acceptedPaymentForms.map(form => (
                <code className="rounded-md bg-muted px-2 py-1 text-xs [overflow-wrap:anywhere]" key={paymentFormLabel(form)}>
                  {paymentFormLabel(form)}
                </code>
              ))}
            </div>
          </div>
        ) : null}

        {(notice || error) && (
          <p
            className={cn(
              'm-0 rounded-lg border p-3 text-sm leading-6',
              error ? 'border-destructive/30 text-destructive' : 'text-muted-foreground',
            )}
            role={error ? 'alert' : 'status'}
          >
            {error ?? notice}
          </p>
        )}
      </CardContent>
    </Card>
  )
}
