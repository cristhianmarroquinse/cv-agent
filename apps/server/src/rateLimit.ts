import { config } from './config.ts'

const buckets = new Map<string, { count: number; reset: number }>()
let global = { count: 0, reset: Date.now() + 86_400_000 }

export function checkRateLimit(ip: string): { ok: true } | { ok: false; reason: string; retryAfterSec: number } {
  const now = Date.now()
  if (global.reset < now) global = { count: 0, reset: now + 86_400_000 }
  if (global.count >= config.rateLimit.globalPerDay) {
    return { ok: false, reason: 'Daily budget for this demo is exhausted. Try again tomorrow.', retryAfterSec: Math.ceil((global.reset - now) / 1000) }
  }
  let b = buckets.get(ip)
  if (!b || b.reset < now) { b = { count: 0, reset: now + config.rateLimit.windowMs }; buckets.set(ip, b) }
  if (b.count >= config.rateLimit.perIp) {
    return { ok: false, reason: 'Too many requests from this address. Slow down a little.', retryAfterSec: Math.ceil((b.reset - now) / 1000) }
  }
  b.count++; global.count++
  return { ok: true }
}
