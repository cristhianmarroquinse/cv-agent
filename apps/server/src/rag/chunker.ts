export interface Chunk { id: string; section: string; text: string }

/** Split the markdown knowledge base into one chunk per `##`/`###` section, carrying the heading path. */
export function chunkMarkdown(md: string): Chunk[] {
  const lines = md.split('\n')
  const chunks: Chunk[] = []
  let h2 = ''
  let h3 = ''
  let buf: string[] = []
  const flush = () => {
    const text = buf.join('\n').trim()
    if (text) {
      const section = h3 ? `${h2} › ${h3}` : h2
      chunks.push({ id: `c${chunks.length + 1}`, section, text: `${section}\n${text}` })
    }
    buf = []
  }
  for (const line of lines) {
    if (line.startsWith('# ')) continue
    if (line.startsWith('## ')) { flush(); h2 = line.slice(3).trim(); h3 = ''; continue }
    if (line.startsWith('### ')) { flush(); h3 = line.slice(4).trim(); continue }
    buf.push(line)
  }
  flush()
  return chunks
}
