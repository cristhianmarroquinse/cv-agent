import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { PipelineEvent, RetrievalHit } from '@cv-agent/shared'
import { runChat } from '../agent/orchestrator.ts'
import { config } from '../config.ts'
import { GOLDEN, type GoldenCase, type GoldenKind } from './golden.ts'
import { judge, JUDGE_MODEL, type JudgeScores } from './judge.ts'

export interface CaseResult {
  type: 'eval.case'
  id: string
  kind: GoldenKind
  question: string
  pass: boolean
  matched: string[]
  missing: string[]
  forbidden: string[]
  /** retrieval cases: recall@5 of the expected sections */
  recall?: number
  hitSections?: string[]
  grounded: { supported: number; total: number } | null
  judge?: JudgeScores
  ms: number
  /** cost of the answer run only; the judge's own cost is kept apart */
  costUsd: number
  judgeCostUsd?: number
  judgeModel?: string
  answer: string
}

export interface ModelReport {
  model: string
  at: number
  factsPass: number
  factsTotal: number
  negativesPass: number
  negativesTotal: number
  /** mean recall@5 over the retrieval cases (0..1) */
  retrievalRecall: number
  judge: { grounding: number; specificity: number; completeness: number; persuasiveness: number; concision: number; presentation: number }
  /** verifier: supported claims / total claims over all judged cases */
  groundedRatio: number
  avgMs: number
  totalMs: number
  /** answers only */
  totalCostUsd: number
  /** what the judge cost, kept apart so candidates are compared on their own spend */
  judgeCostUsd?: number
  cases: CaseResult[]
}

export interface VerifierCalibration { at: number; model: string; precision: number; recall: number; cases?: unknown[] }
export interface BakeoffReport { at: number; judgeModel: string; models: ModelReport[]; verifierCalibration?: VerifierCalibration }

/** Legacy shape kept for the SSE stream of a single run. */
export interface EvalSummary { type: 'eval.done'; model: string; passed: number; total: number; passRate: number; totalCostUsd: number; totalMs: number; at: number; report: ModelReport }

export const DATA_DIR = path.join(config.rootDir, 'apps/server/data')
export const REPORT_FILE = path.join(DATA_DIR, 'evals-report.json')
export const CALIBRATION_FILE = path.join(DATA_DIR, 'verifier-calibration.json')

const lastRun = new Map<string, number>() // `${ip}:${model}` → ts

/** One uncached run per model per 10 minutes per IP. */
export function allowRun(ip: string, model: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const key = `${ip}:${model}`
  const last = lastRun.get(key) ?? 0
  const wait = 10 * 60 * 1000 - (Date.now() - last)
  if (wait > 0) return { ok: false, retryAfterSec: Math.ceil(wait / 1000) }
  lastRun.set(key, Date.now())
  return { ok: true }
}

const rx = (p: string) => new RegExp(p, 'i')

/** Run one golden case through the real pipeline (cache bypassed) and score it. */
export async function runCase(model: string, c: GoldenCase, signal: AbortSignal): Promise<CaseResult> {
  let answer = ''
  let grounded: CaseResult['grounded'] = null
  let hits: RetrievalHit[] = []
  let ms = 0
  let costUsd = 0
  const emit = (e: PipelineEvent) => {
    if (e.type === 'llm.token') answer += e.delta
    else if (e.type === 'llm.replace') answer = e.content
    else if (e.type === 'retrieval.hits' && hits.length === 0) hits = e.hits
    else if (e.type === 'verification') grounded = { supported: e.supported, total: e.total }
    else if (e.type === 'run.end') { ms = e.ms; costUsd = e.usage.costUsd ?? 0 }
    else if (e.type === 'error') throw new Error(e.message)
  }
  await runChat({ model, noCache: true, lang: 'en', sessionId: `evals-${model.replace(/[^a-z0-9]/gi, '').slice(0, 40)}`, messages: [{ role: 'user', content: c.question }] }, emit, signal)

  const base = { type: 'eval.case' as const, id: c.id, kind: c.kind, question: c.question, grounded, ms, costUsd, answer: answer.slice(0, 4000) }
  if (c.kind === 'retrieval') {
    const sections = hits.slice(0, 5).map(h => h.section)
    const expected = c.expectSections ?? []
    // An expectation may list alternatives separated by "|" (e.g. the story or its deep dive).
    const found = expected.filter(e => e.split('|').some(alt => sections.some(s => s.toLowerCase().startsWith(alt.trim().toLowerCase()))))
    const recall = expected.length ? found.length / expected.length : 1
    return { ...base, pass: recall === 1, matched: found, missing: expected.filter(e => !found.includes(e)), forbidden: [], recall, hitSections: sections }
  }
  const patterns = c.kind === 'fact' ? (c.expect ?? []) : (c.expectBehaviour ?? [])
  const matched = patterns.filter(p => rx(p).test(answer))
  const missing = patterns.filter(p => !rx(p).test(answer))
  const forbidden = (c.forbid ?? []).filter(p => rx(p).test(answer))
  const pass = missing.length === 0 && forbidden.length === 0
  const j = await judge({ question: c.question, answer, facts: c.kind === 'fact' ? (c.expect ?? []) : [], kind: c.kind, signal }).catch(() => null)
  return { ...base, pass, matched, missing, forbidden, judge: j?.scores, judgeCostUsd: j?.usage.costUsd ?? undefined, judgeModel: j?.model }
}

/** Upstream 429s (provider rate limits) are transient: retry twice with backoff before counting a failure. */
async function runCaseWithRetry(model: string, c: GoldenCase, signal: AbortSignal): Promise<CaseResult> {
  for (let attempt = 0; ; attempt++) {
    try { return await runCase(model, c, signal) } catch (err) {
      if (attempt >= 2 || !/\b429\b/.test((err as Error).message)) throw err
      await new Promise(r => setTimeout(r, 4000 * (attempt + 1)))
    }
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]) }
  }))
  return out
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)
const r2 = (n: number) => Number(n.toFixed(2))

export function summarise(model: string, cases: CaseResult[], totalMs: number): ModelReport {
  const facts = cases.filter(c => c.kind === 'fact')
  const negs = cases.filter(c => c.kind === 'negative')
  const rets = cases.filter(c => c.kind === 'retrieval')
  const judged = cases.filter(c => c.judge)
  const g = cases.filter(c => c.grounded && c.grounded.total > 0)
  const sup = g.reduce((n, c) => n + c.grounded!.supported, 0)
  const tot = g.reduce((n, c) => n + c.grounded!.total, 0)
  const pick = (k: keyof JudgeScores) => r2(mean(judged.map(c => Number(c.judge![k]))))
  return {
    model, at: Date.now(),
    factsPass: facts.filter(c => c.pass).length, factsTotal: facts.length,
    negativesPass: negs.filter(c => c.pass).length, negativesTotal: negs.length,
    retrievalRecall: r2(mean(rets.map(c => c.recall ?? 0))),
    judge: { grounding: pick('grounding'), specificity: pick('specificity'), completeness: pick('completeness'), persuasiveness: pick('persuasiveness'), concision: pick('concision'), presentation: pick('presentation') },
    groundedRatio: tot ? r2(sup / tot) : 1,
    avgMs: Math.round(mean(cases.map(c => c.ms))),
    totalMs,
    totalCostUsd: Number(cases.reduce((n, c) => n + c.costUsd, 0).toFixed(5)),
    judgeCostUsd: Number(cases.reduce((n, c) => n + (c.judgeCostUsd ?? 0), 0).toFixed(5)),
    cases,
  }
}

/** Full run of the golden set for one model, concurrency 2; each case is emitted as soon as it finishes. */
export async function runEvals(model: string, onCase: (c: CaseResult) => void, signal: AbortSignal): Promise<ModelReport> {
  const t0 = Date.now()
  const cases = await mapLimit(GOLDEN, 2, async c => {
    const r = await runCaseWithRetry(model, c, signal).catch(err => ({
      type: 'eval.case' as const, id: c.id, kind: c.kind, question: c.question, pass: false, matched: [], missing: c.expect ?? c.expectBehaviour ?? c.expectSections ?? [], forbidden: [], grounded: null, ms: 0, costUsd: 0, answer: `ERROR: ${(err as Error).message}`,
    }))
    onCase(r)
    return r
  })
  return summarise(model, cases, Date.now() - t0)
}

/** Re-apply the current golden patterns to stored answers; judge scores and latencies are kept. */
export function rescore(r: ModelReport): ModelReport {
  const cases = r.cases.map(c => {
    const g = GOLDEN.find(x => x.id === c.id)
    if (!g || g.kind === 'retrieval') return c
    const patterns = g.kind === 'fact' ? (g.expect ?? []) : (g.expectBehaviour ?? [])
    const matched = patterns.filter(p => rx(p).test(c.answer))
    const missing = patterns.filter(p => !rx(p).test(c.answer))
    const forbidden = (g.forbid ?? []).filter(p => rx(p).test(c.answer))
    return { ...c, matched, missing, forbidden, pass: missing.length === 0 && forbidden.length === 0 }
  })
  return { ...summarise(r.model, cases, r.totalMs), at: r.at }
}

export function toSummary(r: ModelReport): EvalSummary {
  const passed = r.factsPass + r.negativesPass + r.cases.filter(c => c.kind === 'retrieval' && c.pass).length
  return { type: 'eval.done', model: r.model, passed, total: r.cases.length, passRate: r.cases.length ? passed / r.cases.length : 0, totalCostUsd: r.totalCostUsd, totalMs: r.totalMs, at: r.at, report: r }
}

// ---------- persistence

export async function loadReport(): Promise<BakeoffReport | null> {
  const f = Bun.file(REPORT_FILE)
  if (!(await f.exists())) return null
  try { return (await f.json()) as BakeoffReport } catch { return null }
}

export async function loadCalibration(): Promise<VerifierCalibration | undefined> {
  const f = Bun.file(CALIBRATION_FILE)
  if (!(await f.exists())) return undefined
  try { return (await f.json()) as VerifierCalibration } catch { return undefined }
}

/** Merge one model's report into the persisted bake-off (replacing that model's previous entry). */
export async function saveModelReport(r: ModelReport): Promise<BakeoffReport> {
  const existing = (await loadReport()) ?? { at: 0, judgeModel: JUDGE_MODEL, models: [] }
  const models = [...existing.models.filter(m => m.model !== r.model), r].sort((a, b) => b.judge.presentation - a.judge.presentation)
  const report: BakeoffReport = { at: Date.now(), judgeModel: JUDGE_MODEL, models, verifierCalibration: await loadCalibration() }
  await mkdir(DATA_DIR, { recursive: true })
  await Bun.write(REPORT_FILE, JSON.stringify(report, null, 2))
  return report
}

export function cachedRun(model: string, report: BakeoffReport | null): ModelReport | undefined {
  return report?.models.find(m => m.model === model)
}

export { GOLDEN }
