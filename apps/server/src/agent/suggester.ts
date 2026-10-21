import type { Usage } from '@cv-agent/shared'
import { completeJson } from '../llm/openrouter.ts'
import { identity } from '../knowledge/cv.data.ts'
import type { Emit } from '../events.ts'

/**
 * Follow-up suggester: the cheapest model in the catalog proposes the next three questions an interviewer could
 * ask, grounded in the answer just given and avoiding what was already asked. Runs after the answer, in parallel
 * with the verifier, so it never adds latency to the reply.
 */
export const SUGGESTER_MODEL = 'deepseek/deepseek-v4.1-flash'

const SYSTEM = `You propose follow-up questions for an interviewer chatting with ${identity.name}'s interactive CV (an AI engineer: LLM apps, tool calling, RAG, agents, evals, TypeScript/Python).
Return JSON only: {"suggestions":["<q1>","<q2>","<q3>"]}
Rules: exactly 3 questions, each under 80 characters, in the SAME LANGUAGE as the last user message, phrased as the interviewer would type them, naming him ("Cristhian", "Cristhian's") instead of pronouns like "he" or "his". Make them specific and different from each other: one digging deeper into the answer, one opening a different area of his profile (experience, projects, skills, stories, fit for a role), one practical (contact, availability, a concrete example). Never repeat or rephrase a question from the ALREADY ASKED list. No questions outside his professional profile.`

export async function suggest(opts: { question: string; answer: string; asked: string[]; signal?: AbortSignal }, emit: Emit): Promise<{ items: string[]; usage: Usage } | null> {
  const t0 = performance.now()
  emit({ type: 'agent.start', agent: 'suggester', label: SUGGESTER_MODEL.split('/')[1] })
  try {
    const { data, usage } = await completeJson<{ suggestions: string[] }>({
      model: SUGGESTER_MODEL, system: SYSTEM, maxTokens: 300, signal: opts.signal,
      user: `ALREADY ASKED:\n${opts.asked.map(a => `- ${a}`).join('\n') || '- (none)'}\n\nLAST QUESTION: ${opts.question}\n\nANSWER GIVEN:\n${opts.answer.slice(0, 2500)}`,
    })
    const asked = new Set(opts.asked.map(a => a.trim().toLowerCase()))
    const items = (Array.isArray(data?.suggestions) ? data!.suggestions : []).filter(s => typeof s === 'string').map(s => s.trim()).filter(s => s.length > 8 && s.length <= 120 && !asked.has(s.toLowerCase())).slice(0, 3)
    emit({ type: 'llm.usage', step: 0, usage, agent: 'suggester', label: SUGGESTER_MODEL })
    emit({ type: 'suggestions', items })
    emit({ type: 'agent.end', agent: 'suggester', ms: Math.round(performance.now() - t0), summary: `${items.length} follow-ups` })
    return { items, usage }
  } catch (err) {
    emit({ type: 'agent.end', agent: 'suggester', ms: Math.round(performance.now() - t0), summary: 'unavailable' })
    console.warn('[suggester]', (err as Error).message)
    return null
  }
}
