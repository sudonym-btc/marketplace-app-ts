export type CurrencyAmount = {
  value: string
  denomination: string
  decimals: number
}

export type CurrencyAmountValidation = {
  error?: string
  parsed?: CurrencyAmount
  valid: boolean
}

type CurrencyAmountInputOptions = {
  decimals?: number
  denomination: string
  label?: string
  max?: CurrencyAmount[]
  min?: CurrencyAmount[]
  required?: boolean
}

const bitcoinDenominations = new Set(['BTC', 'XBT'])
const satoshiDenominations = new Set(['SAT', 'SATS'])

function normalizedDenomination(denomination: string): string {
  return denomination.trim().toUpperCase()
}

function isBitcoinDenomination(denomination: string): boolean {
  return bitcoinDenominations.has(normalizedDenomination(denomination))
}

function isSatoshiDenomination(denomination: string): boolean {
  return satoshiDenominations.has(normalizedDenomination(denomination))
}

function isBitcoinPair(left: string, right: string): boolean {
  return (
    (isBitcoinDenomination(left) && isSatoshiDenomination(right)) ||
    (isSatoshiDenomination(left) && isBitcoinDenomination(right))
  )
}

function rescaleUnits(units: bigint, sourceDecimals: number, targetDecimals: number): bigint | undefined {
  if (sourceDecimals === targetDecimals) return units
  if (sourceDecimals < targetDecimals) return units * 10n ** BigInt(targetDecimals - sourceDecimals)
  const scale = 10n ** BigInt(sourceDecimals - targetDecimals)
  return units % scale === 0n ? units / scale : undefined
}

function bitcoinAmountToSats(amount: CurrencyAmount): bigint | undefined {
  const units = BigInt(amount.value)
  if (isBitcoinDenomination(amount.denomination)) return rescaleUnits(units, amount.decimals, 8)
  if (isSatoshiDenomination(amount.denomination)) return rescaleUnits(units, amount.decimals, 0)
  return undefined
}

export function defaultCurrencyDecimals(denomination: string): number | undefined {
  const normalized = normalizedDenomination(denomination)
  if (!normalized) return undefined
  if (isSatoshiDenomination(normalized)) return 0
  if (isBitcoinDenomination(normalized)) return 8
  if (!/^[A-Z]{3}$/.test(normalized)) return undefined

  try {
    return new Intl.NumberFormat('en-US', {
      currency: normalized,
      style: 'currency',
    }).resolvedOptions().maximumFractionDigits
  } catch {
    return undefined
  }
}

export function normalizeCurrencyInputValue(rawValue: string): string {
  let next = ''
  let hasDecimal = false

  for (const character of rawValue) {
    if (character >= '0' && character <= '9') {
      next += character
    } else if (character === '.' && !hasDecimal) {
      next += character
      hasDecimal = true
    }
  }

  return next.startsWith('.') ? `0${next}` : next
}

export function parseCurrencyAmountInput(
  value: string,
  options: Pick<CurrencyAmountInputOptions, 'decimals' | 'denomination'>,
): CurrencyAmount {
  const input = value.trim()
  const match = input.match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) throw new Error('Enter a valid amount')

  const [, whole, fraction = ''] = match
  const decimals = options.decimals ?? fraction.length
  if (decimals < 0 || !Number.isSafeInteger(decimals)) throw new Error('Invalid currency precision')

  if (fraction.length > decimals) {
    const extra = fraction.slice(decimals)
    if (/[1-9]/.test(extra)) {
      throw new Error(`Use no more than ${decimals} decimal ${decimals === 1 ? 'place' : 'places'}`)
    }
  }

  const scaledFraction = fraction.slice(0, decimals).padEnd(decimals, '0')
  return {
    value: BigInt(`${whole}${scaledFraction}` || '0').toString(),
    denomination: options.denomination,
    decimals,
  }
}

export function compareCurrencyAmounts(left: CurrencyAmount, right: CurrencyAmount): number | undefined {
  const leftDenomination = normalizedDenomination(left.denomination)
  const rightDenomination = normalizedDenomination(right.denomination)

  if (leftDenomination === rightDenomination) {
    const decimals = Math.max(left.decimals, right.decimals)
    const leftUnits = rescaleUnits(BigInt(left.value), left.decimals, decimals)
    const rightUnits = rescaleUnits(BigInt(right.value), right.decimals, decimals)
    if (leftUnits === undefined || rightUnits === undefined) return undefined
    return leftUnits === rightUnits ? 0 : leftUnits > rightUnits ? 1 : -1
  }

  if (isBitcoinPair(left.denomination, right.denomination)) {
    const leftSats = bitcoinAmountToSats(left)
    const rightSats = bitcoinAmountToSats(right)
    if (leftSats === undefined || rightSats === undefined) return undefined
    return leftSats === rightSats ? 0 : leftSats > rightSats ? 1 : -1
  }

  return undefined
}

export function findCurrencyAmountLimit(
  limits: CurrencyAmount[] | undefined,
  denomination: string,
): CurrencyAmount | undefined {
  if (!limits?.length) return undefined
  return limits.find(limit =>
    normalizedDenomination(limit.denomination) === normalizedDenomination(denomination) ||
    isBitcoinPair(limit.denomination, denomination),
  )
}

export function formatCurrencyAmount(amount: CurrencyAmount): string {
  const units = BigInt(amount.value)
  if (amount.decimals <= 0) return `${units.toString()} ${amount.denomination}`

  const raw = units.toString().padStart(amount.decimals + 1, '0')
  const whole = raw.slice(0, -amount.decimals)
  const fraction = raw.slice(-amount.decimals).replace(/0+$/, '')
  return `${whole}${fraction ? `.${fraction}` : ''} ${amount.denomination}`
}

export function validateCurrencyAmountInput(
  value: string,
  options: CurrencyAmountInputOptions,
): CurrencyAmountValidation {
  const label = options.label ?? 'Amount'
  const input = value.trim()

  if (!input) {
    return options.required ? { error: `${label} is required`, valid: false } : { valid: true }
  }

  if (!/^\d+(?:\.\d*)?$/.test(input)) {
    return { error: 'Enter a valid amount', valid: false }
  }

  if (input.endsWith('.')) {
    return { error: 'Finish the amount after the decimal point', valid: false }
  }

  try {
    const parsed = parseCurrencyAmountInput(input, options)
    const min = findCurrencyAmountLimit(options.min, parsed.denomination)
    const max = findCurrencyAmountLimit(options.max, parsed.denomination)

    if (min !== undefined) {
      const comparison = compareCurrencyAmounts(parsed, min)
      if (comparison !== undefined && comparison < 0) {
        return { error: `Minimum is ${formatCurrencyAmount(min)}`, parsed, valid: false }
      }
    }

    if (max !== undefined) {
      const comparison = compareCurrencyAmounts(parsed, max)
      if (comparison !== undefined && comparison > 0) {
        return { error: `Maximum is ${formatCurrencyAmount(max)}`, parsed, valid: false }
      }
    }

    return { parsed, valid: true }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Enter a valid amount', valid: false }
  }
}

export function minimumCurrencyAmount(
  denomination: string,
  decimals = defaultCurrencyDecimals(denomination),
): CurrencyAmount | undefined {
  if (!denomination || decimals === undefined) return undefined
  return {
    value: '1',
    denomination,
    decimals,
  }
}
