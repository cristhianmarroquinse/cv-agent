import path from 'node:path'
import { DEFAULT_MODEL } from '@cv-agent/shared'
import { config } from '../config.ts'
import { getCatalog } from '../llm/models.ts'
import { verify } from '../agent/verifier.ts'
import { CALIBRATION } from './verifier-calibration.ts'

/** Measures the verifier's precision and recall on planted hallucinations and persists the result. */
const model = process.argv[2] ?? DEFAULT_MODEL
await getCatalog()
const emit = () => {}
let tp = 0, fp = 0, fn = 0
const cases: { id: string; flagged: string[]; expected: string[]; tp: number; fp: number; fn: number }[] = []
for (const c of CALIBRATION) {
  const r = await verify(model, c.answer, c.evidence, emit, new AbortController().signal)
  const flagged = (r?.claims ?? []).filter(x => !x.supported).map(x => x.text)
  const matched = new Set<string>()
  let cfp = 0
  for (const f of flagged) {
    const hits = c.expectUnsupported.filter(e => f.toLowerCase().includes(e.toLowerCase()))
    if (hits.length) hits.forEach(h => matched.add(h)); else cfp++
  }
  const ctp = matched.size, cfn = c.expectUnsupported.length - ctp
  tp += ctp; fp += cfp; fn += cfn
  cases.push({ id: c.id, flagged, expected: c.expectUnsupported, tp: ctp, fp: cfp, fn: cfn })
  console.log(`${c.id.padEnd(22)} tp=${ctp} fp=${cfp} fn=${cfn}  flagged: ${flagged.join(' | ').slice(0, 110)}`)
}
const precision = tp + fp ? tp / (tp + fp) : 1
const recall = tp + fn ? tp / (tp + fn) : 1
const report = { at: Date.now(), model, cases: cases.length, planted: CALIBRATION.reduce((n, c) => n + c.expectUnsupported.length, 0), tp, fp, fn, precision, recall, details: cases }
await Bun.write(path.join(config.rootDir, 'apps/server/data/verifier-calibration.json'), JSON.stringify(report, null, 2))
console.log(`\nprecision ${(precision * 100).toFixed(0)}% · recall ${(recall * 100).toFixed(0)}% · written to apps/server/data/verifier-calibration.json`)
