import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { FlaskConical, Play, Loader2, Check, X as XIcon, Zap, Trophy, KeyRound, ChevronDown, ChevronUp } from 'lucide-react'
import { useStore } from '../lib/store.ts'

type Kind = 'fact' | 'negative' | 'retrieval'
interface JudgeScores { grounding: number; specificity: number; completeness: number; persuasiveness: number; concision: number; presentation: number; note?: string }
interface CaseRow { id: string; kind: Kind; question: string; pass: boolean; matched: string[]; missing: string[]; forbidden: string[]; recall?: number; hitSections?: string[]; grounded: { supported: number; total: number } | null; judge?: JudgeScores; ms: number; costUsd: number; answer: string }
interface ModelReport { model: string; at: number; factsPass: number; factsTotal: number; negativesPass: number; negativesTotal: number; retrievalRecall: number; judge: JudgeScores; groundedRatio: number; avgMs: number; totalMs: number; totalCostUsd: number; cases: CaseRow[] }
interface Calibration { at: number; model: string; precision: number; recall: number }
interface Report { at: number; judgeModel: string; models: ModelReport[]; verifierCalibration?: Calibration }

const ADMIN_KEY = 'cv-agent.evals.adminKey'

const L = {
  es: {
    title: 'Model bake-off', button: 'Evals',
    sub: 'Informe precalculado: el conjunto dorado (10 preguntas de hechos, 4 adversariales y 4 de recuperación) pasa por el pipeline real con la caché apagada, y un juez LLM independiente puntúa cada respuesta como si presentara al candidato a un reclutador. Los hechos inventados descalifican.',
    judge: 'juez', date: 'generado', model: 'Modelo', facts: 'Hechos', negatives: 'Adversariales', recall: 'Recall@5', presentation: 'Juez', grounded: 'Verificador', latency: 'Latencia media', cost: 'Coste / run',
    best: 'Mejor para presentar el perfil', bestHint: 'mayor puntuación del juez con fundamentación del verificador ≥ 90 %',
    sub1: 'fundamentación', sub2: 'concreción', sub3: 'completitud', sub4: 'persuasión', sub5: 'concisión',
    calibration: 'Calibración del verificador', precision: 'precisión', recallWord: 'recall', cases: 'casos', showCases: 'Ver casos', hideCases: 'Ocultar casos',
    question: 'Pregunta', result: 'Resultado', missing: 'Faltan', pass: 'OK', fail: 'FALLO', forbidden: 'prohibidos', kinds: { fact: 'hecho', negative: 'adversarial', retrieval: 'recuperación' },
    noReport: 'Todavía no hay informe. Se genera con `bun run bakeoff` en el servidor.', precomputed: 'El informe es precalculado; volver a ejecutarlo requiere la clave de administración.',
    adminKey: 'Clave de administración', rerun: 'Re-ejecutar', running: 'Ejecutando…', forModel: 'para el modelo seleccionado', error: 'Error', close: 'Cerrar', loading: 'Cargando…', cached: 'ya en el informe',
  },
  en: {
    title: 'Model bake-off', button: 'Evals',
    sub: 'Precomputed report: the golden set (10 fact questions, 4 adversarial, 4 retrieval) runs through the real pipeline with the cache off, and an independent LLM judge scores every answer as if presenting the candidate to a recruiter. Invented facts are disqualifying.',
    judge: 'judge', date: 'generated', model: 'Model', facts: 'Facts', negatives: 'Adversarial', recall: 'Recall@5', presentation: 'Judge', grounded: 'Verifier', latency: 'Avg latency', cost: 'Cost / run',
    best: 'Best for presenting the profile', bestHint: 'highest judge score with verifier grounding ≥ 90%',
    sub1: 'grounding', sub2: 'specificity', sub3: 'completeness', sub4: 'persuasiveness', sub5: 'concision',
    calibration: 'Verifier calibration', precision: 'precision', recallWord: 'recall', cases: 'cases', showCases: 'Show cases', hideCases: 'Hide cases',
    question: 'Question', result: 'Result', missing: 'Missing', pass: 'PASS', fail: 'FAIL', forbidden: 'forbidden', kinds: { fact: 'fact', negative: 'adversarial', retrieval: 'retrieval' },
    noReport: 'No report yet. It is generated with `bun run bakeoff` on the server.', precomputed: 'The report is precomputed; re-running it needs the admin key.',
    adminKey: 'Admin key', rerun: 'Re-run', running: 'Running…', forModel: 'for the selected model', error: 'Error', close: 'Close', loading: 'Loading…', cached: 'already in the report',
  },
} as const

export function EvalsButton() {
  const [open, setOpen] = useState(false)
  const lang = useStore(s => s.lang)
  const d = L[lang]
  return (
    <>
      <button onClick={() => setOpen(true)} title={d.sub} aria-haspopup="dialog"
        className="flex items-center gap-1 text-xs font-mono border rounded-md px-2 py-1.5 transition-colors border-line text-muted hover:text-text">
        <FlaskConical size={13} /> {d.button}
      </button>
      <EvalsModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

const tone = (v: number, good: number, ok: number) => (v >= good ? 'text-ok' : v >= ok ? 'text-warn' : 'text-err')

export function EvalsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { lang, model, models } = useStore()
  const d = L[lang]
  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [adminKey, setAdminKey] = useState<string>(() => { try { return sessionStorage.getItem(ADMIN_KEY) ?? '' } catch { return '' } })
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<CaseRow[]>([])
  const closeRef = useRef<HTMLButtonElement>(null)

  const load = async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch('/api/evals/report')
      if (res.status === 404) { setReport(null); return }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setReport(await res.json())
    } catch (err) { setError((err as Error).message) } finally { setLoading(false) }
  }

  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    void load()
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const saveKey = (k: string) => { setAdminKey(k); try { if (k) sessionStorage.setItem(ADMIN_KEY, k); else sessionStorage.removeItem(ADMIN_KEY) } catch { /* ignore */ } }

  const rerun = async () => {
    if (running) return
    setRunning(true); setError(null); setProgress([])
    try {
      const res = await fetch('/api/evals/run?force=1', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-key': adminKey }, body: JSON.stringify({ model }) })
      if (!res.ok || !res.body) { const b = await res.json().catch(() => ({})) as { error?: string }; throw new Error(b.error ?? `HTTP ${res.status}`) }
      const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buf += dec.decode(value, { stream: true })
        let i: number
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i); buf = buf.slice(i + 2)
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue
            let e: any; try { e = JSON.parse(line.slice(5)) } catch { continue }
            if (e.type === 'eval.case') setProgress(p => [...p.filter(x => x.id !== e.id), e])
            else if (e.type === 'error') throw new Error(e.message)
          }
        }
      }
      await load()
    } catch (err) { setError((err as Error).message) } finally { setRunning(false); setProgress([]) }
  }

  const label = (id: string) => models.find(m => m.id === id)?.label ?? id.split('/')[1] ?? id
  const best = report?.models.filter(m => m.groundedRatio >= 0.9).sort((a, b) => b.judge.presentation - a.judge.presentation)[0]
  const fmtDate = (ts: number) => new Date(ts).toLocaleString(lang === 'es' ? 'es-ES' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' })

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="evals-backdrop" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/70 backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="evals-title" onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-5xl max-h-[88dvh] overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl shadow-black/50 p-5 space-y-4">
            <div className="flex items-center gap-2">
              <FlaskConical size={16} className="text-accent" />
              <h3 id="evals-title" className="text-base font-semibold">{d.title}</h3>
              {report && <span className="ml-2 text-[10.5px] font-mono text-muted">{d.judge}: {report.judgeModel.split('/')[1]} · {d.date} {fmtDate(report.at)}</span>}
              <button ref={closeRef} onClick={onClose} aria-label={d.close} className="ml-auto rounded-md p-1.5 text-muted hover:text-text hover:bg-panel-2"><XIcon size={16} /></button>
            </div>
            <p className="text-xs text-muted leading-relaxed">{d.sub}</p>

            {loading && <p className="text-xs text-muted">{d.loading}</p>}
            {error && <p className="text-xs text-err" role="alert">{d.error}: {error}</p>}
            {!loading && !report && !error && <p className="text-xs text-muted">{d.noReport}</p>}

            {report && best && (
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ok/40 bg-ok/5 px-3 py-2 text-sm">
                <Trophy size={15} className="text-ok" />
                <span className="font-semibold">{d.best}:</span>
                <span className="font-mono">{label(best.model)}</span>
                <span className="font-mono text-ok">{best.judge.presentation.toFixed(2)} / 5</span>
                <span className="text-[10.5px] text-muted">· {d.bestHint}</span>
              </div>
            )}

            {report && (
              <div className="overflow-x-auto rounded-md border border-line">
                <table className="w-full text-[11.5px]">
                  <thead className="text-muted text-left bg-panel-2/60">
                    <tr>
                      <th className="px-2 py-1.5 font-medium">{d.model}</th>
                      <th className="px-2 py-1.5 font-medium">{d.facts}</th>
                      <th className="px-2 py-1.5 font-medium">{d.negatives}</th>
                      <th className="px-2 py-1.5 font-medium">{d.recall}</th>
                      <th className="px-2 py-1.5 font-medium">{d.presentation}</th>
                      <th className="px-2 py-1.5 font-medium">{d.grounded}</th>
                      <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">{d.latency}</th>
                      <th className="px-2 py-1.5 font-medium text-right whitespace-nowrap">{d.cost}</th>
                      <th className="px-2 py-1.5" />
                    </tr>
                  </thead>
                  <tbody>
                    {report.models.map(m => {
                      const isOpen = expanded === m.model
                      const j = m.judge
                      const subs = `${d.sub1} ${j.grounding} · ${d.sub2} ${j.specificity} · ${d.sub3} ${j.completeness} · ${d.sub4} ${j.persuasiveness} · ${d.sub5} ${j.concision}`
                      return (
                        <FragmentRow key={m.model} open={isOpen}>
                          <tr className={`border-t border-line/60 font-mono ${m.model === best?.model ? 'bg-ok/5' : ''} ${m.model === model ? 'outline outline-1 outline-accent/40' : ''}`}>
                            <td className="px-2 py-1.5 whitespace-nowrap">{m.model === best?.model && <Trophy size={11} className="inline mr-1 text-ok" />}{label(m.model)}</td>
                            <td className={`px-2 py-1.5 ${tone(m.factsPass / Math.max(1, m.factsTotal), 1, 0.8)}`}>{m.factsPass}/{m.factsTotal}</td>
                            <td className={`px-2 py-1.5 ${tone(m.negativesPass / Math.max(1, m.negativesTotal), 1, 0.75)}`}>{m.negativesPass}/{m.negativesTotal}</td>
                            <td className={`px-2 py-1.5 ${tone(m.retrievalRecall, 1, 0.75)}`}>{Math.round(m.retrievalRecall * 100)}%</td>
                            <td className="px-2 py-1.5"><span title={subs} className={`cursor-help ${tone(j.presentation, 4.2, 3.5)}`}>{j.presentation.toFixed(2)}</span><span className="ml-1 text-[10px] text-muted">/5</span></td>
                            <td className={`px-2 py-1.5 ${tone(m.groundedRatio, 0.95, 0.85)}`}>{Math.round(m.groundedRatio * 100)}%</td>
                            <td className="px-2 py-1.5 text-right whitespace-nowrap">{m.avgMs} ms</td>
                            <td className="px-2 py-1.5 text-right whitespace-nowrap">${m.totalCostUsd.toFixed(4)}</td>
                            <td className="px-2 py-1.5 text-right">
                              <button onClick={() => setExpanded(isOpen ? null : m.model)} className="text-muted hover:text-text flex items-center gap-1 ml-auto text-[10.5px]">{isOpen ? d.hideCases : d.showCases} {isOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}</button>
                            </td>
                          </tr>
                          {isOpen && (
                            <tr className="border-t border-line/40">
                              <td colSpan={9} className="px-2 py-2 bg-bg/40">
                                <div className="text-[10.5px] font-mono text-muted mb-1.5">{subs}</div>
                                <CaseTable rows={m.cases} d={d} />
                              </td>
                            </tr>
                          )}
                        </FragmentRow>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {report?.verifierCalibration && (
              <p className="text-[11px] font-mono text-muted">
                {d.calibration}: <span className="text-text">{d.precision} {Math.round(report.verifierCalibration.precision * 100)}% · {d.recallWord} {Math.round(report.verifierCalibration.recall * 100)}%</span> · {report.verifierCalibration.model.split('/')[1]} · {fmtDate(report.verifierCalibration.at)}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
              <KeyRound size={13} className="text-muted" />
              <input type="password" value={adminKey} onChange={e => saveKey(e.target.value)} placeholder={d.adminKey} aria-label={d.adminKey}
                className="w-44 rounded-md bg-panel-2 border border-line px-2 py-1 text-xs font-mono focus:outline-none focus:border-accent/70" />
              {adminKey ? (
                <button onClick={rerun} disabled={running} className="flex items-center gap-1.5 rounded-md bg-accent text-bg px-3 py-1.5 text-xs font-medium disabled:opacity-50">
                  {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />} {running ? `${d.running} ${progress.length}/18` : `${d.rerun} · ${label(model)}`}
                </button>
              ) : <span className="text-[11px] text-muted">{d.precomputed}</span>}
              {report && report.models.some(m => m.model === model) && adminKey && <span className="inline-flex items-center gap-1 text-[10.5px] font-mono text-muted"><Zap size={11} /> {label(model)} {d.cached}</span>}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Table rows can't be wrapped in a div; this keeps JSX tidy without changing the DOM. */
function FragmentRow({ children }: { children: React.ReactNode; open: boolean }) { return <>{children}</> }

function CaseTable({ rows, d }: { rows: CaseRow[]; d: (typeof L)[keyof typeof L] }) {
  return (
    <table className="w-full text-[11px]">
      <thead className="text-muted text-left">
        <tr><th className="px-1.5 py-1 font-medium">{d.question}</th><th className="px-1.5 py-1 font-medium">{d.result}</th><th className="px-1.5 py-1 font-medium">{d.missing}</th><th className="px-1.5 py-1 font-medium">{d.presentation}</th><th className="px-1.5 py-1 font-medium">{d.grounded}</th><th className="px-1.5 py-1 font-medium text-right">ms</th></tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={r.id} className="border-t border-line/40 align-top">
            <td className="px-1.5 py-1 max-w-[360px]"><span className="text-[9.5px] font-mono uppercase text-muted mr-1.5">{d.kinds[r.kind]}</span><span title={r.answer}>{r.question}</span></td>
            <td className="px-1.5 py-1"><span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 font-mono text-[10px] border ${r.pass ? 'border-ok/40 text-ok' : 'border-err/40 text-err'}`}>{r.pass ? <Check size={10} /> : <XIcon size={10} />} {r.pass ? d.pass : d.fail}{r.recall != null && ` · ${Math.round(r.recall * 100)}%`}</span></td>
            <td className="px-1.5 py-1 font-mono text-[10px] text-warn/90 max-w-[260px] break-words">{r.missing.join(', ')}{r.forbidden.length > 0 && <span className="text-err"> · {d.forbidden}: {r.forbidden.join(', ')}</span>}</td>
            <td className="px-1.5 py-1 font-mono">{r.judge ? <span title={r.judge.note}>{r.judge.presentation.toFixed(1)}</span> : '—'}</td>
            <td className="px-1.5 py-1 font-mono whitespace-nowrap">{r.grounded ? `${r.grounded.supported}/${r.grounded.total}` : '—'}</td>
            <td className="px-1.5 py-1 font-mono text-right whitespace-nowrap">{r.ms}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
