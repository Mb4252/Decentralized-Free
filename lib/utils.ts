export function formatNumber(n: number, digits = 2): string {
  if (!isFinite(n)) return '0'
  return n.toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits
  })
}

export function timeToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000)
}

export function tfToSeconds(tf: '15m' | '4h' | '1d'): number {
  return tf === '15m' ? 900 : tf === '4h' ? 14400 : 86400
}

export function isAdminKeyValid(key: string | null): boolean {
  return !!key && key === process.env.ADMIN_SECRET_KEY
}
