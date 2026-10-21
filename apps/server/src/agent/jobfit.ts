import type { Artifact, JobFitRow, Usage } from '@cv-agent/shared'
import { config } from '../config.ts'
import { completeJson, streamChat } from '../llm/openrouter.ts'
import { search, contextFor } from '../rag/store.ts'
import { identity } from '../knowledge/cv.data.ts'
import type { Emit } from '../events.ts'

interface Extracted { role: string; requirements: { text: string; kind: 'must' | 'nice' }[] }
interface Match { level: 'strong' | 'partial' | 'gap'; evidence: string }

const EXTRACT = `Extract the hiring requirements from a job description. Return JSON only:
{"role":"<job title, short>","requirements":[{"text":"<one concrete requirement, max 12 words>","kind":"must"|"nice"}]}
Max ${config.maxRequirements} requirements, most important first. Merge duplicates. Keep technologies explicit (e.g. "Python", "RAG", "Kubernetes"). Ignore benefits and company blurb.`

const MATCH = `You assess whether ${identity.name}'s CV satisfies ONE requirement, using only the EVIDENCE. Return JSON only:
{"level":"strong"|"partial"|"gap","evidence":"<max 25 words citing the concrete fact from the evidence, or why it is a gap>"}
Never mention chunk ids like [c3]; cite the fact itself. "strong" = clear, recent, production evidence. "partial" = related or older experience. "gap" = nothing relevant. Be honest: English is B2, no classic ML research, no public SmartCoach traction.`

const WRITE = (lang: 'es' | 'en') => `You write the final job-fit verdict for ${identity.name} based on the requirement-by-requirement assessment. Write it in ${lang === 'es' ? 'Spanish' : 'English'}, whatever language the job description uses. Structure: one-sentence verdict, 3-5 bullets with the strongest matches, 1-3 bullets with the honest gaps and how he mitigates them, and a closing line suggesting a conversation. Refer to him as 'Cristhian' rather than 'he/his' whenever natural. Max 180 words, markdown, no flattery. Do not invent facts beyond the assessment.`

const zero = (): Usage => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 })
const add = (a: Usage, b: Usage): Usage => ({ promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, cachedTokens: a.cachedTokens + b.cachedTokens, costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) })

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i) }
  }))
  return out
}

/** Three-agent pipeline: extractor → N matchers in parallel (each with its own retrieval) → writer (streams). */
export async function runJobFit(model: string, jobDescription: string, emit: Emit, signal: AbortSignal, lang: 'es' | 'en' = 'en'): Promise<{ text: string; artifacts: Artifact[]; usage: Usage; steps: number }> {
  let usage = zero()
  // 1. extractor
  let t0 = performance.now()
  emit({ type: 'agent.start', agent: 'extractor', label: 'structured extraction' })
  const ex = await completeJson<Extracted>({ model, system: EXTRACT, user: jobDescription, maxTokens: 900, signal })
  usage = add(usage, ex.usage)
  const reqs = (ex.data?.requirements ?? []).filter(r => typeof r?.text === 'string').slice(0, config.maxRequirements).map(r => ({ text: r.text, kind: r.kind === 'nice' ? 'nice' as const : 'must' as const }))
  const role = ex.data?.role || 'the role'
  emit({ type: 'agent.end', agent: 'extractor', ms: Math.round(performance.now() - t0), summary: `${reqs.length} requirements · ${role}` })
  if (!reqs.length) return { text: 'I could not extract requirements from that text. Paste the job description itself (responsibilities and requirements).', artifacts: [], usage, steps: 1 }

  // 2. matchers (parallel fan-out, bounded concurrency)
  t0 = performance.now()
  let done = 0
  emit({ type: 'agent.start', agent: 'matcher', label: `0/${reqs.length}`, parallel: true })
  emit({ type: 'edge', from: 'llm', to: 'vectorstore', label: 'scoped retrieval' })
  emit({ type: 'node.enter', node: 'vectorstore', label: `${reqs.length} scoped searches` })
  const rows: JobFitRow[] = await mapLimit(reqs, 4, async req => {
    const r = await search(req.text, 5)
    const m = await completeJson<Match>({ model, system: MATCH, user: `REQUIREMENT: ${req.text}\n\nEVIDENCE:\n${contextFor(r.hits)}`, maxTokens: 300, signal })
    usage = add(usage, m.usage)
    done++
    emit({ type: 'agent.progress', agent: 'matcher', label: `${done}/${reqs.length}` })
    const level = m.data?.level === 'strong' || m.data?.level === 'partial' || m.data?.level === 'gap' ? m.data.level : 'gap'
    return { requirement: req.text, kind: req.kind, level, evidence: m.data?.evidence ?? 'No evidence found.' }
  })
  const summary = { strong: rows.filter(r => r.level === 'strong').length, partial: rows.filter(r => r.level === 'partial').length, gap: rows.filter(r => r.level === 'gap').length }
  emit({ type: 'node.exit', node: 'vectorstore', ms: Math.round(performance.now() - t0) })
  emit({ type: 'edge', from: 'vectorstore', to: 'llm' })
  emit({ type: 'agent.end', agent: 'matcher', ms: Math.round(performance.now() - t0), summary: `${summary.strong} strong · ${summary.partial} partial · ${summary.gap} gap` })

  const artifact: Artifact = { kind: 'jobfit', id: `jobfit-${Date.now().toString(36)}`, title: `Fit: ${role}`, role, rows, summary }
  emit({ type: 'edge', from: 'tools', to: 'artifacts' })
  emit({ type: 'node.enter', node: 'artifacts', label: 'jobfit' })
  emit({ type: 'artifact', artifact })
  emit({ type: 'node.exit', node: 'artifacts', ms: 1 })

  // 3. writer (streams the verdict)
  t0 = performance.now()
  emit({ type: 'agent.start', agent: 'writer', label: 'verdict' })
  emit({ type: 'llm.request', model, step: 2, messageCount: 2, toolCount: 0, contextChunks: 0 })
  const w = await streamChat({
    model, signal, maxTokens: 900,
    messages: [{ role: 'system', content: WRITE(lang) }, { role: 'user', content: `ROLE: ${role}\nJOB DESCRIPTION (excerpt): ${jobDescription.slice(0, 1500)}\n\nASSESSMENT:\n${JSON.stringify(rows, null, 1)}` }],
    onToken: d => emit({ type: 'llm.token', delta: d }),
  })
  usage = add(usage, w.usage)
  emit({ type: 'llm.usage', step: 2, usage: w.usage })
  emit({ type: 'agent.end', agent: 'writer', ms: Math.round(performance.now() - t0) })
  return { text: w.content, artifacts: [artifact], usage, steps: 2 + reqs.length }
}
