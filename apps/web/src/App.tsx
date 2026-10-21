import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Header } from './components/Header.tsx'
import { Architecture } from './components/Architecture.tsx'
import { Chat } from './components/Chat.tsx'
import { Home } from './components/Home.tsx'
import { useStore } from './lib/store.ts'
import { t } from './lib/i18n.ts'

type Tab = 'arch' | 'chat'

export default function App() {
  const loadModels = useStore(s => s.loadModels)
  const view = useStore(s => s.view)
  useEffect(() => { void loadModels().catch(console.error) }, [loadModels])
  return (
    <AnimatePresence mode="wait">
      {view === 'home'
        ? <motion.div key="home" exit={{ opacity: 0, scale: 0.98 }} transition={{ duration: 0.25 }}><Home /></motion.div>
        : <motion.div key="app" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }}><Workspace /></motion.div>}
    </AnimatePresence>
  )
}

function Workspace() {
  const lang = useStore(s => s.lang)
  const d = t(lang)
  const [tab, setTab] = useState<Tab>('chat')
  const show = (k: Tab) => (tab === k ? 'flex' : 'hidden xl:flex')
  return (
    <div className="h-dvh flex flex-col">
      <Header />
      <div className="xl:hidden flex border-b border-line text-sm" role="tablist">
        {([['arch', d.architecture], ['chat', 'Chat']] as [Tab, string][]).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`flex-1 py-2 ${tab === k ? 'text-accent border-b-2 border-accent' : 'text-muted'}`}>{label}</button>
        ))}
      </div>
      <main className="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[380px_minmax(0,1fr)] 2xl:grid-cols-[420px_minmax(0,1fr)]">
        <div className={`min-h-0 flex-col ${show('arch')}`}><Architecture /></div>
        <div className={`min-h-0 flex-col ${show('chat')}`}><Chat /></div>
      </main>
    </div>
  )
}
