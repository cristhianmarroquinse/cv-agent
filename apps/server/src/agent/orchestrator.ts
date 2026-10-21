import type { Artifact, ChatRequest, Claim, Usage } from '@cv-agent/shared'
import { config } from '../config.ts'
import { LRUCache, hashKey, normalizeText } from '../cache.ts'
import { withNode, type Emit } from '../events.ts'
import { streamChat, type ORMessage } from '../llm/openrouter.ts'
import { search, contextFor, embedBackend, cosineSim } from '../rag/store.ts'
import { SYSTEM_PROMPT, PROFILE_SUMMARY } from './prompt.ts'
import { executeTool, toolDefinitions } from './tools.ts'
import { plan as makePlan } from './planner.ts'
import { retrieveFor, runSpecialist } from './specialists.ts'
import { verify } from './verifier.ts'
import { runJobFit } from './jobfit.ts'
import { readAttachment } from './reader.ts'
import { suggest } from './suggester.ts'
import { identity } from '../knowledge/cv.data.ts'

interface CachedResponse { text: string; artifacts: Artifact[]; usage: Usage; steps: number; claims?: Claim[]; suggestions?: string[] }

const responseCache = new LRUCache<CachedResponse>(500, config.responseCacheTtlMs)
/** Semantic index over cached questions, per session: a near-identical question can reuse an answer. */
interface SemanticEntry { key: string; question: string; vec: Float32Array; model: string; mode: string; reasoning: boolean }
const semanticIndex = new LRUCache<SemanticEntry[]>(200, config.responseCacheTtlMs)
const SEMANTIC_THRESHOLD = 0.92
function semanticLookup(session: string, vec: Float32Array, model: string, mode: string, reasoning: boolean): { entry: SemanticEntry; score: number } | null {
  let best: { entry: SemanticEntry; score: number } | null = null
  for (const entry of semanticIndex.get(session) ?? []) {
    if (entry.model !== model || entry.mode !== mode || entry.reasoning !== reasoning) continue
    const score = cosineSim(vec, entry.vec)
    if (score >= SEMANTIC_THRESHOLD && (!best || score > best.score)) best = { entry, score }
  }
  return best
}
function semanticRemember(session: string, entry: SemanticEntry) {
  const list = semanticIndex.get(session) ?? []
  if (!list.some(e => e.key === entry.key)) semanticIndex.set(session, [...list.slice(-50), entry])
}
const retrievalCache = new LRUCache<Awaited<ReturnType<typeof search>>>(500, config.retrievalCacheTtlMs)

const zeroUsage = (): Usage => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 })
function addUsage(a: Usage, b: Usage): Usage {
  return { promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, cachedTokens: a.cachedTokens + b.cachedTokens, costUsd: a.costUsd == null || b.costUsd == null ? null : a.costUsd + b.costUsd }
}

function systemMessage(model: string, text: string): ORMessage {
  // Anthropic needs an explicit cache breakpoint; other providers cache prefixes automatically.
  if (model.startsWith('anthropic/')) return { role: 'system', content: [{ type: 'text', text, cache_control: { type: 'ephemeral' } }] }
  return { role: 'system', content: text }
}

/**
 * Combine the text written before tool calls with the final step. If the final step repeats the earlier answer, keep
 * only the final one (and tell the client to replace what it streamed); otherwise keep both, separated.
 */
function mergeSteps(pre: string, last: string, emit: Emit): string {
  const p = pre.trim(), l = last.trim()
  if (!p) return l
  if (!l) return p
  const words = (t: string) => new Set(t.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length > 3))
  const a = words(p), b = words(l)
  const overlap = [...a].filter(w => b.has(w)).length / Math.max(1, Math.min(a.size, b.size))
  if (l.length > 200 && overlap > 0.6) { emit({ type: 'llm.replace', content: l }); return l }
  return p + '\n\n' + l
}

/** Remove sentences like 'The card below shows…' / 'La tarjeta de abajo…' when no artifact exists. */
export function stripCardMentions(text: string): string {
  const re = /[^.!?\n]*\b(?:card|cards|tarjeta|tarjetas|panel)\b[^.!?\n]*\b(?:below|abajo|debajo|de la derecha|on the right|shows?|muestra|tiene|has)\b[^.!?\n]*[.!?]?/gi
  // Promises of a card that was never produced: 'I can pull up the card', 'puedo abrir la tarjeta'.
  const promise = /[^.!?\n]*\b(?:pull up|open|render|show you|available on|available as|puedo mostrar|puedo abrir|abrir|mostrar|sacar|disponible en)\b[^.!?\n]*\b(?:card|cards|tarjeta|tarjetas)\b[^.!?\n]*[.!?]?/gi
  return text.replace(re, '').replace(promise, '').replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n').trim()
}

function safeJson(s: string): Record<string, unknown> {
  try { return s ? JSON.parse(s) : {} } catch { return {} }
}

/** One full turn of the pipeline. Emits every step as events; returns when the stream is complete. */
export async function runChat(req: ChatRequest, emit: Emit, signal: AbortSignal, receivedAt = performance.now()): Promise<void> {
  const t0 = receivedAt
  const runId = hashKey(String(t0), Math.random().toString())
  const { model } = req
  const mode = req.mode ?? 'chat'
  const history = req.messages.slice(-config.maxMessages)
  const lastUser = [...history].reverse().find(m => m.role === 'user')?.content ?? ''
  const asked = history.filter(m => m.role === 'user').map(m => m.content.slice(0, 160))
  emit({ type: 'run.start', runId, model, ts: Date.now() })
  emit({ type: 'edge', from: 'client', to: 'gateway' })
  emit({ type: 'node.enter', node: 'gateway', label: mode === 'jobfit' ? 'job-fit mode' : 'validated · rate limit ok' })
  // Gateway time = parsing + validation + rate limit, measured from the moment the request arrived.
  emit({ type: 'node.exit', node: 'gateway', ms: Math.round(performance.now() - receivedAt) })

  // 1. Response cache (exact question + same conversation prefix + same model + flags)
  // Follow-up questions ('y en Walmart?', 'and then?') depend on the conversation, so their cache key includes the
  // history prefix. Standalone questions are keyed on the question alone so repeating one later in the chat still hits.
  const followUp = /^(y|e|and|also|además|tambi[eé]n|entonces|then|what about|qu[eé] hay de|ok|vale|más|more|otra|another)\b/i.test(lastUser.trim()) || lastUser.trim().length < 12
  const prefix = mode === 'jobfit' || !followUp ? '' : history.slice(0, -1).map(m => `${m.role}:${normalizeText(m.content)}`).join('|')
  const attKey = req.attachment ? hashKey(req.attachment.name, String(req.attachment.data.length), req.attachment.data.slice(0, 4000)) : ''
  const respKey = hashKey(req.sessionId ?? '', mode, model, normalizeText(lastUser), prefix, req.reasoning ? 'r' : '', attKey)
  const useCache = !req.noCache
  const retKey = hashKey(normalizeText(lastUser))
  let retrievalHit: Awaited<ReturnType<typeof search>> | undefined
  emit({ type: 'edge', from: 'gateway', to: 'cache' })
  const cached = await withNode(emit, 'cache', 'response cache', async () => {
    emit({ type: 'cache.check', scope: 'response', key: respKey })
    const hit = useCache ? responseCache.get(respKey) : undefined
    if (hit) { emit({ type: 'cache.hit', scope: 'response', key: respKey, detail: 'identical question, served without retrieval or LLM' }); return hit }
    emit({ type: 'cache.miss', scope: 'response', key: respKey, detail: useCache ? undefined : 'cache bypassed by the client' })
    if (mode !== 'jobfit') {
      // Retrieval cache (global, not affected by the switch): same question text → same embedding and hits.
      emit({ type: 'cache.check', scope: 'retrieval', key: retKey })
      retrievalHit = retrievalCache.get(retKey)
      if (retrievalHit) emit({ type: 'cache.hit', scope: 'retrieval', key: retKey, detail: 'query embedding and hits reused' })
      else emit({ type: 'cache.miss', scope: 'retrieval', key: retKey })
    }
    return undefined
  })
  const replay = async (hit: CachedResponse) => {
    emit({ type: 'edge', from: 'cache', to: 'client', label: 'cached' })
    for (const a of hit.artifacts) emit({ type: 'artifact', artifact: a })
    for (const piece of hit.text.match(/.{1,24}/gs) ?? []) { emit({ type: 'llm.token', delta: piece }); await Bun.sleep(8) }
    if (hit.claims) emit({ type: 'verification', claims: hit.claims, supported: hit.claims.filter(c => c.supported).length, total: hit.claims.length })
    if (hit.suggestions?.length) emit({ type: 'suggestions', items: hit.suggestions })
    // A replay spends no tokens: report zeros, not the usage of the original run.
    emit({ type: 'run.end', ms: Math.round(performance.now() - t0), steps: 0, usage: zeroUsage(), fromCache: true })
  }
  if (cached) { await replay(cached); return }

  // Job-fit mode: its own multi-agent pipeline, no planner/verifier.
  if (mode === 'jobfit') {
    emit({ type: 'edge', from: 'cache', to: 'llm' })
    const r = await withNode(emit, 'llm', `${model} · agents`, async () => {
      let jd = lastUser
      let readUsage: Usage | null = null
      if (req.attachment) {
        const read = await readAttachment(req.attachment, emit, signal)
        if (read.text.length < 80) throw new Error('Could not read any text from the file. Try a PDF with a text layer, a sharper image, or paste the text.')
        jd = read.text
        readUsage = read.usage
      }
      const out = await runJobFit(model, jd, emit, signal, req.lang ?? 'en')
      return readUsage ? { ...out, usage: addUsage(out.usage, readUsage) } : out
    })
    const sug = await suggest({ question: 'Job fit analysis', answer: r.text, asked, signal }, emit)
    const usageJ = sug ? addUsage(r.usage, sug.usage) : r.usage
    if (useCache && r.text.trim()) responseCache.set(respKey, { text: r.text, artifacts: r.artifacts, usage: usageJ, steps: r.steps, suggestions: sug?.items })
    emit({ type: 'run.end', ms: Math.round(performance.now() - t0), steps: r.steps, usage: usageJ, fromCache: false })
    return
  }

  // 2. Retrieval. A retrieval-cache hit reuses the query embedding and the hits, so no embedder work is drawn.
  let retrieval: Awaited<ReturnType<typeof search>>
  if (retrievalHit) {
    retrieval = retrievalHit
    emit({ type: 'edge', from: 'cache', to: 'vectorstore', label: 'hits reused' })
    emit({ type: 'node.enter', node: 'vectorstore', label: `${retrieval.hits.length} chunks · reused` })
    emit({ type: 'retrieval.query', query: lastUser })
    emit({ type: 'retrieval.hits', hits: retrieval.hits, ms: 0, label: 'reused from retrieval cache' })
    emit({ type: 'node.exit', node: 'vectorstore' })
  } else {
    emit({ type: 'edge', from: 'cache', to: 'embedder' })
    emit({ type: 'node.enter', node: 'embedder', label: embedBackend() === 'transformers' ? 'e5-small · local' : 'BM25 only' })
    emit({ type: 'retrieval.query', query: lastUser })
    retrieval = await search(lastUser)
    emit({ type: 'retrieval.embed', dims: retrieval.dims ?? 0, ms: retrieval.embedMs, backend: embedBackend() })
    emit({ type: 'node.exit', node: 'embedder', ms: retrieval.embedMs })
    retrievalCache.set(retKey, retrieval)
    emit({ type: 'edge', from: 'embedder', to: 'vectorstore' })
    emit({ type: 'node.enter', node: 'vectorstore', label: `${retrieval.hits.length} chunks · hybrid` })
    emit({ type: 'retrieval.hits', hits: retrieval.hits, ms: retrieval.searchMs })
    emit({ type: 'node.exit', node: 'vectorstore', ms: retrieval.searchMs })
  }

  // 2b. Semantic cache: the question vector is compared with the questions answered earlier in this session.
  // It runs before the planner so a hit costs no LLM call at all.
  if (useCache && retrieval.qvec) {
    const tS = performance.now()
    const near = semanticLookup(req.sessionId ?? '', retrieval.qvec, model, mode, !!req.reasoning)
    const hit = near ? responseCache.get(near.entry.key) : undefined
    if (near && hit) {
      emit({ type: 'edge', from: 'vectorstore', to: 'cache', label: 'semantic match' })
      emit({ type: 'node.enter', node: 'cache', label: 'semantic match' })
      emit({ type: 'cache.hit', scope: 'response', key: near.entry.key, detail: `semantic · ${near.score.toFixed(2)} · '${near.entry.question.slice(0, 60)}'` })
      emit({ type: 'node.exit', node: 'cache', ms: Math.round(performance.now() - tS) })
      await replay(hit)
      return
    }
    emit({ type: 'cache.miss', scope: 'response', key: respKey, detail: `no question in this session within cosine ${SEMANTIC_THRESHOLD}` })
  }

  // 2c. Planner: one small JSON call that decides direct loop vs. fan-out. Drawn live, timed for real.
  emit({ type: 'edge', from: 'vectorstore', to: 'llm' })
  const { plan, usage: planUsage } = await withNode(emit, 'llm', 'planner', () => makePlan(model, lastUser, emit, signal))

  const artifacts: Artifact[] = []
  let total = planUsage
  let finalText = ''
  let preText = ''
  let step = 0
  const evidence: string[] = [contextFor(retrieval.hits)]
  // The answer starts reaching the client on the first streamed token, not when the run ends.
  let streaming = false
  const onToken = (d: string) => {
    if (!streaming) { streaming = true; emit({ type: 'edge', from: 'llm', to: 'client', label: 'stream' }) }
    emit({ type: 'llm.token', delta: d })
  }

  if (plan.mode === 'compound') {
    // 3a. Fan-out. Phase 1: one scoped hybrid search per specialist, in parallel, measured.
    emit({ type: 'edge', from: 'llm', to: 'vectorstore', label: 'scoped retrieval' })
    const scoped = await withNode(emit, 'vectorstore', `${plan.domains.length} scoped searches`, async () => {
      const all = await Promise.all(plan.domains.map(domain => retrieveFor(domain, lastUser)))
      for (const s of all) emit({ type: 'retrieval.hits', hits: s.hits, ms: s.ms, agent: s.domain, label: `${s.domain} · scoped` })
      return all
    })
    emit({ type: 'edge', from: 'vectorstore', to: 'llm' })
    // Phase 2: specialists in parallel, each with its chunks and tool subset; then a synthesizer streams the reply.
    const results = await withNode(emit, 'llm', `${plan.domains.length} specialists · parallel`, () =>
      Promise.all(scoped.map(s => runSpecialist(s.domain, model, lastUser, s.hits, emit, signal))))
    for (const r of results) { total = addUsage(total, r.usage); artifacts.push(...r.artifacts); evidence.push(contextFor(r.hits), ...r.toolResults) }
    step = 1
    const notes = results.map(r => `## ${r.domain} specialist\n${r.text}`).join('\n\n')
    const t1 = performance.now()
    emit({ type: 'agent.start', agent: 'synthesizer', label: 'merging notes' })
    const synth = await withNode(emit, 'llm', 'synthesizer', async () => {
      emit({ type: 'llm.request', model, step: 2, messageCount: history.length + 2, toolCount: 0, contextChunks: retrieval.hits.length })
      return streamChat({
        model, signal, reasoning: req.reasoning, maxTokens: 900,
        messages: [
          systemMessage(model, SYSTEM_PROMPT),
          { role: 'system', content: `You are the synthesizer. ${results.length} specialist agents answered parts of the question in parallel; merge their notes into one coherent answer. Mention the cards below the answer if any were rendered. Do not add facts beyond the notes and the retrieved context.\n\n${notes}\n\n## Retrieved context\n${contextFor(retrieval.hits)}` },
          ...history.map(m => ({ role: m.role, content: m.content }) as ORMessage),
        ],
        onToken,
        onReasoning: d => emit({ type: 'llm.reasoning', delta: d }),
      })
    })
    total = addUsage(total, synth.usage)
    emit({ type: 'llm.usage', step: 2, usage: synth.usage, agent: 'synthesizer', label: 'synthesizer' })
    emit({ type: synth.usage.cachedTokens > 0 ? 'cache.hit' : 'cache.miss', scope: 'prompt', key: model, detail: `${synth.usage.cachedTokens} prompt tokens read from provider cache` })
    emit({ type: 'agent.end', agent: 'synthesizer', ms: Math.round(performance.now() - t1) })
    finalText = synth.content
    step = 2
  } else {
    // 3b. Direct loop: one LLM with all tools, up to maxSteps.
    const messages: ORMessage[] = [
      systemMessage(model, SYSTEM_PROMPT),
      { role: 'system', content: `Retrieved context (cite nothing, just use it):\n\n${contextFor(retrieval.hits)}` },
      ...history.map(m => ({ role: m.role, content: m.content }) as ORMessage),
    ]
    while (step < config.maxSteps) {
      step++
      const allowTools = step < config.maxSteps
      streaming = false
      const result = await withNode(emit, 'llm', `${model} · step ${step}`, async () => {
        emit({ type: 'llm.request', model, step, messageCount: messages.length, toolCount: allowTools ? toolDefinitions.length : 0, contextChunks: retrieval.hits.length })
        return streamChat({ model, messages, tools: allowTools ? toolDefinitions : [], signal, reasoning: req.reasoning, onToken, onReasoning: d => emit({ type: 'llm.reasoning', delta: d }) })
      })
      total = addUsage(total, result.usage)
      emit({ type: 'llm.usage', step, usage: result.usage })
      if (result.usage.cachedTokens > 0) emit({ type: 'cache.hit', scope: 'prompt', key: model, detail: `${result.usage.cachedTokens} prompt tokens read from provider cache` })
      else emit({ type: 'cache.miss', scope: 'prompt', key: model })
      if (!result.toolCalls.length) { finalText = mergeSteps(preText, result.content, emit); break }
      // Models often write the whole answer in the same step as the tool call: keep it, and separate it from the next step.
      if (result.content.trim()) { preText += (preText ? '\n\n' : '') + result.content; emit({ type: 'llm.token', delta: '\n\n' }) }

      const calls = result.toolCalls.slice(0, 3).map(c => ({ id: c.id, name: c.function.name, args: safeJson(c.function.arguments) }))
      emit({ type: 'llm.tool_calls', calls })
      messages.push({ role: 'assistant', content: result.content || null, tool_calls: result.toolCalls.slice(0, 3), reasoning_details: result.reasoningDetails.length ? result.reasoningDetails : undefined })
      emit({ type: 'edge', from: 'llm', to: 'tools' })
      await withNode(emit, 'tools', calls.map(c => c.name).join(', '), async () => {
        for (const call of calls) {
          const t1 = performance.now()
          emit({ type: 'tool.start', id: call.id, name: call.name, args: call.args })
          const out = await executeTool(call.name, call.args)
          if (out.retrievalHits) {
            const ms = out.retrievalMs ?? 0
            emit({ type: 'edge', from: 'tools', to: 'vectorstore' })
            emit({ type: 'node.enter', node: 'vectorstore', label: 'search_cv' })
            emit({ type: 'retrieval.hits', hits: out.retrievalHits, ms, label: 'search_cv tool' })
            emit({ type: 'node.exit', node: 'vectorstore', ms })
            emit({ type: 'edge', from: 'vectorstore', to: 'tools' })
          }
          emit({ type: 'tool.result', id: call.id, name: call.name, summary: out.summary, ms: Math.round(performance.now() - t1), preview: JSON.stringify(out.result).slice(0, 320) })
          const resultJson = JSON.stringify(out.result).slice(0, 6000)
          evidence.push(resultJson)
          if (out.artifact) {
            artifacts.push(out.artifact)
            emit({ type: 'edge', from: 'tools', to: 'artifacts' })
            emit({ type: 'node.enter', node: 'artifacts', label: out.artifact.kind })
            emit({ type: 'artifact', artifact: out.artifact })
            emit({ type: 'node.exit', node: 'artifacts' })
          }
          messages.push({ role: 'tool', tool_call_id: call.id, content: resultJson })
        }
      })
      emit({ type: 'edge', from: 'tools', to: 'llm', label: 'tool results' })
    }
  }

  // A sentence that points to a card is only valid if a card was actually rendered in this turn.
  if (artifacts.length === 0) {
    const cleaned = stripCardMentions(finalText)
    if (cleaned !== finalText) { finalText = cleaned; emit({ type: 'llm.replace', content: finalText }) }
  }

  // 4. Verifier (same model, separate call) checks the answer against the evidence the pipeline actually used,
  // while the suggester (cheap model) drafts follow-ups in parallel.
  let claims: Claim[] | undefined
  let suggestions: string[] | undefined
  const sugPromise = suggest({ question: lastUser, answer: finalText, asked, signal }, emit)
  try {
    const v = await verify(model, finalText, [`PROFILE SUMMARY (always in the model's context): ${PROFILE_SUMMARY} Email ${identity.email}. LinkedIn ${identity.linkedin}. GitHub ${identity.github}. Site ${identity.site}.`, ...evidence].join('\n\n'), emit, signal)
    if (v) { claims = v.claims; total = addUsage(total, v.usage) }
  } catch (err) {
    console.warn('[verifier]', (err as Error).message)
  }
  const sug = await sugPromise
  if (sug) { suggestions = sug.items; total = addUsage(total, sug.usage) }

  if (useCache && finalText.trim()) {
    responseCache.set(respKey, { text: finalText, artifacts, usage: total, steps: step, claims, suggestions })
    if (retrieval.qvec) semanticRemember(req.sessionId ?? '', { key: respKey, question: lastUser, vec: retrieval.qvec, model, mode, reasoning: !!req.reasoning })
  }
  emit({ type: 'run.end', ms: Math.round(performance.now() - t0), steps: step, usage: total, fromCache: false })
}

export function cacheStats() { return { response: responseCache.size, retrieval: retrievalCache.size } }
