import type { ChatRequest, PipelineEvent } from '@cv-agent/shared'

/** POST the chat request and yield each SSE event as it arrives. */
export async function* streamChat(req: ChatRequest, signal?: AbortSignal): AsyncGenerator<PipelineEvent> {
  const res = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req), signal })
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `HTTP ${res.status}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, idx); buf = buf.slice(idx + 2)
      for (const line of frame.split('\n')) {
        if (line.startsWith('data:')) { try { yield JSON.parse(line.slice(5)) as PipelineEvent } catch { /* ignore */ } }
      }
    }
  }
}
