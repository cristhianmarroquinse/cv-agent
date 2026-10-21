import type { Usage } from '@cv-agent/shared'
import { config } from '../config.ts'
import { estimateCost, findModel } from './models.ts'

export type ORMessage =
  | { role: 'system'; content: string | { type: 'text'; text: string; cache_control?: { type: 'ephemeral' } }[] }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ORToolCall[]; reasoning_details?: unknown[] }
  | { role: 'tool'; tool_call_id: string; content: string }

export interface ORToolCall { id: string; type: 'function'; function: { name: string; arguments: string } }
export interface ORTool { type: 'function'; function: { name: string; description: string; parameters: Record<string, unknown> } }

export interface StreamResult { content: string; reasoning: string; reasoningDetails: unknown[]; toolCalls: ORToolCall[]; usage: Usage; finishReason: string | null }

/**
 * Streams one chat-completions call through OpenRouter (OpenAI-compatible SSE) and
 * reassembles text + tool-call deltas. `usage.include` makes OpenRouter append usage
 * (with cached tokens and real cost) to the final chunk.
 */
export async function streamChat(opts: {
  model: string
  messages: ORMessage[]
  tools?: ORTool[]
  signal?: AbortSignal
  reasoning?: boolean
  maxTokens?: number
  temperature?: number
  onToken?: (delta: string) => void
  onReasoning?: (delta: string) => void
}): Promise<StreamResult> {
  const res = await fetch(`${config.openRouterBase}/chat/completions`, {
    method: 'POST',
    signal: opts.signal,
    headers: {
      Authorization: `Bearer ${config.openRouterKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': config.siteUrl,
      'X-Title': config.siteTitle,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      tools: opts.tools?.length ? opts.tools : undefined,
      stream: true,
      // Anthropic rejects a custom temperature when extended thinking is on.
      temperature: opts.reasoning ? undefined : (opts.temperature ?? 0.3),
      // Some models (DeepSeek V4, Haiku 5.5) think by default and burn the token budget on it: turn it off unless asked.
      reasoning: reasoningParam(opts.model, !!opts.reasoning),
      max_tokens: opts.maxTokens ?? 1200,
      usage: { include: true },
    }),
  })
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 300)}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  const reasoningDetails: unknown[] = []
  let finishReason: string | null = null
  const calls = new Map<number, ORToolCall>()
  let usage: Usage = { promptTokens: 0, completionTokens: 0, cachedTokens: 0, costUsd: null }

  const handle = (json: any) => {
    const choice = json.choices?.[0]
    if (choice?.delta?.content) { content += choice.delta.content; opts.onToken?.(choice.delta.content) }
    if (typeof choice?.delta?.reasoning === 'string' && choice.delta.reasoning) { reasoning += choice.delta.reasoning; opts.onReasoning?.(choice.delta.reasoning) }
    if (Array.isArray(choice?.delta?.reasoning_details)) reasoningDetails.push(...choice.delta.reasoning_details)
    for (const tc of choice?.delta?.tool_calls ?? []) {
      const idx = tc.index ?? 0
      const cur = calls.get(idx) ?? { id: tc.id ?? `call_${idx}`, type: 'function' as const, function: { name: '', arguments: '' } }
      if (tc.id) cur.id = tc.id
      if (tc.function?.name) cur.function.name += tc.function.name
      if (tc.function?.arguments) cur.function.arguments += tc.function.arguments
      calls.set(idx, cur)
    }
    if (choice?.finish_reason) finishReason = choice.finish_reason
    if (json.usage) {
      const cached = json.usage.prompt_tokens_details?.cached_tokens ?? 0
      const m = findModel(opts.model)
      usage = {
        promptTokens: json.usage.prompt_tokens ?? 0,
        completionTokens: json.usage.completion_tokens ?? 0,
        cachedTokens: cached,
        costUsd: typeof json.usage.cost === 'number' ? json.usage.cost : m ? estimateCost(m, json.usage.prompt_tokens ?? 0, json.usage.completion_tokens ?? 0, cached) : null,
      }
    }
    if (json.error) throw new Error(json.error.message ?? 'OpenRouter stream error')
  }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') continue
      try { handle(JSON.parse(payload)) } catch (e) { if ((e as Error).message.includes('OpenRouter')) throw e }
    }
  }
  return { content, reasoning, reasoningDetails: mergeReasoningDetails(reasoningDetails), toolCalls: [...calls.values()], usage, finishReason }
}

/** Streamed reasoning_details arrive as fragments; merge consecutive text fragments of the same block so they can be echoed back. */
function mergeReasoningDetails(parts: any[]): unknown[] {
  const out: any[] = []
  for (const p of parts) {
    const last = out[out.length - 1]
    if (last && last.type === p.type && p.type === 'reasoning.text' && (last.index ?? 0) === (p.index ?? 0)) { last.text = (last.text ?? '') + (p.text ?? ''); if (p.signature) last.signature = p.signature; continue }
    out.push({ ...p })
  }
  return out
}

/** Non-streaming helper for small structured calls (planner, verifier, extractor): returns parsed JSON or null. */
export async function completeJson<T>(opts: { model: string; system: string; user: string; maxTokens?: number; signal?: AbortSignal }): Promise<{ data: T | null; raw: string; usage: Usage }> {
  const r = await streamChat({ model: opts.model, messages: [{ role: 'system', content: opts.system }, { role: 'user', content: opts.user }], signal: opts.signal, maxTokens: opts.maxTokens ?? 400, temperature: 0 })
  return { data: extractJson<T>(r.content), raw: r.content, usage: r.usage }
}

export function extractJson<T>(text: string): T | null {
  const start = text.indexOf('{'); const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try { return JSON.parse(text.slice(start, end + 1)) as T } catch { return null }
}

/** Some models think by default and burn the budget (DeepSeek V4, Haiku 5.5): disable it. OpenAI gpt-5 cannot disable reasoning, so ask for the minimum. */
function reasoningParam(model: string, wanted: boolean): Record<string, unknown> {
  if (wanted) return { effort: 'low' }
  if (model.startsWith('openai/')) return { effort: 'minimal', exclude: true }
  return { enabled: false }
}
