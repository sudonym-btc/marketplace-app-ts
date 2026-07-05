type LnurlPayMetadata = {
  callback?: string
  minSendable?: number
  maxSendable?: number
  commentAllowed?: number
  status?: string
  reason?: string
}

type LnurlInvoiceResponse = {
  pr?: string
  status?: string
  reason?: string
}

function assertSuccess(payload: { status?: string; reason?: string }, label: string): void {
  if (payload.status?.toUpperCase() === 'ERROR') {
    throw new Error(payload.reason || `${label} failed`)
  }
}

export function lnurlPayUrlFromLud16(lud16: string): string {
  const [name, domain, ...rest] = lud16.trim().split('@')
  if (!name || !domain || rest.length > 0) throw new Error('Profile lud16 is not a valid Lightning address')
  return new URL(`/.well-known/lnurlp/${encodeURIComponent(name)}`, `https://${domain}`).toString()
}

export async function createLnurlPayInvoice(
  lud16: string,
  amountSats: number,
  description?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string> {
  if (!Number.isSafeInteger(amountSats) || amountSats <= 0) throw new Error('Invoice amount must be positive sats')

  const metadataResponse = await fetchImpl(lnurlPayUrlFromLud16(lud16))
  if (!metadataResponse.ok) throw new Error(`Lightning address metadata request failed: ${metadataResponse.status}`)
  const metadata = await metadataResponse.json() as LnurlPayMetadata
  assertSuccess(metadata, 'Lightning address metadata request')
  if (!metadata.callback) throw new Error('Lightning address metadata is missing callback')

  const amountMsats = amountSats * 1000
  if (metadata.minSendable !== undefined && amountMsats < metadata.minSendable) {
    throw new Error(`Invoice amount is below the Lightning address minimum of ${Math.ceil(metadata.minSendable / 1000)} sats`)
  }
  if (metadata.maxSendable !== undefined && amountMsats > metadata.maxSendable) {
    throw new Error(`Invoice amount is above the Lightning address maximum of ${Math.floor(metadata.maxSendable / 1000)} sats`)
  }

  const invoiceUrl = new URL(metadata.callback)
  invoiceUrl.searchParams.set('amount', amountMsats.toString())
  if (description && (metadata.commentAllowed ?? 0) > 0) {
    invoiceUrl.searchParams.set('comment', description.slice(0, metadata.commentAllowed))
  }

  const invoiceResponse = await fetchImpl(invoiceUrl)
  if (!invoiceResponse.ok) throw new Error(`Lightning invoice request failed: ${invoiceResponse.status}`)
  const invoice = await invoiceResponse.json() as LnurlInvoiceResponse
  assertSuccess(invoice, 'Lightning invoice request')
  if (!invoice.pr) throw new Error('Lightning invoice response is missing BOLT11 invoice')
  return invoice.pr
}
