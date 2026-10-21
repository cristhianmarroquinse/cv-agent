const STOP = new Set(('a an and are as at be by for from has he his in is it its of on or that the to was were will with ' +
  'el la los las un una unos unas y o de del en es son que con por para su sus al lo como se ha fue este esta esto cual cuales que qué ' +
  'what which who how when where did does do about tell me more his her their you your i cristhian marroquin cristhians').split(' '))

export function tokenize(s: string): string[] {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^\p{L}\p{N}+#.]+/u).map(t => t.replace(/^\.+|\.+$/g, '')).filter(t => t.length > 1 && !STOP.has(t))
}

export class BM25 {
  private df = new Map<string, number>()
  private tf: Map<string, number>[] = []
  private len: number[] = []
  private avgLen = 0
  constructor(docs: string[], private k1 = 1.4, private b = 0.75) {
    for (const d of docs) {
      const toks = tokenize(d)
      const m = new Map<string, number>()
      for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1)
      for (const t of m.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1)
      this.tf.push(m); this.len.push(toks.length)
    }
    this.avgLen = this.len.reduce((a, b) => a + b, 0) / Math.max(1, this.len.length)
  }
  /** Scores for every doc, same order as the constructor input. */
  score(query: string): number[] {
    const q = tokenize(query)
    const N = this.tf.length
    return this.tf.map((m, i) => {
      let s = 0
      for (const t of q) {
        const f = m.get(t); if (!f) continue
        const idf = Math.log(1 + (N - (this.df.get(t) ?? 0) + 0.5) / ((this.df.get(t) ?? 0) + 0.5))
        s += idf * (f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + this.b * this.len[i] / this.avgLen))
      }
      return s
    })
  }
}
