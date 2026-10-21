import { createHash } from 'node:crypto'

interface Entry<V> { value: V; expires: number }

/** Minimal LRU with TTL. In-memory on purpose: this is a single-replica demo. */
export class LRUCache<V> {
  private map = new Map<string, Entry<V>>()
  constructor(private max: number, private ttlMs: number) {}

  get(key: string): V | undefined {
    const e = this.map.get(key)
    if (!e) return undefined
    if (e.expires < Date.now()) { this.map.delete(key); return undefined }
    this.map.delete(key); this.map.set(key, e) // refresh recency
    return e.value
  }
  set(key: string, value: V) {
    if (this.map.size >= this.max) this.map.delete(this.map.keys().next().value as string)
    this.map.set(key, { value, expires: Date.now() + this.ttlMs })
  }
  get size() { return this.map.size }
}

export function normalizeText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

export function hashKey(...parts: string[]): string {
  return createHash('sha1').update(parts.join('\u0000')).digest('hex').slice(0, 12)
}
