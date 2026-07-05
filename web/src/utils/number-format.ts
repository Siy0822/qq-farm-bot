export type ResourceCurrency = 'gold' | 'coupon' | 'goldBean'

const WAN_UNIT = '\u4E07'

function toFiniteNumber(value: unknown) {
  const amount = Number(value ?? 0)
  return Number.isFinite(amount) ? amount : 0
}

function formatCompactAmount(value: unknown, threshold: number, divisor: number, unit: string) {
  const amount = toFiniteNumber(value)
  if (Math.abs(amount) > threshold)
    return `${(amount / divisor).toFixed(2)}${unit}`
  return amount.toLocaleString('zh-CN')
}

export function formatGoldAmount(value: unknown) {
  return formatWanAmount(value)
}

export function formatWanAmount(value: unknown) {
  return formatCompactAmount(value, 10000, 10000, WAN_UNIT)
}

export function formatCouponAmount(value: unknown) {
  return formatWanAmount(value)
}

export function formatGoldBeanAmount(value: unknown) {
  return formatWanAmount(value)
}

export function formatCurrencyAmount(value: unknown, currency: ResourceCurrency) {
  if (currency === 'gold')
    return formatGoldAmount(value)
  return formatWanAmount(value)
}

export function formatCurrencyAmountByLabel(value: unknown, label: string) {
  const text = String(label || '')
  if (text.includes('\u91D1\u5E01'))
    return formatGoldAmount(value)
  if (text.includes('\u70B9\u5238') || text.includes('\u91D1\u8C46\u8C46'))
    return formatWanAmount(value)
  return toFiniteNumber(value).toLocaleString('zh-CN')
}
