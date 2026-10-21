import { useState } from 'react'
import { motion } from 'motion/react'
import { Github, Linkedin, FileDown } from 'lucide-react'
import { useStore } from '../lib/store.ts'
import { t } from '../lib/i18n.ts'
import type { Selection } from '../lib/info.ts'
import { Diagram, StagePanel, DetailModal, useRoomy } from './Architecture.tsx'
import { Composer } from './Chat.tsx'
import { McpButton } from './Mcp.tsx'

/** Landing: identity in the header, the architecture filling the screen, the composer pinned to the bottom. */
export function Home() {
  const { lang, setLang, sending, messages } = useStore()
  const d = t(lang)
  const roomy = useRoomy()
  const [selected, setSelected] = useState<Selection | null>(null)
  const running = sending || messages.length > 0

  return (
    <div className="h-dvh flex flex-col bg-bg">
      <header className="flex items-center gap-3 sm:gap-4 px-4 sm:px-6 py-2.5">
        <div className="h-9 w-9 shrink-0 rounded-full bg-gradient-to-br from-orange via-blue to-ok grid place-items-center font-bold text-bg">CM</div>
        <div className="min-w-0">
          <h1 className="font-semibold leading-tight">Cristhian Marroquin</h1>
          <p className="text-xs text-muted truncate">{d.tagline}</p>
        </div>
        <span className="hidden sm:inline-flex items-center gap-2 ml-2 pl-4 border-l border-line text-[11px] font-mono uppercase tracking-[0.18em] text-muted">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-ok opacity-75 animate-ping" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-ok" />
          </span>
          {d.architecture}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <span className="mr-1"><McpButton compact /></span>
          <div role="group" aria-label="language" className="flex text-xs font-mono border border-line rounded-md overflow-hidden mr-1">
            {(['es', 'en'] as const).map(l => (
              <button key={l} onClick={() => setLang(l)} aria-pressed={lang === l} className={`px-2 py-1 uppercase ${lang === l ? 'bg-accent/15 text-accent' : 'text-muted hover:text-text'}`}>{l}</button>
            ))}
          </div>
          <a href="https://www.linkedin.com/in/cristhian-marroquin/" target="_blank" rel="noreferrer" className="p-2 rounded-md hover:bg-panel-2 text-muted hover:text-text" title="LinkedIn" aria-label="LinkedIn"><Linkedin size={16} /></a>
          <a href="https://github.com/cristhianmarroquinse" target="_blank" rel="noreferrer" className="p-2 rounded-md hover:bg-panel-2 text-muted hover:text-text" title="GitHub" aria-label="GitHub"><Github size={16} /></a>
          <a href="/api/cv" className="p-2 rounded-md hover:bg-panel-2 text-muted hover:text-text" title={d.downloadCv} aria-label={d.downloadCv}><FileDown size={16} /></a>
        </div>
      </header>
      <div className="gradient-bar" />
      {/* Fixed facts a recruiter wants in the first ten seconds, without asking. */}
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 sm:px-6 py-1.5 text-[11px] font-mono text-muted border-b border-line/60">
        {d.facts.map((x, i) => <span key={x} className="flex items-center gap-2">{i > 0 && <span className="text-line">|</span>}{x}</span>)}
        <span className="text-line">|</span>
        <a href="mailto:cristhianmarroquinse@gmail.com" className="text-accent hover:underline">cristhianmarroquinse@gmail.com</a>
      </div>

      <main className="flex-1 min-h-0 overflow-y-auto flex flex-col px-4 sm:px-8 pt-4 pb-5">
        {/* The diagram takes the free height; the composer (or the live stage) stays at the bottom. */}
        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ type: 'spring', stiffness: 170, damping: 24, delay: 0.1 }}
          className={`mx-auto ${roomy ? 'flex-1 min-h-0 w-full max-w-[1900px] overflow-hidden flex flex-col' : 'my-auto w-full max-w-[420px]'}`}>
          <Diagram layout={roomy ? 'wide' : 'column'} selected={selected} onSelect={setSelected} fit={roomy} />
        </motion.div>

        {running ? (
          <div className="mt-auto pt-4 flex justify-center"><StagePanel /></div>
        ) : (
          <div className="mt-auto pt-8 w-full max-w-3xl mx-auto space-y-2">
            <div className="text-center space-y-1 pb-2">
              <h2 className="text-2xl sm:text-3xl [@media(max-height:760px)]:text-xl font-bold tracking-tight">{d.homeTitle}</h2>
              <p className="text-sm sm:text-base text-muted max-w-2xl mx-auto [@media(max-height:760px)]:hidden">{d.homeLead}</p>
            </div>
            <p className="text-center text-[11px] font-mono uppercase tracking-[0.18em] text-muted">{d.homeCta}</p>
            <Composer home />
          </div>
        )}
      </main>

      <DetailModal selected={selected} onClose={() => setSelected(null)} />
    </div>
  )
}
