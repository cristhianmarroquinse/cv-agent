import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import type { JobFitRow } from '@cv-agent/shared'
import { completeJson } from '../llm/openrouter.ts'
import { experience, identity, projects, skillGroups } from '../knowledge/cv.data.ts'

/**
 * Tailored CV: one structured-output call selects and orders REAL facts from cv.data.ts for a given role,
 * then pdf-lib lays them out as a one-page PDF. The model never writes free-form claims: every bullet must be
 * copied from the structured data, and the server drops anything it cannot find there.
 */
export interface TailoredCv {
  headline: string
  summary: string
  fit: string[]
  experience: { company: string; role: string; period: string; bullets: string[] }[]
  skills: string[]
  projects: { name: string; line: string }[]
}

const SYSTEM = `You tailor ${identity.name}'s CV to one job. You receive the STRUCTURED CV DATA and the JOB (role, requirements with the fit assessment).
Return JSON only:
{"headline":"<one line, max 90 chars, starts with the target role>",
 "summary":"<3 sentences, factual, written for this job, max 70 words>",
 "fit":["<max 5 short lines mapping a requirement to a concrete fact>"],
 "experience":[{"company":"<exact company from data>","role":"<exact role>","period":"<as in data>","bullets":["<1-4 bullets copied VERBATIM from that company's highlights, most relevant first>"]}],
 "skills":["<8-14 skill names copied from the data, most relevant first>"],
 "projects":[{"name":"<exact project name>","line":"<one line copied from its description or highlights>"}]}
Rules: pick at most 4 experiences (most relevant first, keep chronology within the pick), at most 2 projects. Never invent, never merge facts, never add numbers that are not in the data. Honest gaps stay out of the CV (no apologies).`

function normalize(s: string) { return s.toLowerCase().replace(/\s+/g, ' ').trim() }

/** Keep only bullets/skills that exist in the structured data (verbatim or as a substring either way). */
function ground(cv: TailoredCv): TailoredCv {
  const allHighlights = experience.flatMap(e => e.highlights.map(h => ({ company: e.company, text: h })))
  const skills = new Set(skillGroups.flatMap(g => g.skills.map(s => s.name)))
  const stackWords = new Set(experience.flatMap(e => e.stack ?? []).concat(projects.flatMap(p => p.stack)))
  const exp = (cv.experience ?? []).map(x => {
    const real = experience.find(e => normalize(e.company) === normalize(x.company) || normalize(e.company).includes(normalize(x.company)))
    if (!real) return null
    const bullets = (x.bullets ?? []).filter(b => allHighlights.some(h => h.company === real.company && (normalize(h.text) === normalize(b) || normalize(h.text).includes(normalize(b)) || normalize(b).includes(normalize(h.text)))))
    return { company: real.company, role: real.role, period: `${real.start} – ${real.end}`, bullets: bullets.length ? bullets.slice(0, 4) : real.highlights.slice(0, 2) }
  }).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 4)
  const sk = (cv.skills ?? []).filter(s => skills.has(s) || stackWords.has(s) || [...skills].some(k => normalize(k).includes(normalize(s)))).slice(0, 14)
  const pr = (cv.projects ?? []).map(p => {
    const real = projects.find(r => normalize(r.name) === normalize(p.name) || normalize(r.name).includes(normalize(p.name)))
    if (!real) return null
    const ok = normalize(real.description).includes(normalize(p.line)) || real.highlights.some(h => normalize(h) === normalize(p.line) || normalize(h).includes(normalize(p.line)))
    return { name: real.name, line: ok ? p.line : real.highlights[0] }
  }).filter((x): x is NonNullable<typeof x> => !!x).slice(0, 2)
  return { headline: (cv.headline || identity.headline).slice(0, 110), summary: (cv.summary || '').slice(0, 600), fit: (cv.fit ?? []).slice(0, 5).map(f => f.slice(0, 160)), experience: exp, skills: sk, projects: pr }
}

export async function tailorCv(model: string, role: string, rows: JobFitRow[], jobDescription: string, signal?: AbortSignal): Promise<{ cv: TailoredCv; costUsd: number | null }> {
  const data = { identity: { name: identity.name, headline: identity.headline, location: identity.location }, experience, skills: skillGroups, projects: projects.map(p => ({ name: p.name, description: p.description, highlights: p.highlights, stack: p.stack })) }
  const { data: out, usage } = await completeJson<TailoredCv>({
    model, system: SYSTEM, maxTokens: 1800, signal,
    user: `JOB ROLE: ${role}\nREQUIREMENTS AND FIT:\n${rows.map(r => `- [${r.level}] ${r.requirement}: ${r.evidence}`).join('\n')}\n\nJOB DESCRIPTION (excerpt):\n${jobDescription.slice(0, 2500)}\n\nSTRUCTURED CV DATA:\n${JSON.stringify(data)}`,
  })
  const cv = ground(out ?? { headline: identity.headline, summary: '', fit: [], experience: [], skills: [], projects: [] })
  return { cv, costUsd: usage.costUsd }
}

// ---------- PDF layout ----------

const PAGE = { w: 595.28, h: 841.89, margin: 44 } // A4 portrait, points

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, size) > width && line) { lines.push(line); line = w } else line = next
  }
  if (line) lines.push(line)
  return lines
}

/** Deterministic CV from the structured data, for the 'Download CV' button: no model involved. */
export function genericCv(): TailoredCv {
  return {
    headline: identity.headline,
    summary: 'AI engineer with ten years in software and the last five on AI products. Builds LLM applications that survive production: multi-provider inference gateways with prompt caching and cost attribution, RAG, tool-calling agents, MCP integrations and evaluation harnesses. Full-stack TypeScript and Python, from backend and infrastructure to mobile packaging and payments.',
    fit: [],
    experience: experience.slice(0, 4).map(e => ({ company: e.company, role: e.role, period: `${e.start} – ${e.end}`, bullets: e.highlights.slice(0, 4) })),
    skills: skillGroups.flatMap(g => g.skills.filter(s => s.level >= 4).map(s => s.name)).slice(0, 14),
    projects: projects.filter(p => ['smartcoach', 'gateway'].includes(p.key)).map(p => ({ name: p.name, line: p.highlights[0] })),
  }
}

export async function renderCvPdf(cv: TailoredCv, role: string | null): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(role ? `${identity.name} · CV for ${role}` : `${identity.name} · CV`)
  doc.setAuthor(identity.name)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const ink = rgb(0.1, 0.12, 0.16), muted = rgb(0.4, 0.44, 0.5), accent = rgb(0.05, 0.55, 0.5)
  let page: PDFPage = doc.addPage([PAGE.w, PAGE.h])
  let y = PAGE.h - PAGE.margin
  const width = PAGE.w - PAGE.margin * 2

  const ensure = (needed: number) => { if (y - needed < PAGE.margin) { page = doc.addPage([PAGE.w, PAGE.h]); y = PAGE.h - PAGE.margin } }
  const text = (s: string, opts: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; x?: number; w?: number; gap?: number } = {}) => {
    const size = opts.size ?? 9.5, f = opts.font ?? font, x = opts.x ?? PAGE.margin, w = opts.w ?? width
    for (const line of wrap(s, f, size, w)) { ensure(size + 3); page.drawText(line, { x, y: y - size, size, font: f, color: opts.color ?? ink }); y -= size + (opts.gap ?? 3) }
  }
  const heading = (s: string) => { y -= 8; ensure(20); page.drawText(s.toUpperCase(), { x: PAGE.margin, y: y - 9, size: 8.5, font: bold, color: accent }); y -= 13; page.drawLine({ start: { x: PAGE.margin, y }, end: { x: PAGE.w - PAGE.margin, y }, thickness: 0.6, color: rgb(0.85, 0.87, 0.9) }); y -= 7 }
  const bullet = (s: string) => { const size = 9.2; const lines = wrap(s, font, size, width - 12); ensure(lines.length * (size + 2.5)); lines.forEach((line, i) => { if (i === 0) page.drawText('•', { x: PAGE.margin + 2, y: y - size, size, font, color: muted }); page.drawText(line, { x: PAGE.margin + 12, y: y - size, size, font, color: ink }); y -= size + 2.5 }) }

  // Header
  page.drawText(identity.name, { x: PAGE.margin, y: y - 20, size: 20, font: bold, color: ink }); y -= 26
  text(cv.headline, { size: 10.5, font: bold, color: accent, gap: 4 })
  if (role) text(`Target role: ${role}`, { size: 9, color: muted, gap: 3 })
  text(`${identity.location} · ${identity.email} · ${identity.linkedin.replace('https://', '')} · ${identity.github.replace('https://', '')}`, { size: 8.5, color: muted, gap: 2 })

  heading('Profile')
  text(cv.summary, { size: 9.5, gap: 3 })

  if (cv.fit.length && role) { heading(`Why this fits: ${role}`); for (const f of cv.fit) bullet(f) }

  heading('Experience')
  for (const e of cv.experience) {
    ensure(30)
    page.drawText(`${e.role} · ${e.company}`, { x: PAGE.margin, y: y - 10, size: 10, font: bold, color: ink })
    const period = e.period
    page.drawText(period, { x: PAGE.w - PAGE.margin - font.widthOfTextAtSize(period, 8.5), y: y - 10, size: 8.5, font, color: muted })
    y -= 15
    for (const b of e.bullets) bullet(b)
    y -= 3
  }

  if (cv.projects.length) { heading('Selected projects'); for (const p of cv.projects) { text(p.name, { size: 9.5, font: bold, gap: 1 }); text(p.line, { size: 9.2, gap: 4 }) } }

  heading('Skills')
  text(cv.skills.join('  ·  '), { size: 9.2, gap: 3 })

  heading('Education')
  text('Systems and Computer Engineering · Universidad Nacional de Colombia · 2012–2023', { size: 9.2, gap: 2 })
  text('Technologist in Programming and Software Development · SENA · 2009–2010', { size: 9.2, gap: 2 })
  text('Spanish native · English B2 (professional working proficiency)', { size: 9.2, color: muted, gap: 2 })

  // Footer pinned to the bottom of the first page (never flows onto a new page).
  const first = doc.getPages()[0]
  const note = role ? `Tailored for "${role}". Experience, projects and skills are copied verbatim from Cristhian's structured CV data; the profile and fit lines are generated from that data.` : `Generated from Cristhian's structured CV data · cristhianmarroquinse@gmail.com`
  wrap(note, font, 6.8, width).forEach((line, i) => first.drawText(line, { x: PAGE.margin, y: 20 - i * 9 + 9, size: 6.8, font, color: muted }))
  return doc.save()
}
