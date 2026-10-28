#!/usr/bin/env node
// rescore.js — re-apply the CURRENT trap checks to every saved answer of a run.
// Answers never change; only the scoring does. Use after editing a trap's
// checks, so a regex fix never requires re-spending on the model.
//   node rescore.js [runId]
'use strict';
const fs = require('fs'); const path = require('path');
const { scoreOne, summarize } = require('./run.js');
const RESULTS = path.join(__dirname, 'results');
const runId = process.argv[2] || fs.readdirSync(RESULTS).filter((d) => fs.existsSync(path.join(RESULTS, d, 'summary.json'))).sort().pop();
const runDir = path.join(RESULTS, runId);
const traps = {}; for (const f of fs.readdirSync(path.join(__dirname, 'traps'))) if (f.endsWith('.json')) { const t = JSON.parse(fs.readFileSync(path.join(__dirname, 'traps', f))); traps[t.id] = t; }
const records = []; let changed = 0;
for (const f of fs.readdirSync(path.join(runDir, 'runs'))) {
  if (!f.endsWith('.json')) continue;
  const p = path.join(runDir, 'runs', f); const r = JSON.parse(fs.readFileSync(p));
  if (r.ok && traps[r.trapId]) { const before = r.score && r.score.passed; r.score = scoreOne(r.text, traps[r.trapId]); if (before !== r.score.passed) changed++; fs.writeFileSync(p, JSON.stringify(r, null, 2)); }
  records.push(r);
}
const { meta } = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json')));
meta.rescoredAt = new Date().toISOString();
const summary = summarize(records, { arms: meta.arms }, Object.values(traps).sort((a, b) => a.id.localeCompare(b.id)));
fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ meta, summary }, null, 2));
console.log('rescored ' + records.filter((r) => r.ok).length + ' answers, ' + changed + ' verdicts changed');
for (const r of summary.rows) console.log('  ' + r.arm.padEnd(11) + ' trap pass ' + (r.trapPassRate * 100).toFixed(0) + '%  grounding ' + (r.groundingPassRate * 100).toFixed(0) + '%  stance ' + (r.stancePassRate * 100).toFixed(0) + '%  (' + r.runs + ' scored)');
