import { createHash } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { RetrievalHit } from '@cv-agent/shared'
import { config } from '../config.ts'
import { chunkMarkdown, type Chunk } from './chunker.ts'
import { BM25 } from './bm25.ts'
import { embed, loadEmbedder, embedBackend } from './embedder.ts'

export interface IndexStats { chunks: number; dims: number | null; backend: string; builtFrom: 'disk-cache' | 'fresh' }

let chunks: Chunk[] = []
let vectors: Float32Array[] | null = null
let bm25: BM25
let stats: IndexStats

export async function loadKnowledgeMarkdown(): Promise<string> {
  return Bun.file(path.join(import.meta.dir, '../knowledge/cv.md')).text()
}

/** Build the in-memory index: chunk → BM25 + (if available) dense vectors, with the vectors cached on disk. */
export async function buildIndex(): Promise<IndexStats> {
  const md = await loadKnowledgeMarkdown()
  chunks = chunkMarkdown(md)
  bm25 = new BM25(chunks.map(c => c.text))
  const backend = await loadEmbedder()
  let builtFrom: IndexStats['builtFrom'] = 'fresh'
  let dims: number | null = null
  if (backend === 'transformers') {
    const hash = createHash('sha1').update(md).digest('hex').slice(0, 10)
    const cacheFile = path.join(config.cacheDir, `index-${hash}.json`)
    const cached = Bun.file(cacheFile)
    if (await cached.exists()) {
      const raw = (await cached.json()) as number[][]
      vectors = raw.map(v => Float32Array.from(v))
      builtFrom = 'disk-cache'
    } else {
      const t0 = performance.now()
      vectors = await embed(chunks.map(c => c.text), 'passage')
      await mkdir(config.cacheDir, { recursive: true })
      await Bun.write(cacheFile, JSON.stringify(vectors!.map(v => Array.from(v))))
      console.log(`[index] embedded ${chunks.length} chunks in ${Math.round(performance.now() - t0)} ms`)
    }
    dims = vectors![0]?.length ?? null
  }
  stats = { chunks: chunks.length, dims, backend, builtFrom }
  console.log('[index]', stats)
  return stats
}

export function indexStats() { return stats }
export function getChunk(id: string) { return chunks.find(c => c.id === id) }

function cosine(a: Float32Array, b: Float32Array) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }

/** Hybrid search: reciprocal-rank fusion of dense cosine ranking and BM25 ranking. */
export async function search(query: string, k = config.retrievalTopK, filter?: (section: string) => boolean): Promise<{ hits: RetrievalHit[]; embedMs: number; dims: number | null; qvec: Float32Array | null }> {
  const allowed = (i: number) => !filter || filter(chunks[i].section)
  const lexical = bm25.score(query)
  const lexRank = lexical.map((s, i) => ({ i, s })).filter(x => x.s > 0 && allowed(x.i)).sort((a, b) => b.s - a.s)
  let embedMs = 0
  let denseRank: { i: number; s: number }[] = []
  let dims: number | null = null
  let qvec: Float32Array | null = null
  if (vectors) {
    const t0 = performance.now()
    const [q] = (await embed([query], 'query'))!
    embedMs = Math.round(performance.now() - t0)
    dims = q.length
    qvec = q
    denseRank = vectors.map((v, i) => ({ i, s: cosine(q, v) })).filter(x => allowed(x.i)).sort((a, b) => b.s - a.s)
  }
  const fused = new Map<number, { score: number; dense?: number; lex?: number }>()
  const K = 60
  denseRank.slice(0, 15).forEach((r, rank) => { const f = fused.get(r.i) ?? { score: 0 }; f.score += 1 / (K + rank); f.dense = r.s; fused.set(r.i, f) })
  lexRank.slice(0, 15).forEach((r, rank) => { const f = fused.get(r.i) ?? { score: 0 }; f.score += 1 / (K + rank); f.lex = r.s; fused.set(r.i, f) })
  const top = [...fused.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, k)
  const hits: RetrievalHit[] = top.map(([i, f]) => ({
    id: chunks[i].id,
    section: chunks[i].section,
    score: Number(f.score.toFixed(4)),
    method: f.dense !== undefined && f.lex !== undefined ? 'hybrid' : f.dense !== undefined ? 'vector' : 'bm25',
    preview: chunks[i].text.split('\n').slice(1).join(' ').slice(0, 140),
  }))
  return { hits, embedMs, dims, qvec }
}

export function cosineSim(a: Float32Array, b: Float32Array) { return cosine(a, b) }

export function contextFor(hits: RetrievalHit[]): string {
  return hits.map(h => `[${h.id}] ${getChunk(h.id)!.text}`).join('\n\n')
}

export { embedBackend }
