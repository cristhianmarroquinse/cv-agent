import { AnimatePresence, motion } from 'motion/react'
import { X, Mail, Linkedin, Github, Globe, FileDown, ExternalLink, FileText, Loader2 } from 'lucide-react'
import { useState } from 'react'
import type { Artifact } from '@cv-agent/shared'
import { useStore } from '../lib/store.ts'
import { t } from '../lib/i18n.ts'

const KIND_COLOR: Record<Artifact['kind'], string> = { timeline: '#5eead4', skills: '#a78bfa', project: '#fbbf24', story: '#f472b6', contact: '#34d399', table: '#60a5fa', jobfit: '#a78bfa' }
const FIT: Record<string, string> = { strong: '#4ade80', partial: '#fbbf24', gap: '#f87171' }

export function Artifacts() {
  const { artifacts, removeArtifact, clearArtifacts, lang } = useStore()
  const d = t(lang)
  return (
    <aside className="flex flex-col min-h-0 h-full border-l border-line bg-panel/30">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
        <h2 className="text-xs uppercase tracking-wider text-muted">{d.artifacts} <span className="font-mono">({artifacts.length})</span></h2>
        {artifacts.length > 0 && <button onClick={clearArtifacts} className="text-xs text-muted hover:text-text">{d.clear}</button>}
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {artifacts.length === 0 && <div className="text-sm text-muted p-3 border border-dashed border-line rounded-xl">{d.noArtifacts}</div>}
        <AnimatePresence initial={false}>
          {artifacts.map(a => (
            <motion.article key={a.id} layout initial={{ opacity: 0, y: -14, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 30 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}
              className="rounded-xl border border-line bg-panel overflow-hidden">
              <header className="flex items-center gap-2 px-3 py-2 border-b border-line/70">
                <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded" style={{ color: KIND_COLOR[a.kind], border: `1px solid ${KIND_COLOR[a.kind]}55` }}>{a.kind}</span>
                <h3 className="text-sm font-semibold truncate">{a.title}</h3>
                <button onClick={() => removeArtifact(a.id)} className="ml-auto text-muted hover:text-text"><X size={14} /></button>
              </header>
              <div className="p-3 text-sm"><Render a={a} /></div>
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </aside>
  )
}

/** Inline artifact card used inside chat bubbles. Collapsible; open by default for the latest answer. */
export function ArtifactCard({ a, defaultOpen }: { a: Artifact; defaultOpen: boolean }) {
  return (
    <motion.details open={defaultOpen} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 24 }}
      className='group mt-2 rounded-xl border border-line bg-panel-2/60 overflow-hidden'>
      <summary className='flex items-center gap-2 px-3 py-2 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden'>
        <span className='text-[10px] font-mono uppercase px-1.5 py-0.5 rounded' style={{ color: KIND_COLOR[a.kind], border: `1px solid ${KIND_COLOR[a.kind]}55` }}>{a.kind}</span>
        <h3 className='text-sm font-semibold truncate'>{a.title}</h3>
        <span className='ml-auto text-muted text-[10px] font-mono group-open:hidden'>▸</span>
        <span className='ml-auto text-muted text-[10px] font-mono hidden group-open:inline'>▾</span>
      </summary>
      <div className='px-3 pb-3 text-sm border-t border-line/60 pt-2'><Render a={a} /></div>
    </motion.details>
  )
}

const Chips = ({ items }: { items: string[] }) => (
  <div className="flex flex-wrap gap-1 mt-2">{items.map(s => <span key={s} className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-panel-2 border border-line text-muted">{s}</span>)}</div>
)

function Render({ a }: { a: Artifact }) {
  const lang = useStore(s => s.lang)
  const d = t(lang)
  switch (a.kind) {
    case 'jobfit':
      return (
        <div>
          <TailoredCvButton artifact={a} />
          <div className='flex gap-2 text-[11px] font-mono mb-2'>
            {(['strong', 'partial', 'gap'] as const).map(k => <span key={k} className='px-1.5 py-0.5 rounded border' style={{ color: FIT[k], borderColor: FIT[k] + '66' }}>{a.summary[k]} {d.fit[k]}</span>)}
          </div>
          <ul className='space-y-2'>
            {a.rows.map((r, i) => (
              <li key={i} className='border-l-2 pl-2' style={{ borderColor: FIT[r.level] }}>
                <div className='flex items-start gap-2 text-xs'>
                  <span className='flex-1 font-medium'>{r.requirement}</span>
                  <span className='text-[10px] font-mono text-muted shrink-0'>{r.kind === 'must' ? d.must : d.nice}</span>
                  <span className='text-[10px] font-mono shrink-0' style={{ color: FIT[r.level] }}>{d.fit[r.level]}</span>
                </div>
                <p className='text-[11px] text-muted mt-0.5'>{r.evidence}</p>
              </li>
            ))}
          </ul>
        </div>
      )
    case 'timeline':
      return (
        <ol className="relative border-l border-line ml-2 space-y-4">
          {a.entries.map(e => (
            <li key={e.company + e.start} className="pl-4">
              <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-accent" />
              <div className="font-semibold leading-tight">{e.role} <span className="text-muted font-normal">· {e.company}</span></div>
              <div className="text-[11px] font-mono text-muted">{e.start} → {e.end}{e.location ? ` · ${e.location}` : ''}</div>
              <ul className="mt-1 list-disc pl-4 text-xs text-text/90 space-y-0.5">{e.highlights.slice(0, 4).map(h => <li key={h}>{h}</li>)}</ul>
              {e.stack && <Chips items={e.stack.slice(0, 8)} />}
            </li>
          ))}
        </ol>
      )
    case 'skills':
      return (
        <div className="space-y-3">
          {a.groups.map(g => (
            <div key={g.name}>
              <div className="text-xs uppercase tracking-wider text-muted mb-1">{g.name}</div>
              <div className="space-y-1">
                {g.skills.map(s => (
                  <div key={s.name} className="flex items-center gap-2 text-xs">
                    <span className="flex-1 truncate">{s.name}</span>
                    <span className="flex gap-0.5">{[1, 2, 3, 4, 5].map(i => <span key={i} className="h-1.5 w-4 rounded-sm" style={{ background: i <= s.level ? '#a78bfa' : '#233047' }} />)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )
    case 'project': {
      const p = a.project
      return (
        <div>
          <div className="text-[11px] font-mono text-muted">{p.period} · {p.context}</div>
          <p className="mt-1 text-text/90">{p.description}</p>
          <ul className="mt-2 list-disc pl-4 text-xs space-y-0.5">{p.highlights.map(h => <li key={h}>{h}</li>)}</ul>
          <Chips items={p.stack} />
          {p.link && <a href={p.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 mt-2 text-xs text-accent">{p.link.replace('https://', '')} <ExternalLink size={11} /></a>}
          {p.honesty && <div className="mt-2 text-[11px] text-warn/90 border-l-2 border-warn/50 pl-2">{p.honesty}</div>}
        </div>
      )
    }
    case 'story': {
      const s = a.story
      const Sec = ({ k, v }: { k: string; v: string }) => <div><div className="text-[10px] uppercase tracking-wider text-muted">{k}</div><p className="text-xs text-text/90">{v}</p></div>
      return (
        <div className="space-y-2">
          <Sec k="Situation" v={s.situation} /><Sec k="Task" v={s.task} /><Sec k="Action" v={s.action} /><Sec k="Result" v={s.result} />
          <Chips items={s.tags} />
        </div>
      )
    }
    case 'contact':
      return (
        <div className="space-y-1.5">
          <div className="font-semibold">{a.name}</div>
          <div className="text-xs text-muted">{a.headline}</div>
          <div className="text-xs text-muted">{a.location}</div>
          <div className="grid grid-cols-1 gap-1 pt-1 text-xs">
            <a className="flex items-center gap-2 text-accent" href={`mailto:${a.email}`}><Mail size={13} />{a.email}</a>
            <a className="flex items-center gap-2 text-accent" href={a.linkedin} target="_blank" rel="noreferrer"><Linkedin size={13} />LinkedIn</a>
            <a className="flex items-center gap-2 text-accent" href={a.github} target="_blank" rel="noreferrer"><Github size={13} />GitHub</a>
            <a className="flex items-center gap-2 text-accent" href={a.site} target="_blank" rel="noreferrer"><Globe size={13} />smartcoachapp.com</a>
          </div>
          <a href={a.cvUrl} className="inline-flex items-center gap-1.5 mt-2 rounded-md bg-accent text-bg text-xs font-medium px-2.5 py-1.5"><FileDown size={13} />CV</a>
        </div>
      )
    case 'table':
      return (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead><tr className="text-muted text-left">{a.columns.map(c => <th key={c} className="pr-2 pb-1 font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
            <tbody>{a.rows.map((r, i) => <tr key={i} className="border-t border-line/60">{r.map((c, j) => <td key={j} className={`pr-2 py-1 whitespace-nowrap ${j > 1 ? 'font-mono' : ''}`}>{c}</td>)}</tr>)}</tbody>
          </table>
          {a.caption && <div className="text-[10.5px] text-muted mt-1">{a.caption}</div>}
        </div>
      )
  }
}

/** Asks the server for a CV tailored to the analysed job and downloads the PDF. */
function TailoredCvButton({ artifact }: { artifact: Extract<Artifact, { kind: 'jobfit' }> }) {
  const { lang, model, messages } = useStore()
  const d = t(lang)
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const jobDescription = [...messages].reverse().find(m => m.role === 'user' && m.kind === 'jobfit')?.content ?? artifact.role
  const run = async () => {
    setState('busy')
    try {
      const res = await fetch('/api/cv/tailored', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model, role: artifact.role, rows: artifact.rows, jobDescription }) })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const name = res.headers.get('Content-Disposition')?.match(/filename='([^']+)'/)?.[1] ?? 'Cristhian-Marroquin-CV.pdf'
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = name; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setState('done')
    } catch { setState('error') }
  }
  return (
    <button onClick={run} disabled={state === 'busy'} title={d.tailoredCvHint}
      className='mb-3 w-full flex items-center justify-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent hover:bg-accent/15 disabled:opacity-60'>
      {state === 'busy' ? <Loader2 size={13} className='animate-spin' /> : <FileText size={13} />}
      {state === 'busy' ? d.generating : state === 'done' ? d.tailoredCvDone + ' · ' + d.tailoredCv : state === 'error' ? d.error : d.tailoredCv}
    </button>
  )
}
