import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { ImagePlusIcon, Loader2Icon, UploadIcon, XIcon } from 'lucide-react'
import * as marketplace from 'nostr-tools/marketplace'

import {
  Button,
  Card,
  Checkbox,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
  cn,
} from '../components/ui'
import { CurrencyInput } from '../components/widgets/CurrencyInput'
import { Field } from '../components/widgets/FormField'
import { Page, PageHeader } from '../components/widgets/PageLayout'
import type { ListingFormValue, NostrPublisher } from '../types'
import {
  defaultCurrencyDecimals,
  minimumCurrencyAmount,
  validateCurrencyAmountInput,
} from '../utils/currencyAmount'

type Props = {
  publisher: NostrPublisher
  blossomUploadUrl?: string
  listing?: marketplace.MarketplaceListing
  loading?: boolean
  onPublished(): void | Promise<void>
  onError(error: string): void
}

type FrequencyValue = 'one-off' | 'daily' | 'weekly' | 'monthly'

const currencies = ['USD', 'BTC'] as const
const frequencies: Array<{ value: FrequencyValue; label: string }> = [
  { value: 'one-off', label: 'One-off' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
]

const initialForm: ListingFormValue = {
  title: '',
  description: '',
  amount: '100',
  currency: 'USD',
  frequency: 'one-off',
  location: '',
  images: [],
  quantity: 1,
  active: true,
  negotiable: true,
}

function normalizeFrequency(value: string | undefined): FrequencyValue {
  const normalized = value?.trim().toLowerCase()
  if (!normalized || normalized === 'one-off' || normalized === 'once') return 'one-off'
  if (normalized?.includes('day') || normalized === 'p1d') return 'daily'
  if (normalized?.includes('week') || normalized === 'p1w') return 'weekly'
  if (normalized?.includes('month') || normalized === 'p1m') return 'monthly'
  return 'one-off'
}

function normalizeCurrency(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase()
  if (!normalized) return initialForm.currency
  return currencies.some(currency => currency === normalized) ? normalized : initialForm.currency
}

function formFromListing(listing: marketplace.MarketplaceListing | undefined): ListingFormValue {
  if (!listing) return initialForm
  const price = listing.prices[0]
  return {
    title: listing.title,
    description: listing.description,
    amount: price?.amount ?? initialForm.amount,
    currency: normalizeCurrency(price?.currency),
    frequency: normalizeFrequency(price?.frequency),
    location: listing.location ?? '',
    images: listing.images.map(image => image.url),
    quantity: listing.quantity,
    active: listing.active,
    negotiable: listing.negotiable,
  }
}

function draftListingId(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const suffix = crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `${slug || 'listing'}-${suffix.slice(0, 8)}`
}

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

function blossomDescriptorUrl(data: unknown, uploadUrl: string, sha256: string): string {
  const url = data && typeof data === 'object' && typeof (data as Record<string, unknown>).url === 'string'
    ? (data as Record<string, string>).url
    : undefined
  if (url) return url
  return new URL(`/${sha256}`, uploadUrl).toString()
}

function ToggleCard({
  checked,
  className,
  description,
  disabled,
  title,
  onCheckedChange,
}: {
  checked: boolean
  className?: string
  description: ReactNode
  disabled?: boolean
  title: ReactNode
  onCheckedChange(checked: boolean): void
}) {
  return (
    <label
      className={cn(
        'grid cursor-pointer grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-lg border p-3 transition-colors',
        checked ? 'border-foreground/25 bg-muted/50' : 'border-border bg-background',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
    >
      <Checkbox checked={checked} disabled={disabled} onCheckedChange={value => onCheckedChange(value === true)} />
      <span className="grid gap-1">
        <span className="text-sm font-medium leading-5 text-foreground">{title}</span>
        <span className="text-xs leading-5 text-muted-foreground">{description}</span>
      </span>
    </label>
  )
}

function PriceEditorWidget({
  amount,
  currency,
  disabled,
  frequency,
  onAmountChange,
  onCurrencyChange,
  onFrequencyChange,
}: {
  amount: string
  currency: string
  disabled?: boolean
  frequency: string
  onAmountChange(value: string): void
  onCurrencyChange(value: string): void
  onFrequencyChange(value: string): void
}) {
  const amountDecimals = defaultCurrencyDecimals(currency)
  const amountMinimum = minimumCurrencyAmount(currency, amountDecimals)

  return (
    <section className="grid gap-3 rounded-lg border border-border bg-background p-3">
      <div className="text-sm font-medium leading-5 text-foreground">Price</div>
      <div className="grid grid-cols-[minmax(0,1fr)_112px_136px] gap-3 max-[640px]:grid-cols-1">
        <CurrencyInput
          currency={currency}
          decimals={amountDecimals}
          disabled={disabled}
          min={amountMinimum ? [amountMinimum] : undefined}
          required
          value={amount}
          onValueChange={onAmountChange}
        />
        <Select disabled={disabled} value={currency} onValueChange={onCurrencyChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {currencies.map(denomination => <SelectItem key={denomination} value={denomination}>{denomination}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select disabled={disabled} value={frequency} onValueChange={onFrequencyChange}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {frequencies.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
    </section>
  )
}

function ImageUploadWidget({
  blossomUploadUrl,
  disabled,
  images,
  onChange,
  onError,
}: {
  blossomUploadUrl?: string
  disabled?: boolean
  images: string[]
  onChange(images: string[]): void
  onError(error: string): void
}) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMessage, setUploadMessage] = useState<string>()

  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return
    if (!blossomUploadUrl) {
      onError('Blossom upload URL is not configured')
      return
    }

    const selected = [...files]
    const nonImages = selected.filter(file => !file.type.startsWith('image/'))
    if (nonImages.length > 0) {
      onError('Only image files can be uploaded to listing media')
      return
    }

    setUploading(true)
    setUploadMessage(`Uploading ${selected.length} image${selected.length === 1 ? '' : 's'}...`)
    try {
      const uploaded: string[] = []
      for (const file of selected) {
        const sha256 = await sha256Hex(file)
        const response = await fetch(blossomUploadUrl, {
          method: 'PUT',
          headers: {
            'content-type': file.type || 'application/octet-stream',
            'x-sha-256': sha256,
            'x-filename': file.name,
          },
          body: file,
        })
        const text = await response.text()
        const data = text ? JSON.parse(text) : undefined
        if (!response.ok) {
          throw new Error(`Blossom upload failed with HTTP ${response.status}: ${text || response.statusText}`)
        }
        uploaded.push(blossomDescriptorUrl(data, blossomUploadUrl, sha256))
      }
      onChange([...new Set([...images, ...uploaded])])
      setUploadMessage(`Uploaded ${uploaded.length} image${uploaded.length === 1 ? '' : 's'}`)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to upload images'
      setUploadMessage(undefined)
      onError(message)
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  function remove(url: string) {
    onChange(images.filter(image => image !== url))
  }

  return (
    <div className="grid gap-3">
      <input
        ref={inputRef}
        accept="image/*"
        className="sr-only"
        multiple
        type="file"
        onChange={(event: ChangeEvent<HTMLInputElement>) => void uploadFiles(event.target.files)}
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={disabled || uploading || !blossomUploadUrl}
          type="button"
          variant="secondary"
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2Icon className="animate-spin" /> : <UploadIcon />}
          Upload images
        </Button>
        <span className="text-xs leading-5 text-muted-foreground">
          {blossomUploadUrl ? uploadMessage ?? 'Images are uploaded to the local Blossom server.' : 'Blossom uploads are not configured.'}
        </span>
      </div>
      {images.length === 0 ? (
        <div className="grid min-h-28 place-items-center rounded-lg border border-dashed bg-muted/30 p-4 text-center text-sm text-muted-foreground">
          <span className="grid justify-items-center gap-2">
            <ImagePlusIcon className="size-5" />
            Upload one or more listing images.
          </span>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {images.map(url => (
            <div className="grid gap-2 rounded-lg border bg-background p-2" key={url}>
              <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-muted">
                <img alt="" className="absolute inset-0 size-full object-cover" src={url} />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 text-xs">{url}</code>
                <Button aria-label="Remove image" size="icon-sm" type="button" variant="ghost" onClick={() => remove(url)}>
                  <XIcon />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export function ListingEditorPage({ blossomUploadUrl, listing, loading = false, publisher, onPublished, onError }: Props) {
  const [form, setForm] = useState(() => formFromListing(listing))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(formFromListing(listing))
  }, [listing?.event.id])

  function update<K extends keyof ListingFormValue>(key: K, value: ListingFormValue[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  const amountDecimals = defaultCurrencyDecimals(form.currency)
  const amountMinimum = minimumCurrencyAmount(form.currency, amountDecimals)
  const amountValidation = validateCurrencyAmountInput(form.amount, {
    decimals: amountDecimals,
    denomination: form.currency,
    min: amountMinimum ? [amountMinimum] : undefined,
    required: true,
  })

  async function save() {
    const d = listing?.d || draftListingId(form.title)
    if (!form.title || !form.description || !form.amount || !form.currency) {
      onError('Title, description, amount, and currency are required')
      return
    }
    if (!amountValidation.valid) {
      onError(amountValidation.error ?? 'Enter a valid amount')
      return
    }
    setSaving(true)
    try {
      const frequency = form.frequency && form.frequency !== 'one-off' ? form.frequency : undefined
      const event = await publisher.sign(marketplace.listings.template({
        d,
        title: form.title,
        description: form.description,
        location: form.location || undefined,
        active: form.active,
        negotiable: form.negotiable,
        quantity: form.quantity,
        prices: [
          {
            amount: form.amount,
            currency: form.currency,
            ...(frequency ? { frequency } : {}),
          },
        ],
        images: form.images.map(url => ({ url })),
      }))
      await publisher.publish(event)
      await onPublished()
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to publish listing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Page narrow>
      <PageHeader eyebrow="Classified" title={listing ? 'Edit listing' : 'Create listing'} />
      <Card className="grid gap-5 p-5">
        <div className="grid grid-cols-2 gap-4 max-[720px]:grid-cols-1">
          <Field className="col-span-full" label="Title">
            <Input value={form.title} onChange={event => update('title', event.target.value)} />
          </Field>
          <Field className="col-span-full" label="Description">
            <Textarea value={form.description} onChange={event => update('description', event.target.value)} />
          </Field>
          <div className="col-span-full grid gap-3">
            <PriceEditorWidget
              amount={form.amount}
              currency={form.currency}
              disabled={saving || loading}
              frequency={form.frequency}
              onAmountChange={value => update('amount', value)}
              onCurrencyChange={value => update('currency', value)}
              onFrequencyChange={value => update('frequency', value)}
            />
            <ToggleCard
              checked={form.negotiable}
              description="Signal that buyers can message or offer different terms before committing."
              disabled={saving || loading}
              title="Negotiable terms"
              onCheckedChange={checked => update('negotiable', checked)}
            />
          </div>
          <Field label="Location">
            <Input value={form.location} onChange={event => update('location', event.target.value)} />
          </Field>
          <Field label="Quantity">
            <Input
              min="1"
              type="number"
              value={form.quantity}
              onChange={event => update('quantity', Number(event.target.value))}
            />
          </Field>
          <Field className="col-span-full" label="Images">
            <ImageUploadWidget
              blossomUploadUrl={blossomUploadUrl}
              disabled={saving || loading}
              images={form.images}
              onChange={images => update('images', images)}
              onError={onError}
            />
          </Field>
          <ToggleCard
            checked={form.active}
            className="col-span-full"
            description="Show this listing in searches and allow buyers to start orders against it."
            disabled={saving || loading}
            title="Active listing"
            onCheckedChange={checked => update('active', checked)}
          />
        </div>
      </Card>
      <Button className="w-fit" disabled={saving || loading || !amountValidation.valid} onClick={save}>
        {saving ? 'Publishing...' : listing ? 'Update listing' : 'Publish listing'}
      </Button>
    </Page>
  )
}
