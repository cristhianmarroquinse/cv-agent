import { create } from 'zustand'
import type { AgentId, Artifact, Attachment, ChatMessage, Claim, ModelInfo, NodeId, PipelineEvent, RetrievalHit, Usage } from '@cv-agent/shared'
import { DEFAULT_MODEL } from '@cv-agent/shared'
import { streamChat } from './sse.ts'
import { detectLang, type Lang, type PhaseKey } from './i18n.ts'

export type NodeStatus = 'idle' | 'active' | 'done' | 'error'
export interface NodeState { status: NodeStatus; label?: string; badge?: string; badgeTone?: 'ok' | 'warn' | 'info'; ms?: number }
/** Packet endpoints are node ids or `agent:<id>`. */
export interface Packet { id: number; from: string; to: string }
export interface AgentBox { id: AgentId; label?: string; status: 'active' | 'done'; summary?: string; ms?: number; parallel?: boolean }
export interface TraceLine { id: number; ts: number; text: string; tone?: 'ok' | 'warn' | 'info' | 'err' }
export interface RunSummary { ms: number; steps: number; usage: Usage; fromCache: boolean; tools: string[]; hits: RetrievalHit[]; cacheHits: string[]; model: string; agents: string[] }
export interface Phase { id: number; key: PhaseKey; detail?: string; done: boolean }
export interface Verification { claims: Claim[]; supported: number; total: number }
export interface Msg { id: string; role: 'user' | 'assistant'; kind: 'chat' | 'jobfit'; content: string; fileName?: string; artifactIds: string[]; reasoning: string; phases: Phase[]; status: 'streaming' | 'done' | 'error'; run?: RunSummary; verification?: Verification; error?: string }
export interface ToolState { available: boolean; chosen: string[]; running: string | null; used: string[] }
export type Speed = 1 | 2
/** Presentation mode: the architecture takes the whole screen while a message runs, then collapses back. */
export type Stage = 'idle' | 'open'
/** 'home': landing with the architecture as the hero; 'app': the three-column workspace after the first run. */
export type View = 'home' | 'app'
const PRESENTATION_KEY = 'cv-agent.presentation'
const readPresentation = () => { try { const v = localStorage.getItem(PRESENTATION_KEY); return v == null ? false : v === '1' } catch { return false } }
/** New on every page load: scopes the server response cache to this visit. */
const SESSION_ID = Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
const roomy = () => typeof window !== 'undefined' && window.matchMedia('(min-width: 900px)').matches

const NODES: NodeId[] = ['client', 'gateway', 'cache', 'embedder', 'vectorstore', 'llm', 'tools', 'artifacts']
const idleNodes = (): Record<NodeId, NodeState> => Object.fromEntries(NODES.map(n => [n, { status: 'idle' }])) as Record<NodeId, NodeState>
const idleTools = (): ToolState => ({ available: false, chosen: [], running: null, used: [] })

/** On-screen pacing per event type (ms at normal speed). Backend steps are faster than the eye. */
const PACE: Partial<Record<PipelineEvent['type'], number>> = {
  'edge': 650, 'node.enter': 220, 'cache.hit': 450, 'cache.miss': 150, 'retrieval.hits': 350,
  'llm.request': 300, 'llm.tool_calls': 900, 'tool.start': 400, 'tool.result': 150, 'artifact': 400,
  'agent.start': 450, 'agent.progress': 120, 'agent.end': 350, 'plan': 600, 'verification': 400,
}

interface State {
  lang: Lang
  models: ModelInfo[]
  model: string
  reasoning: boolean
  speed: Speed
  presentation: boolean
  useCache: boolean
  stage: Stage
  view: View
  /** Follow-up questions proposed by the suggester agent after the last answer. */
  followups: string[]
  messages: Msg[]
  artifacts: Artifact[]
  nodes: Record<NodeId, NodeState>
  agents: AgentBox[]
  packets: Packet[]
  activeEdge: { from: string; to: string } | null
  doneEdges: string[]
  tools: ToolState
  trace: TraceLine[]
  sending: boolean
  sessionCost: number
  setLang: (l: Lang) => void
  setModel: (m: string) => void
  setReasoning: (v: boolean) => void
  setSpeed: (s: Speed) => void
  setPresentation: (v: boolean) => void
  setUseCache: (v: boolean) => void
  closeStage: () => void
  goHome: () => void
  loadModels: () => Promise<void>
  send: (text: string, mode?: 'chat' | 'jobfit', attachment?: Attachment) => Promise<void>
  removeArtifact: (id: string) => void
  clearArtifacts: () => void
  applyEvent: (e: PipelineEvent) => void
}

let seq = 0
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export const useStore = create<State>((set, get) => {
  const queue: PipelineEvent[] = []
  let draining = false
  const drain = async () => {
    draining = true
    while (queue.length) {
      const e = queue.shift()!
      get().applyEvent(e)
      const base = PACE[e.type] ?? 0
      if (base) await sleep(base * get().speed)
    }
    draining = false
  }
  const enqueue = (e: PipelineEvent) => { queue.push(e); if (!draining) void drain() }

  // Trace lines use the server timestamp of the event being applied (falls back to now).
  let currentTs = 0
  const log = (text: string, tone?: TraceLine['tone']) => set(s => ({ trace: [...s.trace.slice(-80), { id: ++seq, ts: currentTs || Date.now(), text, tone }] }))
  const node = (id: NodeId, patch: Partial<NodeState>) => set(s => ({ nodes: { ...s.nodes, [id]: { ...s.nodes[id], ...patch } } }))
  const patchLastAssistant = (fn: (m: Msg) => Msg) => set(s => {
    const i = s.messages.map(m => m.role).lastIndexOf('assistant')
    if (i < 0) return {}
    const msgs = s.messages.slice(); msgs[i] = fn(msgs[i]); return { messages: msgs }
  })
  const phase = (key: PhaseKey, detail?: string) => patchLastAssistant(m => ({ ...m, phases: [...m.phases.map(p => ({ ...p, done: true })), { id: ++seq, key, detail, done: false }] }))
  const finishPhases = () => patchLastAssistant(m => ({ ...m, phases: m.phases.map(p => ({ ...p, done: true })) }))
  const packet = (from: string, to: string) => {
    const id = ++seq
    clearTimeout(edgeTimer)
    set(s => ({ packets: [...s.packets, { id, from, to }], activeEdge: { from, to }, doneEdges: s.activeEdge ? [...s.doneEdges, `${s.activeEdge.from}-${s.activeEdge.to}`] : s.doneEdges }))
    const life = 700 * get().speed
    setTimeout(() => set(s => ({ packets: s.packets.filter(p => p.id !== id) })), life)
    edgeTimer = setTimeout(() => set(s => s.activeEdge?.from === from && s.activeEdge?.to === to ? { activeEdge: null, doneEdges: [...s.doneEdges, `${from}-${to}`] } : {}), life * 2)
  }
  // Stage lifecycle: opened on send, closed a beat after run.end so the last packet and the verifier badge are seen.
  let stageToken = 0
  let stageOpenedAt = 0
  const scheduleStageClose = () => {
    const onHome = get().view === 'home'
    if (!onHome && get().stage !== 'open') return
    const token = ++stageToken
    const elapsed = Date.now() - stageOpenedAt
    const delay = Math.max(1200, 2800 - elapsed) * get().speed / 2
    // The home is itself the stage: when the first run ends it hands over to the workspace.
    setTimeout(() => { if (stageToken === token) set(onHome ? { stage: 'idle', view: 'app' } : { stage: 'idle' }) }, delay)
  }
  let acc = { tools: [] as string[], hits: [] as RetrievalHit[], cacheHits: [] as string[], model: '', agents: [] as string[] }
  let edgeTimer: ReturnType<typeof setTimeout> | undefined

  return {
    lang: detectLang(),
    models: [],
    model: DEFAULT_MODEL,
    reasoning: false,
    speed: 1,
    presentation: readPresentation(),
    useCache: true,
    stage: 'idle',
    view: 'home',
    followups: [],
    messages: [],
    artifacts: [],
    nodes: idleNodes(),
    agents: [],
    packets: [],
    activeEdge: null,
    doneEdges: [],
    tools: idleTools(),
    trace: [],
    sending: false,
    sessionCost: 0,

    setLang: lang => set({ lang }),
    setModel: model => set({ model }),
    setReasoning: reasoning => set({ reasoning }),
    setSpeed: speed => set({ speed }),
    setPresentation: presentation => { try { localStorage.setItem(PRESENTATION_KEY, presentation ? '1' : '0') } catch { /* ignore */ } set({ presentation }) },
    setUseCache: useCache => set({ useCache }),
    closeStage: () => { stageToken++; set({ stage: 'idle' }) },
    goHome: () => { stageToken++; set({ stage: 'idle', view: 'home' }) },
    loadModels: async () => {
      const r = await fetch('/api/models').then(r => r.json()) as { default: string; models: ModelInfo[] }
      set({ models: r.models, model: r.models.some(m => m.id === get().model) ? get().model : r.default })
    },
    removeArtifact: id => set(s => ({ artifacts: s.artifacts.filter(a => a.id !== id) })),
    clearArtifacts: () => set({ artifacts: [] }),

    send: async (text, mode = 'chat', attachment) => {
      const content = text.trim() || (attachment ? attachment.name : '')
      if (!content || get().sending) return
      const history: ChatMessage[] = mode === 'jobfit' ? [] : get().messages.filter(m => m.status !== 'error' && m.kind === 'chat').map(m => ({ role: m.role, content: m.content }))
      stageToken++; stageOpenedAt = Date.now()
      if (get().view === 'app' && get().presentation && roomy()) set({ stage: 'open' })
      set(s => ({
        sending: true,
        messages: [...s.messages,
          { id: `u${++seq}`, role: 'user', kind: mode, content, fileName: attachment?.name, artifactIds: [], reasoning: '', phases: [], status: 'done' },
          { id: `a${++seq}`, role: 'assistant', kind: mode, content: '', artifactIds: [], reasoning: '', phases: [], status: 'streaming' }],
        followups: [],
      }))
      try {
        for await (const e of streamChat({ model: get().model, reasoning: get().reasoning, mode, attachment, lang: get().lang, sessionId: SESSION_ID, noCache: !get().useCache, messages: [...history, { role: 'user', content }] })) enqueue(e)
      } catch (err) {
        enqueue({ type: 'error', message: (err as Error).message })
      }
    },

    applyEvent: (e) => {
      currentTs = (e as { ts?: number }).ts ?? 0
      const short = (m: string) => m.split('/')[1] ?? m
      switch (e.type) {
        case 'run.start':
          acc = { tools: [], hits: [], cacheHits: [], model: e.model, agents: [] }
          set({ nodes: idleNodes(), agents: [], packets: [], activeEdge: null, doneEdges: [], tools: idleTools() })
          node('client', { status: 'active', label: short(e.model) })
          log(`run ${e.runId} · ${e.model}`, 'info')
          break
        case 'edge':
          packet(e.from, e.to)
          // Light the destination as soon as the packet leaves, so a box is always lit while a line is.
          if (!e.to.startsWith('agent:')) node(e.to as NodeId, { status: 'active' })
          if (e.from === 'client') { node('client', { status: 'done' }); phase('gateway') }
          break
        case 'node.enter':
          node(e.node, { status: 'active', label: e.label })
          if (e.node === 'cache') phase('cache')
          if (e.node === 'embedder') phase('retrieve')
          break
        case 'node.exit': node(e.node, { status: 'done', ms: e.ms }); break
        case 'cache.check': break
        case 'cache.hit':
          acc.cacheHits.push(e.scope)
          if (e.scope === 'prompt') node('llm', { badge: `${e.detail?.split(' ')[0] ?? ''} cached tok`, badgeTone: 'ok' })
          else node('cache', { badge: e.scope === 'response' && e.detail?.startsWith('semantic') ? `semantic HIT ${e.detail.split(' · ')[1] ?? ''}` : `${e.scope} HIT`, badgeTone: 'ok' })
          if (e.scope === 'response') phase('cacheHit')
          log(`cache HIT (${e.scope}) ${e.detail ?? ''}`, 'ok')
          break
        case 'cache.miss':
          if (e.scope === 'prompt') node('llm', { badge: 'no cached tok', badgeTone: 'warn' })
          else if (e.scope === 'response') node('cache', { badge: e.detail ? 'cache OFF' : 'response MISS', badgeTone: 'warn' })
          log(`cache miss (${e.scope})`, 'warn')
          break
        case 'retrieval.query': log(`retrieve: "${e.query.slice(0, 60)}"`); break
        case 'retrieval.embed': node('embedder', { badge: `${e.dims}d · ${e.ms}ms`, badgeTone: 'info' }); log(`embed ${e.dims}d in ${e.ms}ms (${e.backend})`); break
        case 'retrieval.hits':
          acc.hits = e.hits
          node('vectorstore', { badge: `${e.hits.length} hits`, badgeTone: 'info' })
          phase('hits', String(e.hits.length))
          log(`hits: ${e.hits.map(h => h.section.split(' › ').pop()).join(' · ')}`)
          break
        case 'llm.request':
          node('llm', { status: 'active', label: `${short(e.model)} · step ${e.step}`, badge: undefined })
          set(s => ({ tools: { ...s.tools, available: e.toolCount > 0, chosen: [], running: null } }))
          if (e.toolCount > 0) phase(e.step === 1 ? 'llm' : 'write', short(e.model))
          log(`llm step ${e.step}: ${e.messageCount} msgs, ${e.toolCount} tools, ${e.contextChunks} chunks`)
          break
        case 'llm.token': patchLastAssistant(m => ({ ...m, content: m.content + e.delta })); break
        case 'llm.reasoning': patchLastAssistant(m => ({ ...m, reasoning: m.reasoning + e.delta })); break
        case 'llm.replace': patchLastAssistant(m => ({ ...m, content: e.content })); break
        case 'llm.tool_calls': {
          const names = e.calls.map(c => c.name)
          set(s => ({ tools: { ...s.tools, chosen: names } }))
          phase('choose', names.join(', '))
          log(`tool calls: ${names.join(', ')}`, 'info')
          break
        }
        case 'llm.usage': log(`usage step ${e.step}: ${e.usage.promptTokens}+${e.usage.completionTokens} tok, ${e.usage.cachedTokens} cached, $${(e.usage.costUsd ?? 0).toFixed(5)}`); break
        case 'tool.start':
          acc.tools.push(e.name)
          node('tools', { status: 'active', label: e.name })
          set(s => ({ tools: { ...s.tools, available: true, chosen: s.tools.chosen.includes(e.name) ? s.tools.chosen : [...s.tools.chosen, e.name], running: e.name } }))
          phase('tool', e.name)
          log(`tool ${e.name}(${JSON.stringify(e.args)})`, 'info')
          break
        case 'tool.result':
          set(s => ({ tools: { ...s.tools, running: null, used: [...s.tools.used, e.name] } }))
          node('tools', { status: 'done' })
          log(`tool ${e.name} → ${e.summary} (${e.ms}ms)`)
          break
        case 'artifact':
          set(s => ({ artifacts: [e.artifact, ...s.artifacts.filter(a => a.id !== e.artifact.id)] }))
          patchLastAssistant(m => ({ ...m, artifactIds: m.artifactIds.includes(e.artifact.id) ? m.artifactIds : [...m.artifactIds, e.artifact.id] }))
          node('artifacts', { badge: e.artifact.kind, badgeTone: 'ok' })
          phase('artifact', e.artifact.kind)
          log(`artifact: ${e.artifact.kind} "${e.artifact.title}"`, 'ok')
          break
        case 'agent.start': {
          acc.agents.push(e.agent)
          set(s => ({ agents: s.agents.some(a => a.id === e.agent) ? s.agents.map(a => a.id === e.agent ? { ...a, status: 'active' as const, label: e.label } : a) : [...s.agents, { id: e.agent, label: e.label, status: 'active' as const, parallel: e.parallel }] }))
          node('llm', { status: 'active' })
          packet('llm', `agent:${e.agent}`)
          if (e.agent === 'synthesizer') phase('synth')
          else if (e.agent === 'verifier') phase('verify')
          else if (e.agent === 'reader') phase('read', e.label ?? '')
          else if (e.agent === 'suggester') phase('suggest')
          else if (e.agent === 'extractor') phase('extract')
          else if (e.agent === 'writer') phase('writer')
          else if (e.agent === 'matcher') phase('match', e.label ?? '')
          else if (e.parallel) patchLastAssistant(m => {
            const last = m.phases[m.phases.length - 1]
            if (last && last.key === 'specialists' && !last.done) return { ...m, phases: [...m.phases.slice(0, -1), { ...last, detail: `${last.detail} + ${e.agent}` }] }
            return { ...m, phases: [...m.phases.map(p => ({ ...p, done: true })), { id: ++seq, key: 'specialists', detail: e.agent, done: false }] }
          })
          log(`agent ${e.agent} start ${e.label ?? ''}`, 'info')
          break
        }
        case 'agent.progress':
          set(s => ({ agents: s.agents.map(a => a.id === e.agent ? { ...a, label: e.label } : a) }))
          if (e.agent === 'matcher') patchLastAssistant(m => ({ ...m, phases: m.phases.map(p => p.key === 'match' && !p.done ? { ...p, detail: e.label } : p) }))
          if (e.agent === 'reader') patchLastAssistant(m => ({ ...m, phases: m.phases.map(p => p.key === 'read' && !p.done ? { ...p, detail: e.label } : p) }))
          break
        case 'agent.end':
          set(s => ({ agents: s.agents.map(a => a.id === e.agent ? { ...a, status: 'done' as const, summary: e.summary, ms: e.ms } : a) }))
          packet(`agent:${e.agent}`, 'llm')
          log(`agent ${e.agent} done in ${e.ms}ms ${e.summary ? '· ' + e.summary : ''}`, 'ok')
          break
        case 'plan':
          phase('plan', e.mode === 'compound' ? `compound → ${e.domains.join(' + ')}` : `simple${e.domains[0] ? ' → ' + e.domains[0] : ''}`)
          log(`plan: ${e.mode} [${e.domains.join(', ')}] ${e.reason ?? ''}`, 'info')
          break
        case 'suggestions':
          set({ followups: e.items })
          log(`follow-ups: ${e.items.join(' · ')}`, 'info')
          break
        case 'verification':
          patchLastAssistant(m => ({ ...m, verification: { claims: e.claims, supported: e.supported, total: e.total } }))
          phase('verified', `${e.supported}/${e.total}`)
          log(`verification: ${e.supported}/${e.total} grounded`, e.supported === e.total ? 'ok' : 'warn')
          break
        case 'run.end': {
          const run: RunSummary = { ms: e.ms, steps: e.steps, usage: e.usage, fromCache: e.fromCache, ...acc }
          finishPhases()
          patchLastAssistant(m => ({ ...m, status: 'done', run }))
          node('client', { status: 'done', label: e.fromCache ? 'cached' : `${e.ms}ms` })
          // Nothing is working any more: settle every box that is still lit.
          set(s => ({ nodes: Object.fromEntries(Object.entries(s.nodes).map(([k, v]) => [k, v.status === 'active' ? { ...v, status: 'done' } : v])) as typeof s.nodes }))
          set(s => ({ sending: false, sessionCost: s.sessionCost + (e.usage.costUsd ?? 0), tools: { ...s.tools, available: false, running: null } }))
          scheduleStageClose()
          log(`done in ${e.ms}ms · ${e.steps} steps · $${(e.usage.costUsd ?? 0).toFixed(5)}${e.fromCache ? ' · from cache' : ''}`, 'ok')
          break
        }
        case 'error':
          finishPhases()
          patchLastAssistant(m => ({ ...m, status: 'error', error: e.message }))
          set({ sending: false })
          scheduleStageClose()
          node('llm', { status: 'error' })
          log(`error: ${e.message}`, 'err')
          break
      }
    },
  }
})
