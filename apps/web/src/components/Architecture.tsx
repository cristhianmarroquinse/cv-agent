import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { AgentId, NodeId } from '@cv-agent/shared'
import { TOOL_NAMES } from '@cv-agent/shared'
import { ChevronDown, ChevronUp, Gauge, ScrollText, Maximize2, Minimize2, Brain, ArrowDown, Bot, Loader2, Check, MonitorSmartphone, ShieldCheck, Zap, Binary, Database, Sparkles, Wrench, LayoutPanelTop, X as XIcon } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Phases } from './Chat.tsx'
import { infoFor, type Selection } from '../lib/info.ts'
import { useStore, type AgentBox } from '../lib/store.ts'
import { t } from '../lib/i18n.ts'

// Two geometries for the same diagram: a narrow column (sidebar) and a wide horizontal layout (full screen).
// Nodes animate between them with Motion, so maximizing reads as the pipeline spreading out across the screen.
type Layout = 'column' | 'columnDense' | 'wide'
const ORDER: NodeId[] = ['client', 'gateway', 'cache', 'embedder', 'vectorstore', 'llm', 'tools', 'artifacts']
const DOT: Record<NodeId, string> = { client: '#fb923c', gateway: '#60a5fa', cache: '#fbbf24', embedder: '#a78bfa', vectorstore: '#60a5fa', llm: '#4ade80', tools: '#5eead4', artifacts: '#f472b6' }
const AGENT_DOT: Record<AgentId, string> = { planner: '#fbbf24', experience: '#60a5fa', projects: '#f472b6', skills: '#a78bfa', synthesizer: '#4ade80', verifier: '#5eead4', reader: '#fb923c', suggester: '#60a5fa', extractor: '#fbbf24', matcher: '#60a5fa', writer: '#4ade80' }
const NODE_ICON: Record<NodeId, typeof Bot> = { client: MonitorSmartphone, gateway: ShieldCheck, cache: Zap, embedder: Binary, vectorstore: Database, llm: Sparkles, tools: Wrench, artifacts: LayoutPanelTop }
const BORDER: Record<string, string> = { idle: '#263247', active: '#5eead4', done: '#2f6f62', error: '#f87171' }
const BADGE: Record<string, string> = { ok: '#4ade80', warn: '#fbbf24', info: '#a78bfa' }
const SPRING = { type: 'spring', stiffness: 170, damping: 24 } as const

interface Geometry {
  view: { w: number; h: number }
  W: number; H: number; AW: number; AH: number
  pos: Record<NodeId, { x: number; y: number }>
  edges: { from: string; to: string; d: string }[]
  agentPos: (i: number, n: number) => { x: number; y: number }
  agentPath: (i: number, n: number, back: boolean) => string
  agentsLabel: (n: number) => { x: number; y: number }
  ghostAgent: { x: number; y: number }
  minHeight: (n: number) => number
}

function columnGeometry(dense = false): Geometry {
  // dense: one-line boxes (icon + name) for the workspace sidebar; detail lives in the card
  const W = dense ? 112 : 128, H = dense ? 28 : 40, X = 90, Y0 = dense ? 26 : 34, STEP = dense ? 54 : 64, AW = dense ? 96 : 124, AH = dense ? 26 : 34, AX = dense ? 258 : 272, ASTEP = dense ? 34 : 40, BUS_X = 186
  const LANE_CACHE = 10, LANE_STREAM = 18, LANE_TOOLS = 164, LANE_RETRIEVAL = 172
  const pos = Object.fromEntries(ORDER.map((id, i) => [id, { x: X, y: Y0 + i * STEP }])) as Record<NodeId, { x: number; y: number }>
  const L = X - W / 2, R = X + W / 2
  const down = (a: NodeId, b: NodeId) => `M${X} ${pos[a].y + H / 2} L${X} ${pos[b].y - H / 2}`
  const edges = [
    { from: 'client', to: 'gateway', d: down('client', 'gateway') },
    { from: 'gateway', to: 'cache', d: down('gateway', 'cache') },
    { from: 'cache', to: 'embedder', d: down('cache', 'embedder') },
    { from: 'embedder', to: 'vectorstore', d: down('embedder', 'vectorstore') },
    { from: 'vectorstore', to: 'llm', d: down('vectorstore', 'llm') },
    { from: 'llm', to: 'tools', d: down('llm', 'tools') },
    { from: 'tools', to: 'artifacts', d: down('tools', 'artifacts') },
    { from: 'tools', to: 'llm', d: `M${R} ${pos.tools.y - 8} H${LANE_TOOLS} V${pos.llm.y + 8} H${R}` },
    { from: 'tools', to: 'vectorstore', d: `M${R} ${pos.tools.y + 4} H${LANE_RETRIEVAL} V${pos.vectorstore.y} H${R}` },
    { from: 'llm', to: 'vectorstore', d: `M${R} ${pos.llm.y - 8} H${LANE_RETRIEVAL} V${pos.vectorstore.y} H${R}` },
    { from: 'llm', to: 'client', d: `M${L} ${pos.llm.y + 8} H${LANE_STREAM} V${pos.client.y + 8} H${L}` },
    { from: 'cache', to: 'client', d: `M${L} ${pos.cache.y - 8} H${LANE_CACHE} V${pos.client.y - 8} H${L}` },
    { from: 'vectorstore', to: 'cache', d: `M${L} ${pos.vectorstore.y} H${LANE_CACHE} V${pos.cache.y + 8} H${L}` },
  ]
  const agentPos = (i: number) => ({ x: AX, y: pos.llm.y - ASTEP + i * ASTEP })
  const agentPath = (i: number, n: number, back: boolean) => {
    const { y } = agentPos(i)
    return back ? `M${AX - AW / 2} ${y} H${BUS_X} V${pos.llm.y} H${R}` : `M${R} ${pos.llm.y} H${BUS_X} V${y} H${AX - AW / 2}`
  }
  // room under the last box for its badge
  const baseH = Y0 + (ORDER.length - 1) * STEP + H / 2 + (dense ? 26 : 8)
  return {
    view: { w: 340, h: baseH }, W, H, AW, AH, pos, edges, agentPos, agentPath,
    agentsLabel: () => ({ x: AX, y: agentPos(0).y - AH / 2 - 6 }),
    ghostAgent: agentPos(0),
    minHeight: n => Math.max(baseH, n ? agentPos(n - 1).y + AH / 2 + 8 : 0),
  }
}

function wideGeometry(): Geometry {
  const W = 122, H = 44, Y = 96, X0 = 92, STEP = 134, AW = 124, AH = 36, AY = 236, ASTEP = 132, AX0 = 300
  const pos = Object.fromEntries(ORDER.map((id, i) => [id, { x: X0 + i * STEP, y: Y }])) as Record<NodeId, { x: number; y: number }>
  const T = Y - H / 2, B = Y + H / 2
  const right = (a: NodeId, b: NodeId) => `M${pos[a].x + W / 2} ${Y} L${pos[b].x - W / 2} ${Y}`
  const edges = [
    { from: 'client', to: 'gateway', d: right('client', 'gateway') },
    { from: 'gateway', to: 'cache', d: right('gateway', 'cache') },
    { from: 'cache', to: 'embedder', d: right('cache', 'embedder') },
    { from: 'embedder', to: 'vectorstore', d: right('embedder', 'vectorstore') },
    { from: 'vectorstore', to: 'llm', d: right('vectorstore', 'llm') },
    { from: 'llm', to: 'tools', d: right('llm', 'tools') },
    { from: 'tools', to: 'artifacts', d: right('tools', 'artifacts') },
    // upward loops above the row, returns below the row
    { from: 'tools', to: 'llm', d: `M${pos.tools.x - 20} ${T} V${T - 22} H${pos.llm.x + 20} V${T}` },
    { from: 'tools', to: 'vectorstore', d: `M${pos.tools.x + 20} ${T} V${T - 40} H${pos.vectorstore.x} V${T}` },
    { from: 'llm', to: 'vectorstore', d: `M${pos.llm.x - 20} ${T} V${T - 40} H${pos.vectorstore.x} V${T}` },
    { from: 'llm', to: 'client', d: `M${pos.llm.x - 30} ${B} V${B + 34} H${pos.client.x} V${B}` },
    { from: 'cache', to: 'client', d: `M${pos.cache.x} ${B} V${B + 22} H${pos.client.x + 20} V${B}` },
    { from: 'vectorstore', to: 'cache', d: `M${pos.vectorstore.x - 20} ${B} V${B + 22} H${pos.cache.x + 20} V${B}` },
  ]
  // Anchored lane: agents fill left to right from a fixed slot, so boxes never re-center while a run adds agents.
  const agentPos = (i: number) => ({ x: AX0 + i * ASTEP, y: AY })
  const busY = AY - AH / 2 - 28
  const agentPath = (i: number, n: number, back: boolean) => {
    const { x, y } = agentPos(i)
    return back ? `M${x} ${y - AH / 2} V${busY} H${pos.llm.x} V${B}` : `M${pos.llm.x} ${B} V${busY} H${x} V${y - AH / 2}`
  }
  return {
    view: { w: 1120, h: 300 }, W, H, AW, AH, pos, edges, agentPos, agentPath,
    agentsLabel: () => ({ x: AX0 - AW / 2, y: AY - AH / 2 - 8 }),
    ghostAgent: agentPos(0),
    minHeight: n => (n ? 300 : 192),
  }
}

const GEO: Record<Layout, Geometry> = { column: columnGeometry(), columnDense: columnGeometry(true), wide: wideGeometry() }

/** Full-screen views use the wide horizontal layout only when there is room; phones keep the column. */
export function useRoomy() {
  const [roomy, setRoomy] = useState(() => window.matchMedia('(min-width: 900px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const on = () => setRoomy(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return roomy
}

/** True when the viewport is short: the home trades the tools row and the title block for diagram height. */
export function useShortHeight(px = 900) {
  const [short, setShort] = useState(() => window.matchMedia(`(max-height: ${px}px)`).matches)
  useEffect(() => {
    const mq = window.matchMedia(`(max-height: ${px}px)`)
    const on = () => setShort(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [px])
  return short
}

export function Architecture() {
  const { lang, speed, setSpeed, trace, stage, closeStage } = useStore()
  const d = t(lang)
  const [showTrace, setShowTrace] = useState(false)
  const [maximized, setMaximized] = useState(false)
  // Presentation mode opens the same full-screen view automatically while a message runs.
  const auto = stage === 'open' && !maximized
  const open = maximized || auto
  const [selected, setSelected] = useState<Selection | null>(null)
  const roomy = useRoomy()

  // Escape closes the detail modal first, then full screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected) setSelected(null)
      else if (auto) closeStage()
      else if (maximized) setMaximized(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected, maximized, auto, closeStage])

  const btn = (active: boolean) => `text-xs font-mono flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors ${active ? 'border-accent/60 text-accent bg-accent/10' : 'border-line text-muted hover:text-text hover:bg-panel-2'}`
  const controls = (
    <>
      <button onClick={() => setSpeed(speed === 1 ? 2 : 1)} title={d.speedHint} aria-pressed={speed === 2} className={btn(speed === 2)}>
        <Gauge size={16} /> {speed === 1 ? d.normal : d.slow}
      </button>
      <button onClick={() => setShowTrace(v => !v)} aria-expanded={showTrace} className={btn(showTrace)}>
        <ScrollText size={16} /> {d.trace} {showTrace ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>
    </>
  )
  const traceView = showTrace && <TraceView />

  return (
    <>
      <section className="bg-panel flex flex-col min-h-0 h-full xl:border-r border-line">
        <div className="flex flex-wrap items-center gap-2 px-3 pt-2.5 pb-1.5">
          <h2 className="w-full text-[11px] font-mono uppercase tracking-[0.18em] text-muted whitespace-nowrap">{d.architecture}</h2>
          {controls}
          <button onClick={() => setMaximized(true)} title={d.maximize} aria-label={d.maximize} className="ml-auto text-xs font-mono flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-muted hover:text-text hover:bg-panel-2"><Maximize2 size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3 space-y-3">
          {!open && <Diagram layout="columnDense" selected={selected} onSelect={setSelected} />}
          <p className="px-1 text-[11px] text-muted leading-relaxed">{d.clickHint}</p>
          {traceView}
        </div>
      </section>

      <AnimatePresence>
        {open && (
          <motion.div key="fs" role="dialog" aria-modal="true" aria-label={d.architecture}
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}
            className="fixed inset-0 z-40 bg-bg flex flex-col">
            <div className="flex flex-wrap items-center gap-2 px-4 sm:px-6 py-3 border-b border-line">
              <h2 className="text-xs font-mono uppercase tracking-[0.18em] text-muted mr-auto">{d.architecture}{auto && <span className="ml-2 text-accent normal-case tracking-normal">· {d.presentation}</span>}</h2>
              {controls}
              {auto
                ? <button autoFocus onClick={closeStage} className="text-xs font-mono flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-muted hover:text-text hover:bg-panel-2"><Minimize2 size={16} /> {d.collapse}</button>
                : <button autoFocus onClick={() => setMaximized(false)} className="text-xs font-mono flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-muted hover:text-text hover:bg-panel-2"><XIcon size={16} /> {d.close}</button>}
            </div>
            <div className={`flex-1 min-h-0 overflow-auto flex flex-col items-center gap-4 p-4 sm:p-6 ${auto ? 'justify-start' : 'justify-center'}`}>
              <motion.div initial={{ opacity: 0, scale: 0.92, x: -120 }} animate={{ opacity: 1, scale: 1, x: 0 }} transition={SPRING} className={`${roomy ? 'w-full max-w-[1900px]' : 'w-full max-w-[420px]'} ${auto && roomy ? 'flex-1 min-h-0 flex flex-col overflow-hidden' : ''}`}>
                <Diagram layout={roomy ? 'wide' : 'column'} selected={selected} onSelect={setSelected} fit={auto && roomy} />
              </motion.div>
              {auto ? <div className="mt-auto w-full flex justify-center"><StagePanel /></div> : <p className="text-[11px] text-muted">{d.clickHint} · {d.escHint}</p>}
              {showTrace && <div className="w-full max-w-[1280px]">{traceView}</div>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <DetailModal selected={selected} onClose={() => setSelected(null)} onSelect={setSelected} />
    </>
  )
}

export function Diagram({ layout, selected, onSelect, maxHeight, fit, compactTools }: { layout: Layout; selected: Selection | null; onSelect: (s: Selection) => void; maxHeight?: string; /** fill the parent's height: the SVG scales to fit both width and height */ fit?: boolean; /** short screens: one small link that opens the tools card instead of the chips row */ compactTools?: boolean }) {
  const { nodes, agents, packets, activeEdge, doneEdges, tools, lang, speed } = useStore()
  const d = t(lang)
  const g = GEO[layout]
  const dense = layout === 'columnDense'
  const n = agents.length
  const wide = layout === 'wide'
  // Start from the column geometry on first wide render so the nodes visibly spread out.
  const [settled, setSettled] = useState(!wide)
  useEffect(() => { if (wide) { const id = requestAnimationFrame(() => setSettled(true)); return () => cancelAnimationFrame(id) } }, [wide])
  const from = settled ? g : GEO.column

  const agentIndex = (id: string) => agents.findIndex(a => `agent:${a.id}` === id)
  const pathFor = (f: string, to: string) => {
    if (to.startsWith('agent:')) return g.agentPath(agentIndex(to), n, false)
    if (f.startsWith('agent:')) return g.agentPath(agentIndex(f), n, true)
    return g.edges.find(e => e.from === f && e.to === to)?.d ?? `M${g.pos[f as NodeId].x} ${g.pos[f as NodeId].y} L${g.pos[to as NodeId].x} ${g.pos[to as NodeId].y}`
  }
  const edgeClass = (f: string, to: string) => activeEdge?.from === f && activeEdge?.to === to ? 'edge-flow' : doneEdges.includes(`${f}-${to}`) ? 'edge-done' : 'edge-idle'
  const isSel = (k: Selection['kind'], id: string) => selected?.kind === k && selected.id === id
  const viewH = g.minHeight(n)
  const label = useMemo(() => g.agentsLabel(Math.max(n, 1)), [g, n])

  return (
    <div className={`${wide ? 'w-full' : ''} ${fit ? 'flex-1 min-h-0 flex flex-col' : ''}`}>
      <svg viewBox={`0 0 ${g.view.w} ${viewH}`} preserveAspectRatio="xMidYMid meet" className={fit ? 'block flex-1 min-h-0 w-full select-none' : 'w-full h-auto select-none'} style={fit ? { width: '100%', height: '100%', minHeight: 0, flex: '1 1 0px' } : wide ? { maxHeight: maxHeight ?? 'calc(100dvh - 190px)' } : undefined} aria-hidden="false">
        <defs>
          <filter id={`glow-${layout}`}><feGaussianBlur stdDeviation="2.5" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>

        <AnimatePresence>
          {settled && g.edges.map(e => (
            <motion.path key={`${layout}-${e.from}-${e.to}`} d={e.d} fill="none" strokeWidth={1.5} className={edgeClass(e.from, e.to)}
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.25, duration: 0.3 }} />
          ))}
        </AnimatePresence>

        {settled && agents.map((a, i) => <path key={`bus-${a.id}`} d={g.agentPath(i, n, false)} fill="none" strokeWidth={1.3} className={edgeClass('llm', `agent:${a.id}`) === 'edge-idle' ? edgeClass(`agent:${a.id}`, 'llm') : edgeClass('llm', `agent:${a.id}`)} />)}

        {/* Agents lane: real agents when a run uses them, otherwise a ghost slot so the lane reads as part of the design. */}
        {n > 0
          ? <text x={label.x} y={label.y} textAnchor={wide ? 'start' : 'middle'} fontSize={7} fontFamily="JetBrains Mono, monospace" letterSpacing={1.5} fill="#5a6780">{d.agents.toUpperCase()}</text>
          : null}

        {ORDER.map(id => {
          const s = nodes[id]; const p = from.pos[id]
          const sub = (s.label ?? d.nodeHints[id]) + (s.ms != null && s.status === 'done' ? ` · ${s.ms}ms` : '')
          const W = g.W, H = g.H
          return (
            <motion.g key={id} initial={false} animate={{ x: p.x, y: p.y }} transition={SPRING}
              className="cursor-pointer outline-none" role="button" tabIndex={0} aria-label={`${d.nodes[id]}: ${sub}`}
              onClick={() => onSelect({ kind: 'node', id })} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect({ kind: 'node', id }) } }}>
              {isSel('node', id) && <rect x={-W / 2 - 4} y={-H / 2 - 4} width={W + 8} height={H + 8} rx={10} fill="none" stroke="#e5e9f0" strokeWidth={1} strokeDasharray="3 3" />}
              <rect x={-W / 2} y={-H / 2} width={W} height={H} rx={7} fill="#0f1520" stroke={BORDER[s.status]} strokeWidth={s.status === 'active' ? 1.8 : 1.2} filter={s.status === 'active' ? `url(#glow-${layout})` : undefined} />
              {(() => { const Icon = NODE_ICON[id]; return (
                // Outer group places the icon; the inner one pulses around (0,0), which is the icon centre.
                <g transform={`translate(${-W / 2 + 14} ${dense ? 0 : -6})`}><g className={s.status === 'active' ? 'icon-pulse' : undefined}><Icon x={-6} y={-6} width={12} height={12} color={DOT[id]} strokeWidth={2.2} opacity={s.status === 'idle' ? 0.55 : 1} /></g></g>
              ) })()}
              <text x={-W / 2 + 24} y={dense ? 3.5 : -1.5} fontSize={10.5} fontFamily="JetBrains Mono, monospace" fontWeight={500} fill={s.status === 'idle' ? '#aab4c5' : '#f1f5f9'}>{d.nodes[id]}</text>
              {!dense && <text x={-W / 2 + 13} y={13} fontSize={7.5} fontFamily="JetBrains Mono, monospace" fill={s.status === 'active' ? '#5eead4' : '#6b7890'}>{sub.length > 24 ? sub.slice(0, 23) + '…' : sub}</text>}
              {s.badge && (
                <g>
                  <rect x={-42} y={H / 2 + 4} width={84} height={13} rx={6.5} fill="#0a0e16" stroke={BADGE[s.badgeTone ?? 'info']} strokeWidth={1} />
                  <text x={0} y={H / 2 + 13.5} textAnchor="middle" fontSize={7.5} fontFamily="JetBrains Mono, monospace" fill={BADGE[s.badgeTone ?? 'info']}>{s.badge.slice(0, 17)}</text>
                </g>
              )}
            </motion.g>
          )
        })}

        {agents.map((a, i) => <AgentNode key={a.id} a={a} dense={dense} pos={from.agentPos(i, n)} AW={g.AW} AH={g.AH} glow={`url(#glow-${layout})`} name={d.agentNames[a.id]} selected={isSel('agent', a.id)} onClick={() => onSelect({ kind: 'agent', id: a.id })} />)}

        {settled && packets.map(pk => (
          <circle key={`${layout}-${pk.id}`} r={4.5} fill={pk.from === 'cache' && pk.to === 'client' ? '#4ade80' : pk.to.startsWith('agent:') || pk.from.startsWith('agent:') ? '#a78bfa' : '#5eead4'} filter={`url(#glow-${layout})`}>
            <animateMotion dur={`${0.65 * speed}s`} fill="freeze" path={pathFor(pk.from, pk.to)} />
          </circle>
        ))}
      </svg>

      {compactTools ? (
        <button onClick={() => onSelect({ kind: 'node', id: 'tools' })} className="mx-auto mt-1 flex items-center gap-1.5 text-[10.5px] font-mono uppercase tracking-[0.18em] text-muted hover:text-accent">
          <Wrench size={11} /> {TOOL_NAMES.length} tools <ChevronDown size={11} />
        </button>
      ) : (
      <div className={`flex flex-wrap items-center gap-1.5 px-1 pt-2 ${wide ? 'justify-center' : ''}`}>
        <span className={`text-[10px] font-mono uppercase tracking-[0.18em] text-muted ${wide ? 'mr-2' : 'w-full'}`}>{d.toolsAvailable}</span>
        {TOOL_NAMES.map(name => {
          const state = tools.running === name ? 'running' : tools.chosen.includes(name) ? 'chosen' : tools.used.includes(name) ? 'used' : tools.available ? 'available' : 'idle'
          const style = {
            idle: { borderColor: '#1f2a3b', color: '#6b7890', backgroundColor: 'rgba(15,21,32,0.7)', scale: 1 },
            available: { borderColor: '#2f3f5c', color: '#aab4c5', backgroundColor: 'rgba(20,28,42,0.95)', scale: 1 },
            chosen: { borderColor: '#5eead4', color: '#5eead4', backgroundColor: 'rgba(94,234,212,0.12)', scale: 1.06 },
            running: { borderColor: '#5eead4', color: '#0a0e16', backgroundColor: '#5eead4', scale: 1.08 },
            used: { borderColor: '#2f6f62', color: '#4ade80', backgroundColor: 'rgba(74,222,128,0.08)', scale: 1 },
          }[state]
          return <motion.button key={name} onClick={() => onSelect({ kind: 'tool', id: name })} animate={style} transition={{ type: 'spring', stiffness: 300, damping: 22 }} title={d.toolState[state]} className={`text-[11px] font-mono px-2 py-1 rounded border cursor-pointer ${isSel('tool', name) ? 'ring-1 ring-text/70' : ''}`}>{name}</motion.button>
        })}
      </div>
      )}
    </div>
  )
}

function AgentNode({ a, pos, AW, AH, glow, name, selected, onClick, dense }: { a: AgentBox; pos: { x: number; y: number }; AW: number; AH: number; dense?: boolean; glow: string; name: string; selected: boolean; onClick: () => void }) {
  const active = a.status === 'active'
  const sub = active ? (a.label ?? '…') : `${a.ms ?? 0}ms${a.summary ? ' · ' + a.summary : ''}`
  return (
    <motion.g initial={{ opacity: 0, x: pos.x, y: pos.y - 10 }} animate={{ opacity: 1, x: pos.x, y: pos.y }} transition={SPRING}
      className="cursor-pointer outline-none" role="button" tabIndex={0} aria-label={`${name}: ${sub}`}
      onClick={onClick} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}>
      {selected && <rect x={-AW / 2 - 4} y={-AH / 2 - 4} width={AW + 8} height={AH + 8} rx={9} fill="none" stroke="#e5e9f0" strokeWidth={1} strokeDasharray="3 3" />}
      <rect x={-AW / 2} y={-AH / 2} width={AW} height={AH} rx={6} fill="#0f1520" stroke={active ? '#a78bfa' : '#4c3f7a'} strokeWidth={active ? 1.8 : 1.2} filter={active ? glow : undefined} />
      <g transform={`translate(${-AW / 2 + 13} ${dense ? 0 : -5})`}><g className={active ? 'icon-pulse' : undefined}><Bot x={-6} y={-6} width={12} height={12} color={AGENT_DOT[a.id]} strokeWidth={2.2} /></g></g>
      <text x={-AW / 2 + 22} y={dense ? 3 : -1} fontSize={9.5} fontFamily="JetBrains Mono, monospace" fontWeight={500} fill="#f1f5f9">{name}{a.parallel ? ' ∥' : ''}</text>
      {!dense && <text x={-AW / 2 + 11} y={11} fontSize={7} fontFamily="JetBrains Mono, monospace" fill={active ? '#a78bfa' : '#6b7890'}>{sub.length > 27 ? sub.slice(0, 26) + '…' : sub}</text>}
    </motion.g>
  )
}

/** Centered modal with backdrop. Escape and click-outside close it; focus lands on the close button. */
export function DetailModal({ selected, onClose, onSelect }: { selected: Selection | null; onClose: () => void; onSelect?: (s: Selection) => void }) {
  const { lang, nodes, agents, tools, io } = useStore()
  const d = t(lang)
  const closeRef = useRef<HTMLButtonElement>(null)
  const ioKey = selected ? (selected.kind === 'node' ? selected.id : `${selected.kind}:${selected.id}`) : ''
  const rec = io[ioKey]
  useEffect(() => { if (selected) closeRef.current?.focus() }, [selected])
  const info = selected ? infoFor(lang, selected) : null
  let live: string = d.idle
  if (selected?.kind === 'node') { const s = nodes[selected.id]; live = s.status === 'idle' ? d.idle : [s.status, s.label, s.badge, s.ms != null ? s.ms + 'ms' : null].filter(Boolean).join(' · ') }
  if (selected?.kind === 'agent') { const a = agents.find(x => x.id === selected.id); live = a ? [a.status, a.label, a.summary, a.ms != null ? a.ms + 'ms' : null].filter(Boolean).join(' · ') : d.idle }
  if (selected?.kind === 'tool') { const st = tools.running === selected.id ? 'running' : tools.used.includes(selected.id) ? 'used' : tools.chosen.includes(selected.id) ? 'chosen' : tools.available ? 'available' : 'idle'; live = d.toolState[st] }
  const Row = ({ k, v }: { k: string; v: string }) => <div><div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-0.5">{k}</div><p className="text-[13px] text-text/90 leading-relaxed">{v}</p></div>
  const kindLabel = selected ? d.kinds[selected.kind] : ''
  return (
    <AnimatePresence>
      {selected && info && (
        <motion.div key="backdrop" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-bg/70 backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="detail-title" onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-md max-h-[85dvh] overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl shadow-black/50 p-5 space-y-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono uppercase px-1.5 py-0.5 rounded border border-line text-muted">{kindLabel}</span>
              <h3 id="detail-title" className="text-base font-semibold">{info.title}</h3>
              <button ref={closeRef} onClick={onClose} aria-label={d.close} className="ml-auto rounded-md p-1.5 text-muted hover:text-text hover:bg-panel-2"><XIcon size={16} /></button>
            </div>
            <Row k={d.whatIs} v={info.what} />
            <Row k={d.roleOf} v={info.role} />
            <Row k={d.howBuilt} v={info.how} />
            {info.io && <div><div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-0.5">{d.ioContract}</div><p className="text-xs font-mono text-text/85 leading-relaxed">{info.io}</p></div>}
            <div>
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">{d.lastRun}</div>
              {rec && (rec.input.length || rec.output.length) ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {([['input', rec.input], ['output', rec.output]] as const).map(([side, lines]) => (
                    <div key={side} className="rounded-md border border-line bg-bg/60 p-2 min-w-0">
                      <div className="text-[10px] font-mono uppercase tracking-wider text-accent mb-1">{side === 'input' ? d.input : d.output}</div>
                      {lines.length ? <ul className="space-y-0.5">{lines.map((l, i) => <li key={i} className="text-[11px] font-mono text-text/80 break-words">{l}</li>)}</ul> : <p className="text-[11px] font-mono text-muted">—</p>}
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted">{d.noRun}</p>}
            </div>
            {selected.kind === 'node' && selected.id === 'tools' && (
              <div><div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-1">{d.toolsAvailable}</div>
                <div className="flex flex-wrap gap-1.5">{TOOL_NAMES.map(n => <button key={n} onClick={() => onSelect?.({ kind: 'tool', id: n })} className="text-[11px] font-mono px-2 py-1 rounded border border-line text-muted hover:text-accent hover:border-accent/60">{n}</button>)}</div>
              </div>
            )}
            <div><div className="text-[10px] font-mono uppercase tracking-wider text-muted mb-0.5">{d.liveState}</div><p className="text-xs font-mono text-accent">{live}</p></div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Presentation mode companion: the live step list and the streamed answer, so nothing happens behind the curtain. */
export function StagePanel() {
  const { messages, lang } = useStore()
  const d = t(lang)
  const m = [...messages].reverse().find(x => x.role === 'assistant')
  const question = [...messages].reverse().find(x => x.role === 'user')
  const scroller = useRef<HTMLDivElement>(null)
  useEffect(() => { const el = scroller.current; if (el) el.scrollTop = el.scrollHeight }, [m?.content, m?.reasoning])
  if (!m) return null
  const [expanded, setExpanded] = useState(false)
  const current = m.phases.find(p => !p.done) ?? m.phases[m.phases.length - 1]
  const phaseLabel = current ? (d.phases[current.key] as (x: string) => string)(current.detail ?? '') : ''
  const tail = (m.content || m.reasoning || '').replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim().slice(-220)
  if (!expanded) return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.2 }} className="w-full max-w-[1500px] shrink-0 space-y-1.5">
      {question && (
        <div className="flex justify-end">
          <div className="max-w-[70%] truncate rounded-full bg-accent/15 border border-accent/30 px-3 py-1 text-xs">{question.kind === 'jobfit' ? `${d.jobfitLabel} · ${question.fileName ?? `${question.content.length} chars`}` : question.content}</div>
        </div>
      )}
      {/* One-line ticker: the current step on the left, the tail of the streamed answer on the right, always anchored to the newest text. */}
      <div className="flex items-center gap-3 h-11 rounded-xl border border-line bg-panel/85 px-3">
        <span className="flex items-center gap-2 shrink-0 max-w-[42%] font-mono text-[11px] text-accent truncate">
          {current && !current.done ? <Loader2 size={12} className="animate-spin shrink-0" /> : <Check size={12} className="text-ok shrink-0" />}
          <span className="truncate">{phaseLabel}</span>
        </span>
        <span className="h-5 w-px bg-line shrink-0" />
        <div className="relative flex-1 min-w-0 overflow-hidden">
          <div className={`whitespace-nowrap text-sm text-right ${m.status === 'error' ? 'text-err' : 'text-text/90'}`}>{m.status === 'error' ? `${d.error}: ${m.error}` : (tail || '…')}</div>
          <div className="pointer-events-none absolute inset-y-0 left-0 w-16 bg-gradient-to-r from-panel to-transparent" />
        </div>
        <button onClick={() => setExpanded(true)} title={d.maximize} aria-label={d.maximize} className="shrink-0 rounded-md p-1.5 text-muted hover:text-text hover:bg-panel-2"><Maximize2 size={14} /></button>
      </div>
    </motion.div>
  )
  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING, delay: 0.35 }} className='w-full max-w-[1500px] shrink-0 space-y-2.5'>
      <div className="flex justify-end"><button onClick={() => setExpanded(false)} title={d.collapse} aria-label={d.collapse} className="rounded-md p-1.5 text-muted hover:text-text hover:bg-panel-2"><Minimize2 size={14} /></button></div>
      {question && (
        <div className='flex justify-end'>
          <div className='max-w-[80%] rounded-2xl rounded-br-sm bg-accent/15 border border-accent/30 px-3.5 py-2 text-sm'>
            {question.kind === 'jobfit' ? `${d.jobfitLabel} · ${question.fileName ?? `${question.content.length} chars`}` : question.content}
          </div>
        </div>
      )}
    <div className='grid grid-cols-1 md:grid-cols-[minmax(260px,1fr)_2fr] gap-4 min-h-0' style={{ height: 'clamp(180px, 34dvh, 340px)' }}>
      <section className='min-h-0 rounded-xl border border-line bg-panel/80 p-4 overflow-y-auto'>
        <h3 className='text-[10px] font-mono uppercase tracking-[0.18em] text-muted mb-2'>{d.stageSteps}</h3>
        <Phases phases={m.phases} />
      </section>
      <section ref={scroller} className='min-h-0 rounded-xl border border-line bg-panel/80 p-4 overflow-y-auto'>
        <h3 className='text-[10px] font-mono uppercase tracking-[0.18em] text-muted mb-2'>{d.stageAnswer}</h3>
        {m.reasoning && (
          <details open className='mb-2 rounded-md border border-accent-2/30 bg-accent-2/5 px-2.5 py-1.5'>
            <summary className='text-[10.5px] font-mono text-accent-2 cursor-pointer select-none flex items-center gap-1'><Brain size={11} /> {d.thinking}</summary>
            <p className='mt-1 text-xs text-muted whitespace-pre-wrap leading-relaxed'>{m.reasoning}</p>
          </details>
        )}
        {m.status === 'error'
          ? <p className='text-err text-sm'>{d.error}: {m.error}</p>
          : m.content
            ? <div className='prose-chat text-[15px] leading-relaxed'><ReactMarkdown>{m.content}</ReactMarkdown></div>
            : <p className='text-sm text-muted'>…</p>}
      </section>
    </div>
    </motion.div>
  )
}

/** Event log that follows the newest line unless the reader scrolled up; a button jumps back to live. */
function TraceView() {
  const { trace, lang } = useStore()
  const d = t(lang)
  const box = useRef<HTMLDivElement>(null)
  const [live, setLive] = useState(true)
  const onScroll = () => { const el = box.current; if (el) setLive(el.scrollHeight - el.scrollTop - el.clientHeight < 24) }
  useEffect(() => { const el = box.current; if (el && live) el.scrollTop = el.scrollHeight }, [trace, live])
  const jump = () => { const el = box.current; if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }); setLive(true) }
  return (
    <div className='relative'>
      <div ref={box} onScroll={onScroll} className='max-h-56 overflow-y-auto font-mono text-[11px] leading-[18px] rounded-md border border-line bg-bg/60 p-2' aria-live='off'>
        {trace.length === 0 && <div className='text-muted'>{d.traceEmpty}</div>}
        {trace.slice(-80).map(l => (
          <div key={l.id} className={l.tone === 'ok' ? 'text-ok' : l.tone === 'warn' ? 'text-warn' : l.tone === 'err' ? 'text-err' : l.tone === 'info' ? 'text-accent-2' : 'text-muted'}>
            <span className='text-muted/60 mr-1.5'>{new Date(l.ts).toLocaleTimeString([], { hour12: false })}.{String(l.ts % 1000).padStart(3, '0')}</span>{l.text}
          </div>
        ))}
      </div>
      {!live && trace.length > 0 && (
        <button onClick={jump} aria-label='latest' className='absolute right-2 bottom-2 rounded-full border border-accent/50 bg-panel-2 px-2 py-1 text-[10.5px] font-mono text-accent shadow-lg flex items-center gap-1'><ArrowDown size={11} /> live</button>
      )}
    </div>
  )
}
