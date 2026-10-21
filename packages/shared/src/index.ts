// Shared contracts between server and web.
// Every step of the pipeline emits a PipelineEvent over SSE; the web renders them
// as chat tokens, artifacts and node activations on the architecture diagram.

export type NodeId =
  | 'client'
  | 'gateway'
  | 'cache'
  | 'embedder'
  | 'vectorstore'
  | 'llm'
  | 'tools'
  | 'artifacts'

export type AgentId = 'planner' | 'experience' | 'projects' | 'skills' | 'synthesizer' | 'verifier' | 'reader' | 'extractor' | 'matcher' | 'writer' | 'suggester'

/** A file attached to a job-fit request (base64). Read server-side by the 'reader' agent. */
export interface Attachment { name: string; mime: string; data: string }

export interface Claim { text: string; supported: boolean; note?: string }
export interface JobFitRow { requirement: string; kind: 'must' | 'nice'; level: 'strong' | 'partial' | 'gap'; evidence: string }

export type CacheScope = 'response' | 'retrieval' | 'prompt'

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface ModelInfo {
  id: string
  label: string
  vendor: string
  /** USD per 1M tokens */
  inputPerM: number
  outputPerM: number
  cacheReadPerM: number | null
  contextLength: number
  supportsPromptCache: boolean
  note?: string
}

export interface RetrievalHit {
  id: string
  section: string
  score: number
  method: 'hybrid' | 'vector' | 'bm25'
  preview: string
}

// ---------- Artifacts (generative UI payloads) ----------

export interface TimelineEntry {
  company: string
  role: string
  start: string
  end: string
  location?: string
  highlights: string[]
  stack?: string[]
}

export interface SkillGroup {
  name: string
  skills: { name: string; level: 1 | 2 | 3 | 4 | 5 }[]
}

export interface ProjectInfo {
  key: string
  name: string
  period: string
  context: string
  description: string
  highlights: string[]
  stack: string[]
  link?: string
  honesty?: string
}

export interface StoryInfo {
  key: string
  title: string
  situation: string
  task: string
  action: string
  result: string
  tags: string[]
}

export type Artifact =
  | { kind: 'timeline'; id: string; title: string; entries: TimelineEntry[] }
  | { kind: 'skills'; id: string; title: string; groups: SkillGroup[] }
  | { kind: 'project'; id: string; title: string; project: ProjectInfo }
  | { kind: 'story'; id: string; title: string; story: StoryInfo }
  | { kind: 'contact'; id: string; title: string; name: string; headline: string; location: string; email: string; linkedin: string; github: string; site: string; cvUrl: string }
  | { kind: 'table'; id: string; title: string; columns: string[]; rows: (string | number)[][]; caption?: string }
  | { kind: 'jobfit'; id: string; title: string; role: string; rows: JobFitRow[]; summary: { strong: number; partial: number; gap: number } }

// ---------- Pipeline events ----------

export interface Usage {
  promptTokens: number
  completionTokens: number
  cachedTokens: number
  costUsd: number | null
}

export type PipelineEvent =
  | { type: 'run.start'; runId: string; model: string; ts: number }
  | { type: 'node.enter'; node: NodeId; label?: string }
  | { type: 'node.exit'; node: NodeId; ms?: number; label?: string }
  | { type: 'edge'; from: NodeId; to: NodeId; label?: string }
  | { type: 'cache.check'; scope: CacheScope; key: string }
  | { type: 'cache.hit'; scope: CacheScope; key: string; detail?: string }
  | { type: 'cache.miss'; scope: CacheScope; key: string; detail?: string }
  | { type: 'retrieval.query'; query: string }
  | { type: 'retrieval.embed'; dims: number; ms: number; backend: 'transformers' | 'bm25-only' }
  | { type: 'retrieval.hits'; hits: RetrievalHit[]; ms: number; /** set when the search was made for an agent (specialist or matcher) */ agent?: AgentId; label?: string }
  | { type: 'llm.request'; model: string; step: number; messageCount: number; toolCount: number; contextChunks: number }
  | { type: 'llm.token'; delta: string }
  | { type: 'llm.reasoning'; delta: string }
  /** Replace the assistant text streamed so far (e.g. drop the pre-tool-call text, or strip an unbacked sentence). */
  | { type: 'llm.replace'; content: string }
  | { type: 'llm.tool_calls'; calls: { id: string; name: string; args: Record<string, unknown> }[] }
  | { type: 'llm.usage'; step: number; usage: Usage; /** set for calls made by agents (planner, specialists, verifier, …) */ agent?: AgentId; label?: string }
  | { type: 'tool.start'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool.result'; id: string; name: string; summary: string; ms: number; /** first characters of the raw result, for the trace inspector */ preview?: string }
  | { type: 'artifact'; artifact: Artifact }
  | { type: 'agent.start'; agent: AgentId; label?: string; parallel?: boolean }
  | { type: 'agent.progress'; agent: AgentId; label: string }
  | { type: 'agent.end'; agent: AgentId; ms: number; summary?: string }
  | { type: 'plan'; mode: 'simple' | 'compound'; domains: string[]; reason?: string }
  | { type: 'verification'; claims: Claim[]; supported: number; total: number }
  | { type: 'suggestions'; items: string[] }
  | { type: 'run.end'; ms: number; steps: number; usage: Usage; fromCache: boolean }
  | { type: 'error'; message: string }

export interface ChatRequest {
  messages: ChatMessage[]
  model: string
  /** Changes on every page load: the response cache is scoped to it, so a reload always shows the full flow. */
  sessionId?: string
  /** Skip the response cache entirely (no read, no write) to force the full pipeline. */
  noCache?: boolean
  /** Ask the provider for reasoning tokens and stream them (costs tokens + latency). */
  reasoning?: boolean
  /** 'chat' (default) or 'jobfit': the last user message is a job description to match against the CV. */
  mode?: 'chat' | 'jobfit'
  attachment?: Attachment
  /** UI language; the job-fit verdict and follow-ups are written in it. */
  lang?: 'es' | 'en'
}

export const TOOL_NAMES = ['search_cv', 'get_experience', 'get_skills', 'get_project', 'get_story', 'get_contact', 'get_demo_models'] as const

export const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5'
