import type { NodeId, PipelineEvent } from '@cv-agent/shared'

export type Emit = (event: PipelineEvent) => void

/** Small helper so pipeline code reads as a trace: enter a node, do work, exit with timing. */
export async function withNode<T>(emit: Emit, node: NodeId, label: string | undefined, fn: () => Promise<T>): Promise<T> {
  const t0 = performance.now()
  emit({ type: 'node.enter', node, label })
  try {
    return await fn()
  } finally {
    emit({ type: 'node.exit', node, ms: Math.round(performance.now() - t0) })
  }
}

export function sseLine(event: PipelineEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}
