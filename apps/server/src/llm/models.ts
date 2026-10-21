import type { ModelInfo } from '@cv-agent/shared'
import { config } from '../config.ts'

/** Curated catalog: cheap, tool-capable models. Prices are refreshed live from OpenRouter; these are fallbacks. */
const CURATED: ModelInfo[] = [
  { id: 'anthropic/claude-haiku-5.5', label: 'Claude Haiku 5.5', vendor: 'Anthropic', inputPerM: 0.10, outputPerM: 0.50, cacheReadPerM: 0.01, contextLength: 1_000_000, supportsPromptCache: true, note: 'Default. Explicit cache_control on the system prompt.' },
  { id: 'deepseek/deepseek-v4-flash', label: 'DeepSeek V4 Flash', vendor: 'DeepSeek', inputPerM: 0.091, outputPerM: 0.182, cacheReadPerM: 0.018, contextLength: 1_048_576, supportsPromptCache: true, note: 'The model SmartCoach runs in production.' },
  { id: 'deepseek/deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', vendor: 'DeepSeek', inputPerM: 0.028, outputPerM: 0.12, cacheReadPerM: 0.001, contextLength: 1_048_576, supportsPromptCache: true },
  { id: 'google/gemini-2.5-flash-lite', label: 'Gemini 2.5 Flash Lite', vendor: 'Google', inputPerM: 0.10, outputPerM: 0.40, cacheReadPerM: 0.01, contextLength: 1_048_576, supportsPromptCache: true },
  { id: 'openai/gpt-5-nano', label: 'GPT-5 nano', vendor: 'OpenAI', inputPerM: 0.05, outputPerM: 0.40, cacheReadPerM: 0.005, contextLength: 400_000, supportsPromptCache: true },
  { id: 'qwen/qwen3.7-flash', label: 'Qwen 3.7 Flash', vendor: 'Alibaba', inputPerM: 0.03, outputPerM: 0.13, cacheReadPerM: 0.006, contextLength: 1_000_000, supportsPromptCache: true },
]

let catalog: ModelInfo[] = CURATED
let fetchedAt = 0

export async function getCatalog(): Promise<ModelInfo[]> {
  if (Date.now() - fetchedAt < 60 * 60 * 1000) return catalog
  try {
    const res = await fetch(`${config.openRouterBase}/models`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = (await res.json()) as { data: any[] }
    const byId = new Map(data.data.map(m => [m.id, m]))
    catalog = CURATED.map(m => {
      const live = byId.get(m.id)
      if (!live) return m
      return {
        ...m,
        inputPerM: Number(live.pricing?.prompt ?? 0) * 1e6,
        outputPerM: Number(live.pricing?.completion ?? 0) * 1e6,
        cacheReadPerM: live.pricing?.input_cache_read ? Number(live.pricing.input_cache_read) * 1e6 : m.cacheReadPerM,
        contextLength: live.context_length ?? m.contextLength,
      }
    })
    fetchedAt = Date.now()
    console.log('[models] catalog prices refreshed from OpenRouter')
  } catch (err) {
    console.warn('[models] live pricing unavailable, using fallback prices:', (err as Error).message)
    fetchedAt = Date.now() - 55 * 60 * 1000 // retry in 5 minutes
  }
  return catalog
}

export function findModel(id: string): ModelInfo | undefined { return catalog.find(m => m.id === id) }

export function estimateCost(m: ModelInfo, promptTokens: number, completionTokens: number, cachedTokens: number): number {
  const uncached = Math.max(0, promptTokens - cachedTokens)
  return (uncached * m.inputPerM + cachedTokens * (m.cacheReadPerM ?? m.inputPerM) + completionTokens * m.outputPerM) / 1e6
}
