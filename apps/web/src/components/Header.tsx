import { ChevronDown, Github, Linkedin, FileDown, Brain, Presentation, Zap } from 'lucide-react'
import { useStore } from '../lib/store.ts'
import { t } from '../lib/i18n.ts'
import { EvalsButton } from './Evals.tsx'
import { McpButton } from './Mcp.tsx'

export function Header() {
  const { lang, setLang, models, model, setModel, sessionCost, reasoning, setReasoning, presentation, setPresentation, useCache, setUseCache } = useStore()
  const d = t(lang)
  return (
    <>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 sm:px-4 py-2 sm:py-2.5 bg-panel/70 backdrop-blur">
        <div className="flex items-center gap-3 mr-auto min-w-0">
          <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-orange via-blue to-ok grid place-items-center font-bold text-bg">CM</div>
          <div className="min-w-0">
            <div className="font-semibold leading-tight">Cristhian Marroquin</div>
            <div className="text-xs text-muted truncate">{d.tagline}</div>
          </div>
        </div>

        <span className="hidden 2xl:inline-flex items-center gap-1.5 text-[10.5px] font-mono tracking-[0.12em] text-ok"><span className="h-1.5 w-1.5 rounded-full bg-ok shadow-[0_0_6px_#4ade80]" />{d.status}</span>

        <div className="flex items-center gap-2 w-full lg:w-auto order-last lg:order-none">
          <label className="relative flex-1 lg:flex-none">
            <span className="sr-only">{d.model}</span>
            <select value={model} onChange={e => setModel(e.target.value)} aria-label={d.model}
              className="w-full appearance-none bg-panel-2 border border-line rounded-md pl-2 pr-7 py-1.5 text-text text-xs font-mono">
              {models.map(m => <option key={m.id} value={m.id}>{m.label} · ${m.inputPerM.toFixed(2)}/${m.outputPerM.toFixed(2)} per M</option>)}
            </select>
            <ChevronDown size={14} className="absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none text-muted" />
          </label>
          <button onClick={() => setReasoning(!reasoning)} title={d.reasoningHint} aria-pressed={reasoning}
            className={`flex items-center gap-1 text-xs font-mono border rounded-md px-2 py-1.5 transition-colors ${reasoning ? 'border-accent-2 text-accent-2 bg-accent-2/10' : 'border-line text-muted hover:text-text'}`}>
            <Brain size={13} /> {d.reasoning}
          </button>
          <button onClick={() => setUseCache(!useCache)} title={d.cacheHint} aria-pressed={useCache}
            className={`flex items-center gap-1 text-xs font-mono border rounded-md px-2 py-1.5 transition-colors ${useCache ? 'border-warn/70 text-warn bg-warn/10' : 'border-line text-muted hover:text-text'}`}>
            <Zap size={13} /> {d.cacheSwitch}
          </button>
          <button onClick={() => setPresentation(!presentation)} title={d.presentationHint} aria-pressed={presentation}
            className={`flex items-center gap-1 text-xs font-mono border rounded-md px-2 py-1.5 transition-colors ${presentation ? 'border-accent text-accent bg-accent/10' : 'border-line text-muted hover:text-text'}`}>
            <Presentation size={13} /> {d.presentation}
          </button>
          <EvalsButton />
          <McpButton />
          <span className='text-xs font-mono text-muted whitespace-nowrap' title={d.sessionCost}>{d.cost} ${sessionCost.toFixed(4)}</span>
        </div>

        <div role="group" aria-label="language" className="flex text-xs font-mono border border-line rounded-md overflow-hidden">
          {(['es', 'en'] as const).map(l => (
            <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={`px-2 py-1 uppercase ${lang === l ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}>{l}</button>
          ))}
        </div>

        <div className="flex items-center gap-0.5">
          <a href="https://www.linkedin.com/in/cristhian-marroquin/" target="_blank" rel="noreferrer" className="p-2 rounded-md hover:bg-panel-2 text-muted hover:text-text" title="LinkedIn" aria-label="LinkedIn"><Linkedin size={16} /></a>
          <a href="https://github.com/cristhianmarroquinse" target="_blank" rel="noreferrer" className="p-2 rounded-md hover:bg-panel-2 text-muted hover:text-text" title="GitHub" aria-label="GitHub"><Github size={16} /></a>
          <a href="/api/cv" className="p-2 rounded-md hover:bg-panel-2 text-muted hover:text-text" title={d.downloadCv} aria-label={d.downloadCv}><FileDown size={16} /></a>
        </div>
      </header>
      <div className="gradient-bar" />
    </>
  )
}
