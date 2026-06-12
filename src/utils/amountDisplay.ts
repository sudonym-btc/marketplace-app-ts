const satsPerBtc = 100_000_000n

type AmountLike = {
  value: string
  decimals: number
  denomination: string
}

function normalizedDenomination(denomination: string | undefined): string {
  return (denomination ?? '').trim().toUpperCase()
}

export function isBitcoinDenomination(denomination: string | undefined): boolean {
  return ['BTC', 'XBT', 'SAT', 'SATS'].includes(normalizedDenomination(denomination))
}

function decimalUnitsFromValue(value: string): { units: bigint; decimals: number } | undefined {
  const match = value.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return undefined
  const [, whole, fraction = ''] = match
  return {
    units: BigInt(`${whole}${fraction}`),
    decimals: fraction.length,
  }
}

function groupedInteger(value: bigint): string {
  const sign = value < 0n ? '-' : ''
  const raw = (value < 0n ? -value : value).toString()
  return `${sign}${raw.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`
}

export function formatDecimalUnits(units: bigint, decimals: number): string {
  if (decimals <= 0) return units.toString()
  const negative = units < 0n
  const value = negative ? -units : units
  const raw = value.toString().padStart(decimals + 1, '0')
  const whole = raw.slice(0, -decimals)
  const fraction = raw.slice(-decimals).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`
}

function satsFromUnits(units: bigint, decimals: number, denomination: string): bigint | undefined {
  const normalized = normalizedDenomination(denomination)
  if (normalized === 'SAT' || normalized === 'SATS') {
    return decimals <= 0 ? units : units / 10n ** BigInt(decimals)
  }
  if (normalized !== 'BTC' && normalized !== 'XBT') return undefined
  return decimals <= 8
    ? units * 10n ** BigInt(8 - decimals)
    : units / 10n ** BigInt(decimals - 8)
}

export function formatSats(sats: bigint): string {
  return `₿ ${groupedInteger(sats)}`
}

export function formatDenominatedUnits(units: bigint, decimals: number, denomination: string): string {
  const sats = satsFromUnits(units, decimals, denomination)
  if (sats !== undefined) return formatSats(sats)
  return `${formatDecimalUnits(units, decimals)} ${denomination}`
}

export function formatDenominatedValue(
  value: string | undefined,
  decimals: number,
  denomination: string,
  fallback = 'None',
): string {
  if (!value || !/^\d+$/.test(value)) return value || fallback
  return formatDenominatedUnits(BigInt(value), decimals, denomination)
}

export function formatPriceAmount(value: string, denomination: string): string {
  const parsed = decimalUnitsFromValue(value)
  if (!parsed) return `${value} ${denomination}`
  return formatDenominatedUnits(parsed.units, parsed.decimals, denomination)
}

export function formatMarketplaceAmount(amount: AmountLike | undefined, fallback = 'No amount'): string {
  if (!amount) return fallback
  if (!/^\d+$/.test(amount.value)) return `${amount.value} ${amount.denomination}`
  return formatDenominatedUnits(BigInt(amount.value), amount.decimals, amount.denomination)
}
