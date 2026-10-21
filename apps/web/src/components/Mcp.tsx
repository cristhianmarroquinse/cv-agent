import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { Plug, X as XIcon, Copy, Check } from 'lucide-react'
import { useStore } from '../lib/store.ts'

interface McpInfo { name: string; url: string; tools: string[]; resources: string[]; claudeDesktop: unknown; cursor: unknown }

const T = {
  es: {
    button: 'MCP',
    title: 'Conecta tu propio cliente por MCP',
    intro: 'Este CV también es un servidor Model Context Protocol. Cualquier cliente MCP (Claude Desktop, Cursor, un agente propio) puede usar las mismas tools que el chat de esta web y leer la base de conocimiento, sin pasar por esta interfaz.',
    endpoint: 'Endpoint (Streamable HTTP)',
    exposes: 'Qué expone',
    tools: 'tools tipadas',
    resource: 'recurso con el CV completo en markdown',
    connect: 'Cómo conectarlo',
    claude: 'Claude Desktop · claude_desktop_config.json',
    cursor: 'Cursor · .cursor/mcp.json',
    generic: 'Cualquier cliente del SDK',
    tryTitle: 'Qué puedes pedirle una vez conectado',
    examples: [
      'Usando las tools de cristhian-cv, resume su trayectoria y lista los proyectos de IA.',
      'Llama a get_story con la clave model-lied y explícame qué guardrails construyó.',
      'Lee el recurso cv://knowledge y dime si encaja en un puesto de LLM Platform Engineer.',
      'Compara los modelos que usa esta demo (get_demo_models) por coste y contexto.',
    ],
    notes: 'Sin autenticación: solo datos públicos del CV, con límite de peticiones por IP. Las llamadas por MCP se registran en el servidor pero no se animan en el diagrama.',
    copy: 'Copiar',
    copied: 'Copiado',
    close: 'Cerrar',
    loading: 'Cargando…',
  },
  en: {
    button: 'MCP',
    title: 'Connect your own client over MCP',
    intro: 'This CV is also a Model Context Protocol server. Any MCP client (Claude Desktop, Cursor, your own agent) can use the same tools as this chat and read the knowledge base, without going through this UI.',
    endpoint: 'Endpoint (Streamable HTTP)',
    exposes: 'What it exposes',
    tools: 'typed tools',
    resource: 'resource with the full CV in markdown',
    connect: 'How to connect',
    claude: 'Claude Desktop · claude_desktop_config.json',
    cursor: 'Cursor · .cursor/mcp.json',
    generic: 'Any SDK client',
    tryTitle: 'What to ask once connected',
    examples: [
      'Using the cristhian-cv tools, summarise his career and list the AI projects.',
      'Call get_story with key model-lied and explain which guardrails he built.',
      'Read the cv://knowledge resource and tell me if he fits an LLM Platform Engineer role.',
      'Compare the models this demo uses (get_demo_models) by cost and context.',
    ],
    notes: 'No authentication: public CV data only; POST requests are rate-limited per IP. Tool calls are logged on the server (name and arguments) but do not animate the diagram.',
    copy: 'Copy',
    copied: 'Copied',
    close: 'Close',
    loading: 'Loading…',
  },
} as const

export function McpButton({ compact }: { compact?: boolean }) {
  const lang = useStore(s => s.lang)
  const [open, setOpen] = useState(false)
  return (
    <>
      <button onClick={() => setOpen(true)} title={T[lang].title}
        className={`flex items-center gap-1 text-xs font-mono border rounded-md transition-colors border-line text-muted hover:text-text hover:bg-panel-2 ${compact ? 'px-2 py-1' : 'px-2 py-1.5'}`}>
        <Plug size={13} /> {T[lang].button}
      </button>
      <McpModal open={open} onClose={() => setOpen(false)} />
    </>
  )
}

function McpModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const lang = useStore(s => s.lang)
  const t = T[lang]
  const [info, setInfo] = useState<McpInfo | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    closeRef.current?.focus()
    fetch('/api/mcp').then(r => r.json()).then(setInfo).catch(() => setInfo(null))
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, onClose])

  const url = info?.url ?? `${window.location.origin}/mcp`
  const claude = JSON.stringify(info?.claudeDesktop ?? { mcpServers: { 'cristhian-cv': { command: 'npx', args: ['-y', 'mcp-remote', url] } } }, null, 2)
  const cursor = JSON.stringify(info?.cursor ?? { mcpServers: { 'cristhian-cv': { url } } }, null, 2)
  const generic = `import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

const client = new Client({ name: 'my-agent', version: '1.0.0' })
await client.connect(new StreamableHTTPClientTransport(new URL('${url}')))
const { tools } = await client.listTools()
const story = await client.callTool({ name: 'get_story', arguments: { key: 'model-lied' } })`

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div key="mcp-backdrop" className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-bg/70 backdrop-blur-[2px]"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-labelledby="mcp-title" onClick={e => e.stopPropagation()}
            initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="w-full max-w-3xl max-h-[88dvh] overflow-y-auto rounded-xl border border-line bg-panel shadow-2xl shadow-black/50 p-5 sm:p-6 space-y-5">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 h-8 w-8 shrink-0 rounded-lg bg-accent/15 text-accent grid place-items-center"><Plug size={16} /></span>
              <div className="min-w-0">
                <h3 id="mcp-title" className="text-lg font-semibold">{t.title}</h3>
                <p className="text-sm text-muted leading-relaxed mt-1">{t.intro}</p>
              </div>
              <button ref={closeRef} onClick={onClose} aria-label={t.close} className="ml-auto rounded-md p-1.5 text-muted hover:text-text hover:bg-panel-2"><XIcon size={16} /></button>
            </div>

            <section className="space-y-1.5">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">{t.endpoint}</h4>
              <CopyRow text={url} mono labels={t} />
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">{t.exposes}</h4>
              {info ? (
                <div className="text-sm space-y-1.5">
                  <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted mr-1">{info.tools.length} {t.tools}:</span>{info.tools.map(x => <code key={x} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-line bg-panel-2 text-text/90">{x}</code>)}</div>
                  <div className="flex flex-wrap items-center gap-1.5"><span className="text-muted mr-1">1 {t.resource}:</span>{info.resources.map(x => <code key={x} className="text-[11px] font-mono px-1.5 py-0.5 rounded border border-line bg-panel-2 text-text/90">{x}</code>)}</div>
                </div>
              ) : <p className="text-sm text-muted">{t.loading}</p>}
            </section>

            <section className="space-y-3">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">{t.connect}</h4>
              <CodeBlock title={t.claude} code={claude} labels={t} />
              <CodeBlock title={t.cursor} code={cursor} labels={t} />
              <CodeBlock title={t.generic} code={generic} labels={t} />
            </section>

            <section className="space-y-1.5">
              <h4 className="text-[10px] font-mono uppercase tracking-[0.18em] text-muted">{t.tryTitle}</h4>
              <ul className="space-y-1">
                {t.examples.map(x => <li key={x} className="text-sm text-text/90 flex gap-2"><span className="text-accent">›</span><span>{x}</span></li>)}
              </ul>
            </section>

            <p className="text-[11px] text-muted leading-relaxed border-t border-line pt-3">{t.notes}</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function useCopy() {
  const [done, setDone] = useState(false)
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* ignore */ } }
  return { done, copy }
}

function CopyRow({ text, mono, labels }: { text: string; mono?: boolean; labels: { copy: string; copied: string } }) {
  const { done, copy } = useCopy()
  return (
    <div className="flex items-center gap-2 rounded-md border border-line bg-bg/60 px-3 py-2">
      <code className={`flex-1 truncate text-sm ${mono ? 'font-mono' : ''}`}>{text}</code>
      <button onClick={() => void copy(text)} className="shrink-0 flex items-center gap-1 text-[11px] font-mono text-muted hover:text-text">{done ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {done ? labels.copied : labels.copy}</button>
    </div>
  )
}

function CodeBlock({ title, code, labels }: { title: string; code: string; labels: { copy: string; copied: string } }) {
  const { done, copy } = useCopy()
  return (
    <div className="rounded-md border border-line bg-bg/60 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-line/70 text-[11px] font-mono text-muted">
        <span className="truncate">{title}</span>
        <button onClick={() => void copy(code)} className="ml-auto shrink-0 flex items-center gap-1 hover:text-text">{done ? <Check size={12} className="text-ok" /> : <Copy size={12} />} {done ? labels.copied : labels.copy}</button>
      </div>
      <pre className="px-3 py-2 text-[11.5px] leading-[17px] font-mono text-text/85 overflow-x-auto"><code>{code}</code></pre>
    </div>
  )
}
