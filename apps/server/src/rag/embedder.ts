import { config } from '../config.ts'

export type EmbedBackend = 'transformers' | 'bm25-only'

const MODEL = 'Xenova/multilingual-e5-small'
let extractor: any = null
let backend: EmbedBackend = 'bm25-only'
let loading: Promise<void> | null = null

export function embedBackend(): EmbedBackend { return backend }
export const embeddingModelName = MODEL

export async function loadEmbedder(): Promise<EmbedBackend> {
  if (extractor) return backend
  if (!loading) {
    loading = (async () => {
      try {
        const t0 = performance.now()
        const { pipeline, env } = await import('@huggingface/transformers')
        env.cacheDir = `${config.cacheDir}/transformers`
        extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' })
        backend = 'transformers'
        console.log(`[embedder] ${MODEL} ready in ${Math.round(performance.now() - t0)} ms`)
      } catch (err) {
        console.warn('[embedder] failed to load, falling back to BM25 only:', (err as Error).message)
        backend = 'bm25-only'
      }
    })()
  }
  await loading
  return backend
}

/** e5 models expect "query: " / "passage: " prefixes. Returns normalized vectors. */
export async function embed(texts: string[], kind: 'query' | 'passage'): Promise<Float32Array[] | null> {
  if (!extractor) await loadEmbedder()
  if (!extractor) return null
  const out = await extractor(texts.map(t => `${kind}: ${t}`), { pooling: 'mean', normalize: true })
  const [n, dims] = out.dims as [number, number]
  const data = out.data as Float32Array
  const vecs: Float32Array[] = []
  for (let i = 0; i < n; i++) vecs.push(data.slice(i * dims, (i + 1) * dims))
  return vecs
}
