import type { Claim, Usage } from '@cv-agent/shared'
import { completeJson } from '../llm/openrouter.ts'
import { loadKnowledgeMarkdown } from '../rag/store.ts'
import { experience, identity, projects, skillGroups, stories } from '../knowledge/cv.data.ts'
import type { Emit } from '../events.ts'

/**
 * Grounding verifier, two passes:
 *  1. Deterministic: every named entity / technology / number in the answer is looked up in the evidence and in the
 *     whole knowledge base. Terms that exist nowhere are "unknown" and any claim built on them is unsupported, no
 *     matter what the model says.
 *  2. LLM: claim extraction at entity level (names, numbers, dates, scope words like "all models"), with the unknown
 *     terms passed as hints. Negations, refusals and "not documented" statements are not claims.
 * The calibration set in evals/verifier-calibration.ts measures its precision and recall.
 */

const SYSTEM = `You are a strict grounding verifier for an AI assistant that presents a candidate's CV to recruiters. You receive the EVIDENCE (retrieved CV chunks, tool results and a profile summary) and the ANSWER.
Extract the factual claims in the ANSWER (max 8; one claim per distinct fact) and check each one against the EVIDENCE at the level of named entities, technologies, numbers, dates and scope words.
A claim is "supported" only if every specific element in it appears in the evidence or follows directly from it: the technology must be attached to the same company/project as in the evidence (NestJS listed under Walmart does not support "NestJS at AiKit"), numbers must match, and scope words ("all models", "every provider", "always") must be in the evidence. Paraphrases and summaries are fine; added specifics are not.
Statements attributed to Cristhian as his opinion or design preference are supported when the evidence contains that opinion (the "Design opinions" section). Not claims (skip them): negations and refusals ("the CV does not mention X", "I can't confirm", "not documented"), meta sentences ("the card below shows…"), greetings, and offers to help.
You may receive HINTS listing terms from the answer that appear nowhere in the whole CV: any claim that relies on one of them is unsupported.
Answer with JSON only: {"claims":[{"text":"<short claim>","supported":true|false,"note":"<which element is missing or mismatched, only if unsupported>"}]}`

// ---------- deterministic term check ----------

const STOP = new Set(('the a an and or of in on at to for with from by as is are was were be been it its he his him she her they their this that these those i you we our your ' +
  'cristhian marroquin ai llm cv rag mcp api apis sdk ui ux http https json pdf html css sql rest sse es en b2 ' +
  'el la los las un una y o de del en es son que con por para su sus al lo como se ha fue este esta esto cual qué sí no ' +
  'jun jul aug sep oct nov dec jan feb mar apr may ene abr ago dic ' +
  'yes no ok also here there when where which what who how why if then than more most less least very only just').split(' '))

const TECH_TOKEN = /^[A-Za-z][A-Za-z0-9+#.-]*$/
function looksTechnical(tok: string): boolean {
  // internal capitals (NestJS, LanceDB, OpenRouter), digits (GPT-5, Odoo 18), dots between letters (Next.js), all caps 2-6 (AWS, ECS)
  return /[a-z][A-Z]/.test(tok) || /\d/.test(tok) || /[a-z]\.[a-z]/i.test(tok) || /^[A-Z]{2,6}$/.test(tok)
}

/** Candidate terms worth checking: proper nouns (not at sentence start), tech-looking tokens, and numbers with units. */
export function extractTerms(text: string): string[] {
  const out = new Set<string>()
  // Phrases: sentences split again at commas, slashes and conjunctions so lists do not merge into one term.
  const sentences = text.split(/(?<=[.!?:])\s+|\n+|[,;/()]|\s(?:and|or|y|o|e|u|vs\.?|with|con)\s/i)
  for (const sentence of sentences) {
    const toks = sentence.replace(/[*_`"“”\[\]{}<>]/g, ' ').split(/\s+/).filter(Boolean)
    let run: string[] = []
    const flush = () => { if (run.length) { const t = run.join(' '); if (!STOP.has(t.toLowerCase())) out.add(t) } run = [] }
    toks.forEach((raw, i) => {
      const tok = raw.replace(/[.:!?]+$/, '')
      if (!tok) { flush(); return }
      const isCap = /^[A-ZÁÉÍÓÚÑ]/.test(tok) && TECH_TOKEN.test(tok.replace(/[áéíóúñÁÉÍÓÚÑ]/g, 'a'))
      const tech = looksTechnical(tok)
      const atStart = i === 0
      if ((isCap && !atStart) || tech) { if (!STOP.has(tok.toLowerCase())) run.push(tok) } else flush()
    })
    flush()
  }
  for (const m of text.matchAll(/\b\d[\d.,]*\s?(?:%|ms|s\b|k\b|€|\$|usd|users?|años|years?|months?|tokens?|tests?|cases?|tickets?|commits?)/gi)) out.add(m[0].trim())
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) out.add(m[0])
  return [...out].filter(t => t.length >= 2)
}

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9%$€#.]+/g, ' ').replace(/\.(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim()
const hasWord = (h: string, w: string) => (' ' + h + ' ').includes(' ' + w + ' ')
export function present(term: string, haystack: string): boolean {
  const t = norm(term), h = haystack
  if (!t) return true
  if (hasWord(h, t)) return true
  // multi-word proper nouns: accept if every word is present (order-insensitive), e.g. "Marketplace Chile" vs "Chile Marketplace"
  const words = t.split(' ').filter(w => w.length > 1)
  return words.length > 1 && words.every(w => hasWord(h, w))
}

let kbCache: string | null = null
async function knowledgeText(): Promise<string> {
  if (kbCache) return kbCache
  const md = await loadKnowledgeMarkdown()
  const data = JSON.stringify({ identity, experience, skillGroups, projects, stories })
  kbCache = norm(md + ' ' + data)
  return kbCache
}

export interface TermCheck { unknown: string[]; offEvidence: string[] }
export async function checkTerms(answer: string, evidence: string): Promise<TermCheck> {
  const kb = await knowledgeText()
  const ev = norm(evidence)
  const unknown: string[] = [], offEvidence: string[] = []
  for (const term of extractTerms(answer)) {
    if (present(term, ev)) continue
    if (present(term, kb)) offEvidence.push(term)
    else unknown.push(term)
  }
  return { unknown, offEvidence }
}

const NEGATION = /\b(does not|doesn't|did not|didn't|is not|isn't|cannot|can't|not (?:documented|mentioned|stated|listed|specified|in the cv)|no (?:tiene|tengo|consta|está|hay|menciona|aparece)|i (?:can't|cannot|don't|won't))\b/i

// ---------- main entry ----------

/** Second-opinion agent: checks the final answer against the evidence the pipeline actually used. */
export async function verify(model: string, answer: string, evidence: string, emit: Emit, signal: AbortSignal): Promise<{ claims: Claim[]; usage: Usage; terms: TermCheck } | null> {
  if (answer.trim().length < 80) return null
  const t0 = performance.now()
  emit({ type: 'agent.start', agent: 'verifier', label: 'grounding check' })
  const terms = await checkTerms(answer, evidence)
  const hints = terms.unknown.length ? `\n\nHINTS — these terms from the answer appear NOWHERE in the CV: ${terms.unknown.join(', ')}` : ''
  const { data, usage } = await completeJson<{ claims: Claim[] }>({
    model, system: SYSTEM, maxTokens: 1200, signal,
    user: `EVIDENCE:\n${evidence.slice(0, 12000)}\n\nANSWER:\n${answer.slice(0, 4000)}${hints}`,
  })
  let claims = (Array.isArray(data?.claims) ? data!.claims : []).filter(c => typeof c?.text === 'string').slice(0, 8).map(c => ({ text: c.text, supported: !!c.supported, note: c.note }))
  // Negations and refusals are neutral: never count them.
  claims = claims.filter(c => !NEGATION.test(c.text))
  // Deterministic override: a claim that mentions a term unknown to the whole CV cannot be supported.
  for (const c of claims) {
    const hit = terms.unknown.find(t => present(t, norm(c.text)))
    if (hit && c.supported) { c.supported = false; c.note = `mentions "${hit}", which appears nowhere in the CV` }
  }
  const supported = claims.filter(c => c.supported).length
  emit({ type: 'verification', claims, supported, total: claims.length })
  emit({ type: 'agent.end', agent: 'verifier', ms: Math.round(performance.now() - t0), summary: claims.length ? `${supported}/${claims.length} claims grounded` : 'no claims' })
  return { claims, usage, terms }
}
