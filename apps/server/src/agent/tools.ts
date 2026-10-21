import type { Artifact } from '@cv-agent/shared'
import type { ORTool } from '../llm/openrouter.ts'
import { experience, identity, projects, skillGroups, stories } from '../knowledge/cv.data.ts'
import { getCatalog } from '../llm/models.ts'
import { search, contextFor } from '../rag/store.ts'

export interface ToolOutcome { result: unknown; artifact?: Artifact; summary: string; retrievalHits?: Awaited<ReturnType<typeof search>>['hits']; /** embed + search time of search_cv */ retrievalMs?: number }

export const toolDefinitions: ORTool[] = [
  { type: 'function', function: { name: 'search_cv', description: 'Semantic + lexical search over the CV knowledge base. Use when the retrieved context does not answer the question.', parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search query in English' } }, required: ['query'] } } },
  { type: 'function', function: { name: 'get_experience', description: 'Return the career timeline (all roles) or one company. Renders a timeline artifact.', parameters: { type: 'object', properties: { company: { type: 'string', description: 'Optional company name filter, e.g. "AiKit", "Walmart", "SmartCoach"' } } } } },
  { type: 'function', function: { name: 'get_skills', description: 'Return skill groups with proficiency levels (1-5). Renders a skills artifact.', parameters: { type: 'object', properties: { group: { type: 'string', description: 'Optional group filter: "LLM engineering", "Backend", "Frontend", "Infra & ops", "Security & quality"' } } } } },
  { type: 'function', function: { name: 'get_project', description: 'Return details of one project and render a project card.', parameters: { type: 'object', properties: { key: { type: 'string', enum: projects.map(p => p.key), description: 'Project key' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'get_story', description: 'Return one interview story in STAR format and render it as a card.', parameters: { type: 'object', properties: { key: { type: 'string', enum: stories.map(s => s.key), description: 'Story key' } }, required: ['key'] } } },
  { type: 'function', function: { name: 'get_contact', description: 'Return contact details and links; renders a contact card with CV download.', parameters: { type: 'object', properties: {} } } },
  { type: 'function', function: { name: 'get_demo_models', description: 'List the LLMs this demo can run with live OpenRouter pricing. Renders a comparison table.', parameters: { type: 'object', properties: {} } } },
]

let artifactSeq = 0
const aid = (kind: string) => `${kind}-${++artifactSeq}-${Date.now().toString(36)}`

export async function executeTool(name: string, args: Record<string, unknown>): Promise<ToolOutcome> {
  switch (name) {
    case 'search_cv': {
      const q = String(args.query ?? '')
      const r = await search(q, 4)
      return { result: contextFor(r.hits), summary: `${r.hits.length} chunks for "${q}"`, retrievalHits: r.hits, retrievalMs: r.embedMs + r.searchMs }
    }
    case 'get_experience': {
      const f = typeof args.company === 'string' ? args.company.toLowerCase() : ''
      const entries = f ? experience.filter(e => e.company.toLowerCase().includes(f)) : experience
      const list = entries.length ? entries : experience
      return { result: list, artifact: { kind: 'timeline', id: aid('timeline'), title: f && entries.length ? `Experience at ${entries[0].company}` : 'Career timeline', entries: list }, summary: `${list.length} roles` }
    }
    case 'get_skills': {
      const f = typeof args.group === 'string' ? args.group.toLowerCase() : ''
      const groups = f ? skillGroups.filter(g => g.name.toLowerCase().includes(f)) : skillGroups
      const list = groups.length ? groups : skillGroups
      return { result: list, artifact: { kind: 'skills', id: aid('skills'), title: list.length === 1 ? list[0].name : 'Skills', groups: list }, summary: `${list.reduce((n, g) => n + g.skills.length, 0)} skills in ${list.length} groups` }
    }
    case 'get_project': {
      const p = projects.find(p => p.key === args.key) ?? projects.find(p => p.name.toLowerCase().includes(String(args.key ?? '').toLowerCase()))
      if (!p) return { result: { error: 'unknown project', available: projects.map(p => p.key) }, summary: 'unknown project' }
      return { result: p, artifact: { kind: 'project', id: aid('project'), title: p.name, project: p }, summary: p.name }
    }
    case 'get_story': {
      const s = stories.find(s => s.key === args.key)
      if (!s) return { result: { error: 'unknown story', available: stories.map(s => ({ key: s.key, title: s.title })) }, summary: 'unknown story' }
      return { result: s, artifact: { kind: 'story', id: aid('story'), title: s.title, story: s }, summary: s.title }
    }
    case 'get_contact': {
      const c = { ...identity, cvUrl: '/api/cv' }
      return { result: c, artifact: { kind: 'contact', id: aid('contact'), title: 'Contact', ...c }, summary: 'contact card' }
    }
    case 'get_demo_models': {
      const models = await getCatalog()
      const rows = models.map(m => [m.label, m.vendor, `$${m.inputPerM.toFixed(3)}`, `$${m.outputPerM.toFixed(3)}`, m.cacheReadPerM != null ? `$${m.cacheReadPerM.toFixed(3)}` : '-', `${Math.round(m.contextLength / 1000)}k`])
      return { result: models, artifact: { kind: 'table', id: aid('table'), title: 'Models available in this demo', columns: ['Model', 'Vendor', 'Input $/M', 'Output $/M', 'Cache read $/M', 'Context'], rows, caption: 'Prices refreshed live from OpenRouter. Per-message cost is shown under each answer.' }, summary: `${models.length} models` }
    }
    default:
      return { result: { error: `unknown tool ${name}` }, summary: 'unknown tool' }
  }
}
