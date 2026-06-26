import { useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'

import { Button, Input } from '../ui'
import { Eyebrow } from './Eyebrow'

type InvoiceBoxProps = {
  label?: string
  value: string
}

export function InvoiceBox({ label = 'Lightning invoice', value }: InvoiceBoxProps) {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  function copyInvoiceWithSelection(): boolean {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const selection = document.getSelection()
    const ranges = selection
      ? Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).cloneRange())
      : []
    const textarea = document.createElement('textarea')
    textarea.value = value
    textarea.setAttribute('readonly', '')
    textarea.setAttribute('aria-hidden', 'true')
    textarea.style.position = 'fixed'
    textarea.style.inset = '0 auto auto 0'
    textarea.style.width = '1px'
    textarea.style.height = '1px'
    textarea.style.padding = '0'
    textarea.style.border = '0'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    textarea.style.fontSize = '16px'
    document.body.append(textarea)

    try {
      textarea.focus({ preventScroll: true })
      textarea.select()
      textarea.setSelectionRange(0, textarea.value.length)
      return document.execCommand('copy')
    } finally {
      textarea.remove()
      if (selection) {
        selection.removeAllRanges()
        for (const range of ranges) selection.addRange(range)
      }
      activeElement?.focus({ preventScroll: true })
    }
  }

  async function copyInvoice() {
    setCopyFailed(false)
    try {
      if (window.isSecureContext && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value)
      } else if (!copyInvoiceWithSelection()) {
        throw new Error('Unable to copy invoice')
      }
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      const copiedInvoice = copyInvoiceWithSelection()
      setCopied(copiedInvoice)
      if (copiedInvoice) window.setTimeout(() => setCopied(false), 1500)
      else setCopyFailed(true)
    }
  }

  return (
    <div className="grid justify-items-center gap-3">
      <Eyebrow>{label}</Eyebrow>
      <div className="rounded-lg border bg-white p-3 text-black shadow-sm">
        <QRCodeSVG
          className="size-56 max-w-full"
          value={value}
          level="M"
          marginSize={2}
        />
      </div>
      <Button className="w-full" type="button" variant="secondary" onClick={copyInvoice}>
        {copied ? <Check /> : <Copy />}
        {copied ? 'Copied invoice' : 'Copy invoice'}
      </Button>
      <Input
        aria-label={label}
        className="h-8 bg-muted/50 font-mono text-xs"
        data-testid="invoice-input"
        readOnly
        value={value}
        onFocus={event => event.currentTarget.select()}
      />
      {copyFailed && (
        <p className="m-0 text-center text-xs leading-5 text-destructive" role="alert">
          Clipboard access was blocked. Select the invoice text and copy it manually.
        </p>
      )}
    </div>
  )
}
