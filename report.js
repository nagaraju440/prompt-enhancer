#!/usr/bin/env node
/*
 * report.js — turn results/<runId>/{summary.json, judge.json} into RESULTS.md
 * at the repo root: headline tables, ablation, cost, per-group numbers, and
 * side-by-side excerpts of the traps where the arms differed most.
 *
 *   node report.js [runId]      defaults to the latest run
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { stripRefinedLine } = require('./run.js');

const ROOT = __dirname;
const RESULTS = path.join(ROOT, 'results');
const ARMS = { 'arm0-none': 'no hook', 'arm1-rules': 'rules only', 'arm2-full': 'full enhancer' };

function latestRun() {
  const dirs = fs.readdirSync(RESULTS).filter((d) => fs.existsSync(path.join(RESULTS, d, 'summary.json'))).sort();
  return dirs[dirs.length - 1];
}
function pct(x, d) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(d === undefined ? 0 : d) + '%'; }
function num(x, d) { return x === null || x === undefined ? 'n/a' : Number(x).toFixed(d === undefined ? 0 : d); }
function pp(a, b) { return a === null || b === null ? 'n/a' : ((b - a) * 100).toFixed(0).replace(/^(-?)/, (m, s) => (s === '-' ? '−' : '+')) + ' pp'; }
function excerpt(text, n) {
  const t = stripRefinedLine(text).trim().replace(/\r/g, '');
  return t.length > n ? t.slice(0, n).trimEnd() + ' …' : t;
}
function loadRuns(runDir) {
  const out = [];
  for (const f of fs.readdirSync(path.join(runDir, 'runs'))) if (f.endsWith('.json')) out.push(JSON.parse(fs.readFileSync(path.join(runDir, 'runs', f), 'utf8')));
  return out;
}

function main() {
  const runId = process.argv[2] || latestRun();
  const runDir = path.join(RESULTS, runId);
  const { meta, summary } = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8'));
  const judge = fs.existsSync(path.join(runDir, 'judge.json')) ? JSON.parse(fs.readFileSync(path.join(runDir, 'judge.json'), 'utf8')) : null;
  const runs = loadRuns(runDir);
  const row = (arm) => summary.rows.find((r) => r.arm === arm) || {};
  const a0 = row('arm0-none'), a1 = row('arm1-rules'), a2 = row('arm2-full');

  const L = [];
  L.push('# Results — prompt-enhancer benchmark');
  L.push('');
  L.push('Run `' + runId + '` · answering model `' + meta.model + '` · CLI `' + meta.cliVersion + '` · fixture `' + meta.fixtureCommit + '`');
  L.push('');
  L.push(meta.trapCount + ' traps × ' + meta.arms.length + ' arms × ' + meta.repeats + ' repeats = ' + meta.totalRuns + ' fresh headless sessions, read-only tools, no MCP, shuffled order. ' +
    'Every raw answer and every injected block is in `results/' + runId + '/runs/`.');
  L.push('');

  L.push('## 1. Headline — did the answer avoid the documented mistake?');
  L.push('');
  L.push('A trap passes only when **every** outcome check passes. Checks are regexes verified against the fixture source; the `**Refined prompt:**` line is stripped before scoring.');
  L.push('');
  L.push('| arm | trap pass rate | grounding traps | stance traps | individual checks |');
  L.push('|---|---|---|---|---|');
  for (const arm of meta.arms) {
    const r = row(arm);
    L.push('| ' + ARMS[arm] + ' (`' + arm + '`) | **' + pct(r.trapPassRate) + '** | ' + pct(r.groundingPassRate) + ' | ' + pct(r.stancePassRate) + ' | ' + pct(r.checkPassRate) + ' |');
  }
  L.push('');
  if (a0.trapPassRate !== undefined && a2.trapPassRate !== undefined) {
    L.push('- full enhancer vs no hook: **' + pp(a0.trapPassRate, a2.trapPassRate) + '** on trap pass rate (grounding ' + pp(a0.groundingPassRate, a2.groundingPassRate) + ', stance ' + pp(a0.stancePassRate, a2.stancePassRate) + ').');
    if (a1.trapPassRate !== undefined) L.push('- full enhancer vs rules only: **' + pp(a1.trapPassRate, a2.trapPassRate) + '** — what the dynamic layers (intent → stance, BM25 retrieval) add over a static rules file.');
    if (a1.trapPassRate !== undefined) L.push('- rules only vs no hook: ' + pp(a0.trapPassRate, a1.trapPassRate) + ' — what a good CLAUDE.md alone buys.');
  }
  L.push('');

  if (judge) {
    L.push('## 2. Blind pairwise judge (`' + judge.meta.judgeModel + '`)');
    L.push('');
    L.push('A different model compares two answers to the same prompt against the ground-truth key, blind to the arm, twice per pair with positions swapped. Ties excluded from the win rate; CI is a bootstrap over traps.');
    L.push('');
    L.push('| comparison | verdicts | win rate | 95% CI | consistent wins / losses / position flips |');
    L.push('|---|---|---|---|---|');
    const NAME = { '0v2': 'full enhancer vs no hook', '1v2': 'full enhancer vs rules only' };
    for (const pair of judge.meta.pairs) {
      const s = judge.summary[pair];
      L.push('| ' + (NAME[pair] || pair) + ' | ' + s.verdicts + ' | **' + pct(s.winRateExclTies) + '** | ' + (s.ci95[0] === null ? 'n/a' : pct(s.ci95[0]) + '–' + pct(s.ci95[1])) + ' | ' + s.consistentWins + ' / ' + s.consistentLosses + ' / ' + s.positionFlips + ' |');
      for (const g of ['grounding', 'stance']) {
        const sg = judge.byGroup[pair][g];
        L.push('| ↳ ' + g + ' | ' + sg.verdicts + ' | ' + pct(sg.winRateExclTies) + ' | ' + (sg.ci95[0] === null ? 'n/a' : pct(sg.ci95[0]) + '–' + pct(sg.ci95[1])) + ' | ' + sg.consistentWins + ' / ' + sg.consistentLosses + ' / ' + sg.positionFlips + ' |');
      }
    }
    L.push('');
  }

  L.push('## ' + (judge ? '3' : '2') + '. What it costs');
  L.push('');
  L.push('| arm | injected chars | input tokens | cache-read tokens | output tokens | turns | wall time | $/answer | total $ |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const arm of meta.arms) {
    const r = row(arm);
    L.push('| ' + ARMS[arm] + ' | ' + num(r.meanInjectedChars) + ' | ' + num(r.meanInputTokens) + ' | ' + num(r.meanCacheReadTokens) + ' | ' + num(r.meanOutputTokens) + ' | ' + num(r.meanTurns, 1) + ' | ' + num(r.meanWallMs / 1000) + ' s | $' + num(r.meanCostUsd, 3) + ' | $' + num(r.totalCostUsd, 2) + ' |');
  }
  L.push('');
  L.push('Compliance with the injected format (restatement line, file:line citation) — reported, never headlined, because the enhancer instructs it: ' +
    meta.arms.map((a) => ARMS[a] + ' ' + pct(row(a).complianceRate)).join(' · ') + '.');
  L.push('');

  // Side-by-sides: traps with the largest arm2 − arm0 pass gap.
  const traps = summary.perTrap.map((t) => {
    const p = (s) => { const m = /^(\d+)\/(\d+)$/.exec(s || ''); return m ? Number(m[1]) / Number(m[2]) : null; };
    return { id: t.id, group: t.group, lesson: t.lesson, r0: p(t['arm0-none']), r1: p(t['arm1-rules']), r2: p(t['arm2-full']) };
  }).filter((t) => t.r0 !== null && t.r2 !== null);
  const wins = traps.filter((t) => t.r2 > t.r0).sort((a, b) => (b.r2 - b.r0) - (a.r2 - a.r0)).slice(0, 5);
  const losses = traps.filter((t) => t.r2 < t.r0).sort((a, b) => (b.r0 - b.r2) - (a.r0 - a.r2)).slice(0, 3);

  L.push('## ' + (judge ? '4' : '3') + '. Side by side — where the difference is visible');
  L.push('');
  for (const t of wins) {
    const r0 = runs.find((r) => r.trapId === t.id && r.arm === 'arm0-none' && r.score && !r.score.passed) || runs.find((r) => r.trapId === t.id && r.arm === 'arm0-none' && r.score);
    const r2 = runs.find((r) => r.trapId === t.id && r.arm === 'arm2-full' && r.score && r.score.passed) || runs.find((r) => r.trapId === t.id && r.arm === 'arm2-full' && r.score);
    if (!r0 || !r2) continue;
    const trapDef = JSON.parse(fs.readFileSync(path.join(ROOT, 'traps', t.id + '.json'), 'utf8'));
    L.push('### `' + t.id + '` — no hook ' + pct(t.r0) + ' → full enhancer ' + pct(t.r2));
    L.push('');
    L.push('**Prompt:** ' + trapDef.prompt.split('\n')[0] + (trapDef.prompt.includes('\n') ? ' …' : ''));
    L.push('');
    L.push('**Lesson:** ' + t.lesson);
    L.push('');
    L.push('<table><tr><th>no hook</th><th>full enhancer</th></tr><tr><td valign="top">');
    L.push('');
    L.push(excerpt(r0.text, 1100));
    L.push('');
    L.push('</td><td valign="top">');
    L.push('');
    L.push(excerpt(r2.text, 1100));
    L.push('');
    L.push('</td></tr></table>');
    L.push('');
    const failed0 = r0.score.checks.filter((c) => c.class === 'outcome' && c.pass === false).map((c) => '`' + c.id + '`');
    L.push('No-hook run missed: ' + (failed0.length ? failed0.join(', ') : '(none)') + '. Full responses: `runs/' + t.id + '__arm0-none__r' + r0.repeat + '.json`, `runs/' + t.id + '__arm2-full__r' + r2.repeat + '.json`.');
    L.push('');
  }
  if (losses.length) {
    L.push('### Where the enhancer did WORSE');
    L.push('');
    L.push('| trap | no hook | full enhancer | lesson |');
    L.push('|---|---|---|---|');
    for (const t of losses) L.push('| `' + t.id + '` | ' + pct(t.r0) + ' | ' + pct(t.r2) + ' | ' + t.lesson + ' |');
    L.push('');
  }

  L.push('## ' + (judge ? '5' : '4') + '. Per trap');
  L.push('');
  L.push('| trap | group | ' + meta.arms.map((a) => ARMS[a]).join(' | ') + ' | lesson |');
  L.push('|---|---|' + meta.arms.map(() => '---|').join('') + '---|');
  for (const t of summary.perTrap) L.push('| `' + t.id + '` | ' + t.group + ' | ' + meta.arms.map((a) => t[a]).join(' | ') + ' | ' + t.lesson + ' |');
  L.push('');

  L.push('## Limitations (read these before quoting a number)');
  L.push('');
  L.push('- One small fixture (35 TypeScript files), one model, one CLI version, ' + meta.repeats + ' repeats. A snapshot, not a law.');
  L.push('- The traps were written by the people who wrote the enhancer, from real upstream bug reports — but we chose which ones. Add your own; the format is `traps/*.json`.');
  L.push('- Regex checks can be satisfied by the right words for the wrong reason; the blind judge exists to catch that, and its ground-truth key was written from the code, not from any answer.');
  L.push('- The fixture ships a knowledge base the enhancer retrieves from. No KB → the grounding layer has nothing to retrieve; the stance layer still runs. On your project the gap depends on what you write down.');
  L.push('- Every run is a fresh session with a self-contained prompt. Real prompts are mostly mid-conversation follow-ups, which this cannot replay.');
  L.push('- Headless `claude -p` with read-only tools. Interactive use has more turns, more tools and more places to go wrong; we did not measure that.');
  L.push('');
  L.push('Reproduce: `node run.js` then `node judge.js` then `node report.js`. Needs the `claude` CLI logged in.');

  fs.writeFileSync(path.join(ROOT, 'RESULTS.md'), L.join('\n') + '\n');
  console.log('Wrote RESULTS.md from run ' + runId);
}

main();
