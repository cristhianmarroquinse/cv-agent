/**
 * CLI: run the golden set against every catalog model (or the given ones) and persist the bake-off report.
 *   bun run bakeoff                          # all catalog models
 *   bun run bakeoff anthropic/claude-haiku-5.5 deepseek/deepseek-v4-flash
 */
import { buildIndex } from '../rag/store.ts'
import { getCatalog } from '../llm/models.ts'
import { JUDGE_MODEL } from './judge.ts'
import { runEvals, saveModelReport, loadReport, rescore, REPORT_FILE, type ModelReport } from './runner.ts'

// --rescore: re-apply the golden patterns to the stored answers (no model calls); useful after tightening a regex.
if (process.argv[2] === '--rescore') {
  const report = await loadReport()
  if (!report) { console.error('No report to rescore'); process.exit(1) }
  for (const m of report.models) { const r = rescore(m); await saveModelReport(r); console.log(`${m.model.padEnd(36)} facts ${r.factsPass}/${r.factsTotal} · neg ${r.negativesPass}/${r.negativesTotal}`) }
  process.exit(0)
}

await buildIndex()
const catalog = await getCatalog()
const wanted = process.argv.slice(2)
const models = wanted.length ? wanted : catalog.map(m => m.id)
const unknown = models.filter(m => !catalog.some(c => c.id === m))
if (unknown.length) { console.error('Unknown models:', unknown.join(', ')); process.exit(1) }

console.log(`Bake-off · judge ${JUDGE_MODEL} · ${models.length} model(s)\n`)
const rows: ModelReport[] = []
for (const model of models) {
  process.stdout.write(`${model.padEnd(36)} `)
  const r = await runEvals(model, c => process.stdout.write(c.pass ? '✓' : '✗'), new AbortController().signal)
  await saveModelReport(r)
  rows.push(r)
  console.log(`  facts ${r.factsPass}/${r.factsTotal} · neg ${r.negativesPass}/${r.negativesTotal} · recall ${r.retrievalRecall} · judge ${r.judge.presentation} · grounded ${r.groundedRatio} · ${r.avgMs}ms avg · $${r.totalCostUsd}`)
}

console.log('\n' + ['model', 'facts', 'neg', 'recall@5', 'judge', 'ground', 'spec', 'compl', 'pers', 'conc', 'verif', 'avg ms', 'cost $'].map((h, i) => (i === 0 ? h.padEnd(34) : h.padStart(8))).join(''))
for (const r of rows.sort((a, b) => b.judge.presentation - a.judge.presentation)) {
  console.log([r.model.padEnd(34), `${r.factsPass}/${r.factsTotal}`, `${r.negativesPass}/${r.negativesTotal}`, String(r.retrievalRecall), String(r.judge.presentation), String(r.judge.grounding), String(r.judge.specificity), String(r.judge.completeness), String(r.judge.persuasiveness), String(r.judge.concision), String(r.groundedRatio), String(r.avgMs), r.totalCostUsd.toFixed(4)].map((v, i) => (i === 0 ? v : v.padStart(8))).join(''))
}
console.log(`\nReport written to ${REPORT_FILE}`)
process.exit(0)
