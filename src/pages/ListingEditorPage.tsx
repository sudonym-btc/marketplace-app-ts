import { useState } from 'react'

import { publishListing } from '../nostr/marketplaceApi'
import type { ListingFormValue, NostrPublisher } from '../types'

type Props = {
  publisher: NostrPublisher
  onPublished(): void
  onError(error: string): void
}

const initialForm: ListingFormValue = {
  d: '',
  title: '',
  summary: '',
  description: '',
  amount: '100',
  currency: 'USDT',
  frequency: '',
  location: '',
  image: '',
  quantity: 1,
  active: true,
  negotiable: true,
}

export function ListingEditorPage({ publisher, onPublished, onError }: Props) {
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)

  function update<K extends keyof ListingFormValue>(key: K, value: ListingFormValue[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  async function save() {
    if (!form.d || !form.title || !form.amount || !form.currency) {
      onError('Listing id, title, amount, and currency are required')
      return
    }
    setSaving(true)
    try {
      await publishListing(publisher, form)
      onPublished()
      window.location.hash = '#/'
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to publish listing')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="page narrow">
      <div className="page-heading">
        <div>
          <span className="label">Classified</span>
          <h1>Add / edit listing</h1>
        </div>
      </div>
      <div className="form-grid">
        <label>Listing id<input value={form.d} onChange={event => update('d', event.target.value)} /></label>
        <label>Title<input value={form.title} onChange={event => update('title', event.target.value)} /></label>
        <label>Summary<input value={form.summary} onChange={event => update('summary', event.target.value)} /></label>
        <label>Location<input value={form.location} onChange={event => update('location', event.target.value)} /></label>
        <label>Image URL<input value={form.image} onChange={event => update('image', event.target.value)} /></label>
        <label>Amount<input value={form.amount} onChange={event => update('amount', event.target.value)} /></label>
        <label>Currency<input value={form.currency} onChange={event => update('currency', event.target.value)} /></label>
        <label>Frequency<input placeholder="P1D for daily, blank for one-off" value={form.frequency} onChange={event => update('frequency', event.target.value)} /></label>
        <label>Quantity<input type="number" min="1" value={form.quantity} onChange={event => update('quantity', Number(event.target.value))} /></label>
        <label className="checkbox"><input type="checkbox" checked={form.active} onChange={event => update('active', event.target.checked)} /> Active</label>
        <label className="checkbox"><input type="checkbox" checked={form.negotiable} onChange={event => update('negotiable', event.target.checked)} /> Negotiable</label>
        <label className="wide">Description<textarea value={form.description} onChange={event => update('description', event.target.value)} /></label>
      </div>
      <button className="button" type="button" disabled={saving} onClick={save}>
        {saving ? 'Publishing...' : 'Publish listing'}
      </button>
    </section>
  )
}
