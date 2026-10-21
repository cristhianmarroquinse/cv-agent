import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { z } from 'zod'
import { DEFAULT_MODEL } from '@cv-agent/shared'
import { findModel, getCatalog } from '../llm/models.ts'
import { checkRateLimit } from '../rateLimit.ts'
import { GOLDEN, allowRun, cachedRun, loadReport, runEvals, saveModelReport, toSummary } from './runner.ts'
import { JUDGE_MODEL } from './judge.ts'

const bodySchema = z.object({ model: z.string().default(DEFAULT_MODEL) })

/** When EVALS_ADMIN_KEY is set, re-runs need the matching x-admin-key header. Unset = open (local dev). */
function isAdmin(key: string | undefined): boolean {
  const required = process.env.EVALS_ADMIN_KEY
  return !required || key === required
}

export const evalRoutes = new Hono()
  .get('/', async c => {
    const report = await loadReport()
    return c.json({
      judgeModel: JUDGE_MODEL,
      adminRequired: !!process.env.EVALS_ADMIN_KEY,
      cases: GOLDEN.map(g => ({ id: g.id, kind: g.kind, question: g.question, facts: (g.expect ?? g.expectBehaviour ?? g.expectSections ?? []).length })),
      summaries: report?.models.map(m => toSummary(m)) ?? [],
    })
  })
  .get('/report', async c => {
    const report = await loadReport()
    if (!report) return c.json({ error: 'No bake-off report yet. Run `bun run bakeoff` in apps/server to generate it.' }, 404)
    return c.json(report)
  })
  .post('/run', async c => {
    const parsed = bodySchema.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: 'Invalid request' }, 400)
    await getCatalog()
    const { model } = parsed.data
    if (!findModel(model)) return c.json({ error: `Unknown model ${model}` }, 400)
    const ip = c.req.header('x-forwarded-for')?.split(',')[0].trim() ?? c.req.header('x-real-ip') ?? 'local'
    const force = c.req.query('force') === '1'

    const report = await loadReport()
    const cached = force ? undefined : cachedRun(model, report)
    if (!cached) {
      if (!isAdmin(c.req.header('x-admin-key'))) return c.json({ error: 'Re-running the evals needs the admin key. The report shown is precomputed.' }, 403)
      const rl = checkRateLimit(ip)
      if (!rl.ok) return c.json({ error: rl.reason }, 429, { 'Retry-After': String(rl.retryAfterSec) })
      const allow = allowRun(ip, model)
      if (!allow.ok) return c.json({ error: `Evals for this model already ran recently. Try again in ${Math.ceil(allow.retryAfterSec / 60)} min.` }, 429, { 'Retry-After': String(allow.retryAfterSec) })
    }

    return streamSSE(c, async stream => {
      const abort = new AbortController()
      stream.onAbort(() => abort.abort())
      let queue: Promise<unknown> = Promise.resolve()
      const emit = (ev: unknown) => { queue = queue.then(() => stream.writeSSE({ data: JSON.stringify(ev) })).catch(() => {}) }
      try {
        if (cached) {
          emit({ type: 'eval.cached', model, at: cached.at })
          for (const r of cached.cases) emit(r)
          emit(toSummary(cached))
        } else {
          const r = await runEvals(model, x => emit(x), abort.signal)
          await saveModelReport(r)
          emit(toSummary(r))
        }
      } catch (err) {
        emit({ type: 'error', message: (err as Error).message })
      } finally {
        await queue
        await stream.close()
      }
    })
  })
