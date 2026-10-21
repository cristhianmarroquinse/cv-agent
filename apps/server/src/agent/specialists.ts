import type { Artifact, RetrievalHit, Usage } from '@cv-agent/shared'
import { streamChat, type ORMessage } from '../llm/openrouter.ts'
import { search, contextFor } from '../rag/store.ts'
import { executeTool, toolDefinitions } from './tools.ts'
import { DOMAINS, type Domain } from './planner.ts'
import { identity } from '../knowledge/cv.data.ts'
import type { Emit } from '../events.ts'

export interface ScopedRetrieval { domain: Domain; hits: RetrievalHit[]; ms: number }
export interface SpecialistResult { domain: Domain; text: string; hits: RetrievalHit[]; artifacts: Artifact[]; tools: string[]; usage: Usage; toolResults: string[] }

const system = (domain: Domain) => `You are the "${domain}" specialist agent of ${identity.name}'s interactive CV. Your scope: ${DOMAINS[domain].description}.
The user asked a multi-part question; other specialists cover the other parts. Write compact factual notes (bullets, max 120 words, in English) with EVERYTHING in the retrieved context and tool results that helps answer the question from your angle, even if it only covers part of it. A synthesizer agent will merge all notes into the final reply, so never refuse or discuss scope. Use only the retrieved context and tool results; never invent. Reply "N/A" only if nothing in the context relates to the question at all.
You may call ONE tool if it makes the detail visible to the interviewer (it renders a card).`

const zero = (): Usage => ({ promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: 0 })
const add = (a: Usage, b: Usage): Usage => ({ promptTokens: a.promptTokens + b.promptTokens, completionTokens: a.completionTokens + b.completionTokens, cachedTokens: a.cachedTokens + b.cachedTokens, costUsd: (a.costUsd ?? 0) + (b.costUsd ?? 0) })

/** Phase 1 of a specialist: its scoped hybrid search (measured). Run for all domains in parallel by the orchestrator. */
export async function retrieveFor(domain: Domain, question: string): Promise<ScopedRetrieval> {
  const t0 = performance.now()
  const r = await search(question, 4, DOMAINS[domain].sections)
  return { domain, hits: r.hits, ms: Math.round(performance.now() - t0) }
}

/** Phase 2: the specialist's own LLM call(s) with its tool subset, one optional tool round. Emits every call's usage. */
export async function runSpecialist(domain: Domain, model: string, question: string, hits: RetrievalHit[], emit: Emit, signal: AbortSignal): Promise<SpecialistResult> {
  const t0 = performance.now()
  emit({ type: 'agent.start', agent: domain, label: `${hits.length} chunks · ${DOMAINS[domain].tools.length} tools`, parallel: true })
  const tools = toolDefinitions.filter(t => DOMAINS[domain].tools.includes(t.function.name))
  const messages: ORMessage[] = [
    { role: 'system', content: system(domain) },
    { role: 'system', content: `Retrieved context:\n\n${contextFor(hits)}` },
    { role: 'user', content: question },
  ]
  let usage = zero()
  const artifacts: Artifact[] = []
  const usedTools: string[] = []
  const toolResults: string[] = []

  let res = await streamChat({ model, messages, tools, signal, maxTokens: 400 })
  usage = add(usage, res.usage)
  emit({ type: 'llm.usage', step: 0, usage: res.usage, agent: domain, label: `${domain} · step 1` })
  if (res.toolCalls.length) {
    const call = res.toolCalls[0]
    let args: Record<string, unknown> = {}
    try { args = JSON.parse(call.function.arguments || '{}') } catch { /* ignore */ }
    emit({ type: 'agent.progress', agent: domain, label: `tool ${call.function.name}` })
    // The specialist's tool call travels the same path as the main loop's: llm → tools (→ artifacts) → llm.
    emit({ type: 'edge', from: 'llm', to: 'tools', label: domain })
    emit({ type: 'node.enter', node: 'tools', label: `${call.function.name} (${domain})` })
    emit({ type: 'tool.start', id: call.id, name: call.function.name, args })
    const t1 = performance.now()
    const out = await executeTool(call.function.name, args)
    const toolMs = Math.round(performance.now() - t1)
    emit({ type: 'tool.result', id: call.id, name: call.function.name, summary: out.summary, ms: toolMs, preview: JSON.stringify(out.result).slice(0, 320) })
    usedTools.push(call.function.name)
    const resultJson = JSON.stringify(out.result).slice(0, 4000)
    toolResults.push(resultJson)
    if (out.artifact) {
      artifacts.push(out.artifact)
      emit({ type: 'edge', from: 'tools', to: 'artifacts' })
      emit({ type: 'node.enter', node: 'artifacts', label: out.artifact.kind })
      emit({ type: 'artifact', artifact: out.artifact })
      emit({ type: 'node.exit', node: 'artifacts' })
    }
    emit({ type: 'node.exit', node: 'tools', ms: toolMs })
    emit({ type: 'edge', from: 'tools', to: 'llm', label: 'tool result' })
    messages.push({ role: 'assistant', content: res.content || null, tool_calls: [call] })
    messages.push({ role: 'tool', tool_call_id: call.id, content: resultJson })
    res = await streamChat({ model, messages, tools: [], signal, maxTokens: 400 })
    usage = add(usage, res.usage)
    emit({ type: 'llm.usage', step: 0, usage: res.usage, agent: domain, label: `${domain} · step 2` })
  }
  const text = res.content.trim() || 'N/A'
  emit({ type: 'agent.end', agent: domain, ms: Math.round(performance.now() - t0), summary: text.replace(/\s+/g, ' ').slice(0, 90) })
  return { domain, text, hits, artifacts, tools: usedTools, usage, toolResults }
}
