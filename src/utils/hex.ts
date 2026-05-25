export function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

export function hexToBytes(hex: string): Uint8Array {
  const stripped = hex.startsWith('0x') ? hex.slice(2) : hex
  if (stripped.length % 2 !== 0 || /[^0-9a-f]/i.test(stripped)) throw new Error('Invalid hex')
  const out = new Uint8Array(stripped.length / 2)
  for (let i = 0; i < out.length; i += 1) {
    out[i] = Number.parseInt(stripped.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

export function randomHex(bytes = 32): string {
  const value = new Uint8Array(bytes)
  crypto.getRandomValues(value)
  return bytesToHex(value)
}

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}
