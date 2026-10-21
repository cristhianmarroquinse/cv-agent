import type { Usage } from '@cv-agent/shared'
import { completeJson } from '../llm/openrouter.ts'

/**
 * LLM judge for the bake-off. A fixed model that is NOT in the candidate catalog scores how well an answer
 * presents the candidate to a recruiter. Invented facts are disqualifying: grounding <= 2 caps the overall.
 */
export const JUDGE_MODEL = 'google/gemini-2.5-flash'
export const JUDGE_FALLBACK = 'anthropic/claude-haiku-5.5'

export interface JudgeScores { grounding: number; specificity: number; completeness: number; persuasiveness: number; concision: number; presentation: number; note?: string }

const SYSTEM = `You are a strict evaluator of answers produced by an AI assistant that presents a job candidate (Cristhian Marroquin, an AI engineer) to recruiters and technical interviewers.
Score the ANSWER to the QUESTION on five criteria, each an integer from 1 (bad) to 5 (excellent):
- grounding: every fact in the answer is in the REFERENCE FACTS or clearly consistent with them; invented or altered facts (names, numbers, dates, technologies, employers) are disqualifying. If any fact is invented, grounding must be 1 or 2.
- specificity: concrete names, numbers, dates and technologies instead of generic statements.
- completeness: the whole question is answered (or, for unknowns/off-topic, the refusal is clear and offers a useful alternative).
- persuasiveness: after reading it, a recruiter would want to interview the candidate; honest, confident, no filler, no unrequested self-criticism.
- concision: no padding or repetition; appropriate length.
Return JSON only: {"grounding":n,"specificity":n,"completeness":n,"persuasiveness":n,"concision":n,"note":"<one short sentence, the main weakness if any>"}`

function clamp(n: unknown): number { const v = Math.round(Number(n)); return Number.isFinite(v) ? Math.min(5, Math.max(1, v)) : 1 }

export async function judge(opts: { question: string; answer: string; facts: string[]; kind: 'fact' | 'negative'; signal?: AbortSignal }): Promise<{ scores: JudgeScores; usage: Usage; model: string } | null> {
  const user = `QUESTION: ${opts.question}\n\nCASE TYPE: ${opts.kind === 'negative' ? 'adversarial / unknown — the right behaviour is an honest refusal or "not documented", without inventing anything' : 'factual'}\n\nREFERENCE FACTS (regex-like fragments a correct answer contains):\n${opts.facts.map(f => `- ${f}`).join('\n') || '- (none: judge grounding on plausibility and the absence of invented specifics)'}\n\nANSWER:\n${opts.answer.slice(0, 3500)}`
  for (const model of [JUDGE_MODEL, JUDGE_FALLBACK]) {
    try {
      const { data, usage } = await completeJson<Record<string, unknown>>({ model, system: SYSTEM, user, maxTokens: 300, signal: opts.signal })
      if (!data) continue
      const s = { grounding: clamp(data.grounding), specificity: clamp(data.specificity), completeness: clamp(data.completeness), persuasiveness: clamp(data.persuasiveness), concision: clamp(data.concision) }
      let presentation = (s.grounding + s.specificity + s.completeness + s.persuasiveness + s.concision) / 5
      if (s.grounding <= 2) presentation = Math.min(presentation, 2) // invented facts cap the overall
      return { scores: { ...s, presentation: Number(presentation.toFixed(2)), note: typeof data.note === 'string' ? data.note.slice(0, 200) : undefined }, usage, model }
    } catch (err) {
      console.warn(`[judge] ${model} failed:`, (err as Error).message.slice(0, 120))
    }
  }
  return null
}
