// Build-time warm-up: downloads the embedding model and writes the chunk index to .cache,
// so a fresh container answers the first request without a cold model download.
import { buildIndex } from './rag/store.ts'

const stats = await buildIndex()
if (stats.backend !== 'transformers') {
  console.error('[prewarm] embedding model did not load; refusing to bake a BM25-only image')
  process.exit(1)
}
console.log('[prewarm] done', stats)
