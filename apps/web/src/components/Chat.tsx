import { useCallback, useEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import { AnimatePresence, motion } from 'motion/react'
import { Send, Database, Cpu, Wrench, Zap, Clock, Coins, Check, Loader2, Brain, ShieldCheck, ShieldAlert, ClipboardList, Users, MessageSquare, MousePointerClick, ArrowDown, ArrowUp, Paperclip, FileText, Sparkles, X as XIcon } from 'lucide-react'
import type { Attachment } from '@cv-agent/shared'
import { ArtifactCard } from './Artifacts.tsx'

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.txt,.md'
const MAX_FILE = 5 * 1024 * 1024
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')
function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve({ name: file.name, mime: file.type, data: String(r.result).split(',')[1] ?? '' })
    r.onerror = () => reject(r.error)
    r.readAsDataURL(file)
  })
}
import { useStore, type Msg, type Phase } from '../lib/store.ts'
import { t } from '../lib/i18n.ts'

export function Chat() {
  const { messages } = useStore()
  const [stuck, setStuck] = useState(true) // true while the user is at (or near) the bottom
  const scroller = useRef<HTMLDivElement>(null)

  // Auto-scroll only while the reader is already at the bottom; never fight a user who scrolled up to read.
  const onScroll = useCallback(() => {
    const el = scroller.current; if (!el) return
    setStuck(el.scrollHeight - el.scrollTop - el.clientHeight < 48)
  }, [])
  useEffect(() => { if (stuck) scroller.current?.scrollTo({ top: scroller.current.scrollHeight }) }, [messages, stuck])
  const jumpDown = () => { scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' }); setStuck(true) }

  return (
    <div className="flex flex-col min-h-0 flex-1">
      <div className="relative flex-1 min-h-0">
        <div ref={scroller} onScroll={onScroll} className="h-full overflow-y-auto px-3 sm:px-4 py-4 space-y-4">
          {messages.length === 0 && <EmptyState />}
          {messages.map(m => <Bubble key={m.id} m={m} />)}
        </div>
        {!stuck && messages.length > 0 && (
          <button onClick={jumpDown} aria-label="scroll to bottom" className="absolute left-1/2 -translate-x-1/2 bottom-3 z-10 rounded-full border border-line bg-panel-2 p-2 text-muted shadow-lg hover:text-text"><ArrowDown size={14} /></button>
        )}
      </div>
      <Composer onSent={() => setStuck(true)} />
    </div>
  )
}

/** Suggestion chips + job-fit toggle + growing textarea. Shared by the chat column and the home screen. */
export function Composer({ onSent, home }: { onSent?: () => void; home?: boolean }) {
  const { send, sending, lang, messages, followups } = useStore()
  const d = t(lang)
  // Progressive suggestions: three fixed openers, then the suggester agent's follow-ups topped up with the curated list.
  const asked = new Set(messages.filter(m => m.role === 'user').map(m => m.content.trim().toLowerCase()))
  const curated = d.suggestions.filter(x => !asked.has(x.q.toLowerCase()))
  const shown: { q: string; multi?: boolean; llm?: boolean }[] = messages.length === 0
    ? curated.filter(x => x.initial)
    : [...followups.filter(x => !asked.has(x.trim().toLowerCase())).map(x => ({ q: x, llm: true })), ...curated.filter(x => !x.initial)].slice(0, 4)
  const [text, setText] = useState('')
  const [jobfit, setJobfit] = useState(false)
  const [file, setFile] = useState<Attachment | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const pickFile = async (f: File | undefined) => {
    if (!f) return
    if (f.size > MAX_FILE) { setFileError(d.attachTooBig); return }
    setFileError(null); setFile(await fileToAttachment(f)); setJobfit(true)
  }

  // Grow the textarea with its content, up to ~8 lines.
  useEffect(() => {
    const el = textarea.current; if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, jobfit ? 220 : 160) + 'px'
  }, [text, jobfit])

  // Focus on the landing without scrolling the hero out of view.
  useEffect(() => { if (home) textarea.current?.focus({ preventScroll: true }) }, [home])

  const go = (value: string, mode: 'chat' | 'jobfit', att?: Attachment) => { void send(value, mode, att); onSent?.() }
  const submit = () => {
    if (sending) return
    if (jobfit && file) { go(text, 'jobfit', file); setText(''); setFile(null); return }
    if (!text.trim()) return
    go(text, jobfit ? 'jobfit' : 'chat'); setText('')
  }
  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Enter') return
    if (jobfit ? (e.metaKey || e.ctrlKey) : !e.shiftKey) { e.preventDefault(); submit() }
  }
  const chip = (active: boolean) => `shrink-0 whitespace-nowrap text-xs px-2.5 py-1.5 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${active ? 'border-accent-2 text-accent-2 bg-accent-2/10' : 'border-line bg-panel text-muted hover:border-accent/60 hover:text-accent'}`

  return (
    <div className={`relative ${home ? 'w-full space-y-2.5' : 'border-t border-line p-2.5 sm:p-3 space-y-2 bg-panel/40'} ${dragging ? 'rounded-lg outline-2 outline-dashed outline-accent/70' : ''}`}
      onDragEnter={e => { if (hasFiles(e)) { e.preventDefault(); setDragging(true) } }}
      onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; setDragging(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragging(false) }}
      onDrop={e => { if (!hasFiles(e)) return; e.preventDefault(); setDragging(false); void pickFile(e.dataTransfer.files[0]) }}>
      {dragging && <div className='absolute inset-0 z-10 grid place-items-center rounded-lg bg-bg/85 text-sm font-medium text-accent pointer-events-none'><span className='flex items-center gap-2'><Paperclip size={16} /> {d.dropHere}</span></div>}
      <div className={`flex gap-1.5 overflow-x-auto pb-0.5 -mx-1 px-1 ${home ? 'sm:flex-wrap sm:overflow-visible sm:justify-center' : 'sm:flex-wrap sm:overflow-visible'}`}>
        <button onClick={() => setJobfit(v => !v)} aria-pressed={jobfit} className={`${chip(jobfit)} flex items-center gap-1`}>
          <ClipboardList size={12} /> {d.jobfit}
        </button>
        <input ref={fileInput} type='file' accept={ACCEPT} className='hidden' onChange={e => { void pickFile(e.target.files?.[0]); e.target.value = '' }} />
        {!jobfit && shown.map(s => (
          <button key={s.q} disabled={sending} onClick={() => go(s.q, 'chat')} title={s.llm ? d.followupHint : s.multi ? d.multiAgent : undefined} className={`${chip(false)} ${s.multi || s.llm ? 'flex items-center gap-1.5' : ''}`}>
            {s.llm && <Sparkles size={12} className='text-blue shrink-0' />}{s.multi && <Users size={12} className='text-accent-2 shrink-0' />}{s.q}
          </button>
        ))}
      </div>
      <div className={`rounded-2xl border bg-panel-2 transition-colors focus-within:border-accent/70 ${dragging ? 'border-accent/70' : 'border-line'}`}>
        {jobfit && (file || fileError) && (
          <div className="flex items-center gap-2 px-3 pt-2.5 text-xs">
            {file && <span className="inline-flex items-center gap-1.5 rounded-md border border-accent-2/40 bg-accent-2/10 px-2 py-1 font-mono text-accent-2"><FileText size={12} /> {file.name} <button onClick={() => setFile(null)} aria-label={d.close} className="hover:text-text"><XIcon size={12} /></button></span>}
            {fileError && <span className="text-err">{fileError}</span>}
          </div>
        )}
        <textarea ref={textarea} value={text} onChange={e => setText(e.target.value)} rows={jobfit ? 4 : 1} placeholder={jobfit ? d.jobfitPlaceholder : d.placeholder} onKeyDown={onKey}
          aria-label={jobfit ? d.jobfit : d.placeholder}
          className={`block w-full bg-transparent resize-none px-4 pt-3 pb-1 leading-6 focus:outline-none ${home ? 'text-base' : 'text-sm'}`} />
        <div className="flex items-center gap-2 px-2.5 pb-2.5">
          <button onClick={() => fileInput.current?.click()} title={d.attachHint} aria-label={d.attach}
            className={`h-8 w-8 rounded-full border grid place-items-center transition-colors ${file ? 'border-accent-2 text-accent-2 bg-accent-2/10' : 'border-line text-muted hover:text-text hover:bg-panel'}`}>
            <Paperclip size={14} />
          </button>
          <span className="hidden sm:inline text-[10.5px] font-mono text-muted/60 ml-1">{jobfit ? d.sendHintJobfit : d.sendHint}</span>
          <button onClick={submit} disabled={sending || (!text.trim() && !(jobfit && file))} aria-label={d.send} title={d.send}
            className="ml-auto h-9 w-9 rounded-full bg-accent text-bg grid place-items-center disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            {sending ? <Loader2 size={16} className="animate-spin" /> : <ArrowUp size={17} strokeWidth={2.5} />}
          </button>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  const lang = useStore(s => s.lang)
  const d = t(lang)
  const icons = [<MessageSquare size={15} key="a" />, <ClipboardList size={15} key="b" />, <MousePointerClick size={15} key="c" />]
  return (
    <div className="h-full min-h-[260px] flex items-center justify-center">
      <div className="max-w-md w-full space-y-4 px-2">
        <h2 className="text-lg font-semibold">{d.emptyTitle}</h2>
        <p className="text-sm text-muted leading-relaxed">{d.intro}</p>
        <ul className="space-y-2">
          {d.emptyPoints.map((p, i) => (
            <li key={p} className="flex gap-2.5 text-sm text-text/85"><span className="mt-0.5 text-accent shrink-0">{icons[i]}</span><span>{p}</span></li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Bubble({ m }: { m: Msg }) {
  const { lang, messages, send, sending, artifacts } = useStore()
  const isLast = messages[messages.length - 1]?.id === m.id
  const d = t(lang)
  const retry = () => {
    const i = messages.findIndex(x => x.id === m.id)
    const prev = messages.slice(0, i).reverse().find(x => x.role === 'user')
    if (prev) void send(prev.content, prev.kind)
  }
  if (m.role === 'user') {
    if (m.kind === 'jobfit') {
      return (
        <div className="flex justify-end">
          <details className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent-2/10 border border-accent-2/30 px-3.5 py-2 text-sm">
            <summary className="cursor-pointer text-accent-2 text-xs font-mono flex items-center gap-1"><ClipboardList size={12} /> {d.jobfitLabel} · {m.content.length} chars</summary>
            <p className="mt-2 text-xs text-muted whitespace-pre-wrap max-h-48 overflow-y-auto">{m.content}</p>
          </details>
        </div>
      )
    }
    return <div className="flex justify-end"><div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent/15 border border-accent/30 px-3.5 py-2 text-sm whitespace-pre-wrap">{m.content}</div></div>
  }
  const streaming = m.status === 'streaming'
  const offline = !!m.error && (/Failed to fetch|NetworkError|Load failed/i.test(m.error) || /^HTTP 5\d\d$/.test(m.error))
  const errorText = offline ? d.apiDown : m.error
  return (
    <div className="flex justify-start">
      <div className={`${m.artifactIds.length ? 'w-full' : 'max-w-[94%]'} min-w-[260px] rounded-2xl rounded-bl-sm bg-panel border border-line px-3.5 py-2.5 text-sm`}>
        {streaming ? <Phases phases={m.phases} /> : m.phases.length > 0 && (
          <details className="mb-1.5">
            <summary className="text-[10.5px] font-mono text-muted cursor-pointer select-none">{m.phases.length} {d.pipelineSteps}</summary>
            <Phases phases={m.phases} />
          </details>
        )}
        {m.reasoning && (
          <details open={streaming} className="mb-2 rounded-md border border-accent-2/30 bg-accent-2/5 px-2.5 py-1.5">
            <summary className="text-[10.5px] font-mono text-accent-2 cursor-pointer select-none flex items-center gap-1"><Brain size={11} /> {d.thinking}</summary>
            <p className="mt-1 text-xs text-muted whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto">{m.reasoning}</p>
          </details>
        )}
        {m.status === 'error' ? (
          <div className="text-err text-xs flex flex-wrap items-center gap-2" role="alert">
            <span>{d.error}: {errorText}</span>
            <button onClick={retry} disabled={sending} className="rounded-md border border-err/40 px-2 py-0.5 text-[11px] hover:bg-err/10 disabled:opacity-40">{d.retry}</button>
          </div>
        ) : m.content ? (
          <div className="prose-chat"><ReactMarkdown>{m.content}</ReactMarkdown></div>
        ) : null}
        {m.artifactIds.map(id => { const a = artifacts.find(x => x.id === id); return a ? <ArtifactCard key={id} a={a} defaultOpen={isLast} /> : null })}
        {m.run && <RunFooter m={m} />}
      </div>
    </div>
  )
}

export function Phases({ phases }: { phases: Phase[] }) {
  const lang = useStore(s => s.lang)
  const d = t(lang)
  return (
    <ul className="font-mono text-[11px] leading-5 mb-1.5" aria-live="polite">
      <AnimatePresence initial={false}>
        {phases.map(p => (
          <motion.li key={p.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} className={`flex items-center gap-1.5 ${p.done ? 'text-muted' : 'text-accent'}`}>
            {p.done ? <Check size={11} className="text-ok shrink-0" /> : <Loader2 size={11} className="animate-spin shrink-0" />}
            <span>{(d.phases[p.key] as (x: string) => string)(p.detail ?? '')}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  )
}

function RunFooter({ m }: { m: Msg }) {
  const run = m.run!
  const v = m.verification
  const lang = useStore(s => s.lang)
  const d = t(lang)
  const Chip = ({ icon, children, tone, title }: { icon: React.ReactNode; children: React.ReactNode; tone?: 'ok' | 'warn' | 'info'; title?: string }) => (
    <span title={title} className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[10.5px] border ${tone === 'ok' ? 'border-ok/40 text-ok' : tone === 'warn' ? 'border-warn/40 text-warn' : tone === 'info' ? 'border-accent-2/40 text-accent-2' : 'border-line text-muted'}`}>{icon}{children}</span>
  )
  const agents = [...new Set(run.agents)]
  const unsupported = v?.claims.filter(c => !c.supported) ?? []
  return (
    <div className="mt-2 pt-2 border-t border-line/70">
      <div className="flex flex-wrap gap-1.5">
        <Chip icon={<Cpu size={11} />} title={d.model}>{run.model.split('/')[1]}</Chip>
        <Chip icon={<Clock size={11} />}>{run.ms}ms · {run.steps} {d.steps}</Chip>
        {run.fromCache
          ? <Chip icon={<Zap size={11} />} tone="ok">{d.cached}</Chip>
          : <Chip icon={<Coins size={11} />} title={d.cost}>{run.usage.promptTokens + run.usage.completionTokens} {d.tokens} · ${(run.usage.costUsd ?? 0).toFixed(5)}</Chip>}
        {run.usage.cachedTokens > 0 && !run.fromCache && <Chip icon={<Zap size={11} />} tone="ok">{d.promptCache}: {run.usage.cachedTokens}</Chip>}
        {run.hits.length > 0 && <Chip icon={<Database size={11} />}>{run.hits.length} chunks</Chip>}
        {run.tools.length > 0 && <Chip icon={<Wrench size={11} />}>{run.tools.join(', ')}</Chip>}
        {agents.length > 0 && <Chip icon={<Users size={11} />} tone="info">{agents.join(' → ')}</Chip>}
        {v && v.total > 0 && (unsupported.length === 0
          ? <Chip icon={<ShieldCheck size={11} />} tone="ok">{v.supported}/{v.total} {d.grounded}</Chip>
          : <Chip icon={<ShieldAlert size={11} />} tone="warn">{v.supported}/{v.total} {d.grounded}</Chip>)}
      </div>
      {unsupported.length > 0 && (
        <ul className="mt-1.5 space-y-0.5">
          {unsupported.map((c, i) => <li key={i} className="text-[11px] text-warn/90 border-l-2 border-warn/50 pl-2"><span className="text-text/80">{c.text}</span>{c.note ? <span className="text-muted"> · {c.note}</span> : null}</li>)}
        </ul>
      )}
    </div>
  )
}
