import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { streamSSE } from 'hono/streaming'
import { serveStatic } from 'hono/bun'
import { z } from 'zod'
import path from 'node:path'
import { DEFAULT_MODEL, type ChatRequest, type PipelineEvent } from '@cv-agent/shared'
import { config } from './config.ts'
import { checkRateLimit } from './rateLimit.ts'
import { buildIndex, indexStats, loadKnowledgeMarkdown } from './rag/store.ts'
import { getCatalog, findModel } from './llm/models.ts'
import { runChat, cacheStats } from './agent/orchestrator.ts'
import { embeddingModelName } from './rag/embedder.ts'
import { tailorCv, renderCvPdf, genericCv } from './agent/tailoredCv.ts'
import { evalRoutes } from './evals/routes.ts'
import { mcpRoutes, mcpInfo, mcpBaseUrl } from './mcp.ts'

const app = new Hono()
app.use('/api/*', cors({ origin: [config.siteUrl, 'http://localhost:5173', 'http://127.0.0.1:5173'] }))

const chatSchema = z.object({
  model: z.string().default(DEFAULT_MODEL),
  sessionId: z.string().max(64).optional(),
  noCache: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  mode: z.enum(['chat', 'jobfit']).optional(),
  lang: z.enum(['es', 'en']).optional(),
  attachment: z.object({ name: z.string().min(1).max(200), mime: z.string().max(100), data: z.string().max(7_500_000) }).optional(),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().min(1).max(config.maxJobDescriptionChars) })).min(1).max(config.maxMessages),
})

app.get('/api/health', c => c.json({ ok: true, index: indexStats(), cache: cacheStats(), embeddingModel: embeddingModelName }))

// Model Context Protocol: the same tools and knowledge base for external MCP clients (see ./mcp.ts).
app.route('/mcp', mcpRoutes)
app.get('/api/mcp', c => c.json(mcpInfo(mcpBaseUrl())))

app.get('/api/models', async c => c.json({ default: DEFAULT_MODEL, models: await getCatalog() }))

// Verifier calibration (precision/recall on planted hallucinations), produced by `bun run calibrate-verifier`.
app.get('/api/verifier/calibration', async c => {
  const f = Bun.file(path.join(config.rootDir, 'apps/server/data/verifier-calibration.json'))
  return (await f.exists()) ? c.json(await f.json()) : c.json({ error: 'No calibration yet. Run `bun run calibrate-verifier` in apps/server.' }, 404)
})

// Tailored CV: structured selection of real facts for one job, rendered as a PDF.
const tailoredSchema = z.object({
  model: z.string().default(DEFAULT_MODEL),
  role: z.string().min(1).max(200),
  jobDescription: z.string().min(1).max(config.maxJobDescriptionChars),
  rows: z.array(z.object({ requirement: z.string(), kind: z.enum(['must', 'nice']), level: z.enum(['strong', 'partial', 'gap']), evidence: z.string() })).max(12),
})
app.post('/api/cv/tailored', async c => {
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? 'local'
  const rl = checkRateLimit(ip)
  if (!rl.ok) return c.json({ error: rl.reason }, 429, { 'Retry-After': String(rl.retryAfterSec) })
  const parsed = tailoredSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  await getCatalog()
  if (!findModel(parsed.data.model)) return c.json({ error: `Unknown model ${parsed.data.model}` }, 400)
  const { cv, costUsd } = await tailorCv(parsed.data.model, parsed.data.role, parsed.data.rows, parsed.data.jobDescription)
  const pdf = await renderCvPdf(cv, parsed.data.role)
  const file = `Cristhian-Marroquin-CV-${parsed.data.role.replace(/[^a-z0-9]+/gi, '-').slice(0, 40)}.pdf`
  return new Response(Buffer.from(pdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${file}"`, 'X-Cost-Usd': String(costUsd ?? ''), 'Access-Control-Expose-Headers': 'X-Cost-Usd, Content-Disposition' } })
})



app.get('/api/cv.md', async c => {
  const md = await loadKnowledgeMarkdown()
  return new Response(md, { headers: { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Disposition': 'attachment; filename="Cristhian-Marroquin-CV.md"' } })
})

let genericCvPdf: Uint8Array | null = null
app.get('/api/cv', async c => {
  const pdf = Bun.file(path.join(config.publicDir, 'cv.pdf'))
  if (await pdf.exists()) return new Response(pdf, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'inline; filename="Cristhian-Marroquin-CV.pdf"' } })
  genericCvPdf ??= await renderCvPdf(genericCv(), null)
  return new Response(Buffer.from(genericCvPdf), { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': 'attachment; filename="Cristhian-Marroquin-CV.pdf"' } })
})


// Evals: golden set run through the real pipeline (see ./evals).
app.route('/api/evals', evalRoutes)

app.post('/api/chat', async c => {
  const receivedAt = performance.now()
  const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? 'local'
  const rl = checkRateLimit(ip)
  if (!rl.ok) return c.json({ error: rl.reason }, 429, { 'Retry-After': String(rl.retryAfterSec) })

  const parsed = chatSchema.safeParse(await c.req.json().catch(() => null))
  if (!parsed.success) return c.json({ error: 'Invalid request', issues: parsed.error.issues }, 400)
  await getCatalog()
  if (!findModel(parsed.data.model)) return c.json({ error: `Unknown model ${parsed.data.model}` }, 400)
  const req: ChatRequest = parsed.data

  return streamSSE(c, async stream => {
    const abort = new AbortController()
    stream.onAbort(() => abort.abort())
    let queue: Promise<unknown> = Promise.resolve()
    // Every event is stamped with the server time at the moment it is emitted (not when the socket drains),
    // so the trace shows real latencies, not the paced replay.
    const emit = (event: PipelineEvent) => { const data = JSON.stringify({ ...event, ts: Date.now() }); queue = queue.then(() => stream.writeSSE({ data })).catch(() => {}) }
    try {
      await runChat(req, emit, abort.signal, receivedAt)
    } catch (err) {
      console.error('[chat]', err)
      emit({ type: 'error', message: (err as Error).message })
    } finally {
      await queue
      await stream.close()
    }
  })
})

// Production: serve the built web app from the same process.
app.use('/*', serveStatic({ root: path.relative(process.cwd(), config.webDist) || '.' }))
app.get('/*', async c => {
  const index = Bun.file(path.join(config.webDist, 'index.html'))
  if (await index.exists()) return c.html(await index.text())
  return c.text('Web app not built. Run `bun run build` or use the Vite dev server on :5173.', 404)
})

console.log(`[server] building index…`)
await buildIndex()
await getCatalog()
console.log(`[server] listening on http://localhost:${config.port}`)

export default { port: config.port, fetch: app.fetch, idleTimeout: 120 }
