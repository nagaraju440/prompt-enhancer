#!/usr/bin/env node
/*
 * judge.js — blind pairwise LLM judge over a finished run.
 * ---------------------------------------------------------------------------
 * The regex traps in run.js are the headline because they cannot be charmed.
 * But regexes only see what they were told to look for. This second scorer
 * asks a DIFFERENT model to compare two answers to the same prompt, blind to
 * which arm produced them, against the trap's ground-truth key.
 *
 * Bias controls:
 *   - the judge is a different model family member (default claude-sonnet-5)
 *     from the one that answered (claude-opus-5), to reduce self-preference.
 *   - every pair is judged TWICE with the answers in swapped positions; the
 *     verdict counts once per order, so position bias cancels in the total.
 *   - the `**Refined prompt:**` opener is stripped from every answer, so the
 *     instructed restatement cannot be rewarded as substance.
 *   - the judge runs with NO tools, in an empty directory, with no MCP
 *     servers, and sees only: the user's prompt, the ground-truth key, the two
 *     answers. It cannot read the fixture and cannot tell arms apart.
 *   - the ground-truth key comes from the CODE, not from either answer.
 *
 * Pairs judged: arm2-full vs arm0-none (the headline) and arm2-full vs
 * arm1-rules (the ablation) — same trap, same repeat index.
 *
 * USAGE
 *   node judge.js <runId>                      judge everything
 *   node judge.js <runId> --pairs 0v2          only arm0 vs arm2
 *   node judge.js <runId> --model claude-sonnet-5
 *   node judge.js <runId> --resume             skip pairs already judged
 *
 * Writes results/<runId>/judge.json and judge.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');
const { mulberry32, shuffle, stripRefinedLine } = require('./run.js');

const ROOT = __dirname;
const RESULTS = path.join(ROOT, 'results');
const TRAPS_DIR = path.join(ROOT, 'traps');

function parseArgs(argv) {
  const out = { runId: '', model: 'claude-sonnet-5', pairs: ['0v2', '1v2'], claude: '', resume: false, timeoutMs: 180000, seed: 7 };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--model') out.model = next();
    else if (a === '--pairs') out.pairs = next().split(',').map((s) => s.trim());
    else if (a === '--claude') out.claude = next();
    else if (a === '--resume') out.resume = true;
    else if (a === '--timeout') out.timeoutMs = parseInt(next(), 10) * 1000;
    else if (a === '--seed') out.seed = parseInt(next(), 10);
    else if (!a.startsWith('--')) out.runId = a;
    else { console.error('unknown arg ' + a); process.exit(2); }
  }
  if (!out.runId) {
    const dirs = fs.existsSync(RESULTS) ? fs.readdirSync(RESULTS).filter((d) => fs.existsSync(path.join(RESULTS, d, 'summary.json'))).sort() : [];
    out.runId = dirs[dirs.length - 1] || '';
  }
  return out;
}

function findClaude(explicit) {
  const candidates = [explicit, process.env.CLAUDE_CLI,
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch { /* */ } }
  return null;
}

const ARM = { 0: 'arm0-none', 1: 'arm1-rules', 2: 'arm2-full' };

function loadRuns(runDir) {
  const out = {};
  for (const f of fs.readdirSync(path.join(runDir, 'runs'))) {
    if (!f.endsWith('.json')) continue;
    const r = JSON.parse(fs.readFileSync(path.join(runDir, 'runs', f), 'utf8'));
    if (!r.ok) continue;
    out[r.trapId + '|' + r.arm + '|' + r.repeat] = r;
  }
  return out;
}

function loadTraps() {
  const t = {};
  for (const f of fs.readdirSync(TRAPS_DIR)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(fs.readFileSync(path.join(TRAPS_DIR, f), 'utf8'));
    t[j.id] = j;
  }
  return t;
}

const JUDGE_SETTINGS = {
  permissions: { allow: [], deny: ['Read', 'Grep', 'Glob', 'Bash', 'Write', 'Edit', 'WebFetch', 'WebSearch', 'Agent', 'Task'] },
  hooks: {},
  includeCoAuthoredBy: false,
};

function clip(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n) + '\n…[truncated ' + (s.length - n) + ' chars]' : s; }

function judgePrompt(trap, a, b) {
  return [
    'You are grading two answers from a coding assistant to the same user request about a small NestJS codebase.',
    'You cannot see the codebase. Use the GROUND TRUTH below as the reference for what a correct answer must say.',
    '',
    'Grade on, in this order of weight:',
    '1. Correctness against the ground truth — does it name the real cause / the real rule / the real risk, without asserting things that are false?',
    '2. Completeness — every part of the request addressed; nothing important silently dropped.',
    '3. Actionability — could the user act on it as written (file and line named, concrete fix, correct scope, no invented work)?',
    '4. Directness — the answer comes first; no padding. Length is NOT a virtue. Formatting is NOT a virtue.',
    'Ignore differences in headings, bold, bullet style, and any restatement of the question.',
    '',
    '<user_request>', trap.prompt, '</user_request>',
    '',
    '<ground_truth>', trap.judge_key || trap.lesson, '</ground_truth>',
    '',
    '<answer_A>', clip(a, 9000), '</answer_A>',
    '',
    '<answer_B>', clip(b, 9000), '</answer_B>',
    '',
    'Reply with ONLY a JSON object on one line, no prose before or after:',
    '{"winner":"A"|"B"|"tie","confidence":1-5,"reason":"<one sentence naming the deciding difference>"}',
  ].join('\n');
}

function askJudge(cli, opts, prompt, tmpDir, settingsPath) {
  const args = ['--print', prompt, '--output-format', 'json', '--settings', settingsPath,
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--max-turns', '1', '--model', opts.model];
  const proc = spawnSync(cli, args, { cwd: tmpDir, encoding: 'utf8', timeout: opts.timeoutMs, maxBuffer: 16 * 1024 * 1024, windowsHide: true, env: Object.assign({}, process.env, { ENHANCER_OFF: '1' }) });
  let parsed = null; try { parsed = JSON.parse(proc.stdout); } catch { /* */ }
  if (!parsed || parsed.is_error) return { error: (parsed && parsed.result) || (proc.stderr || 'no output').slice(0, 300) };
  const text = String(parsed.result || '');
  // Smallest brace-balanced object containing "winner" — a greedy [\s\S]* here
  // swallowed trailing prose on 8 of 288 replies and made JSON.parse fail.
  const m = text.match(/\{[^{}]*"winner"[^{}]*\}/);
  if (!m) return { error: 'no JSON in judge reply: ' + text.slice(0, 200) };
  try {
    const v = JSON.parse(m[0]);
    if (!['A', 'B', 'tie'].includes(v.winner)) return { error: 'bad winner: ' + v.winner };
    return { winner: v.winner, confidence: Number(v.confidence) || null, reason: String(v.reason || '').slice(0, 400), costUsd: parsed.total_cost_usd || 0 };
  } catch (e) { return { error: 'unparseable judge JSON: ' + e.message }; }
}

/* ------------------------------ statistics ------------------------------ */

// Bootstrap 95% CI on the arm-X win rate (ties excluded), resampling TRAPS
// (the cluster), because the 6 verdicts on one trap are not independent.
function bootstrapCI(byTrap, rnd, iters) {
  const traps = Object.keys(byTrap);
  if (!traps.length) return [null, null];
  const rates = [];
  for (let i = 0; i < iters; i++) {
    let w = 0, l = 0;
    for (let k = 0; k < traps.length; k++) {
      const t = byTrap[traps[Math.floor(rnd() * traps.length)]];
      w += t.wins; l += t.losses;
    }
    rates.push(w + l ? w / (w + l) : 0.5);
  }
  rates.sort((a, b) => a - b);
  return [rates[Math.floor(iters * 0.025)], rates[Math.floor(iters * 0.975)]];
}

function tally(verdicts, pairKey) {
  // verdicts for one pair: {trap, repeat, order:'XY'|'YX', winner:'X'|'Y'|'tie'} where X = the tested arm (arm2)
  const vs = verdicts.filter((v) => v.pair === pairKey && !v.error);
  const byTrap = {};
  let wins = 0, losses = 0, ties = 0, consistentWins = 0, consistentLosses = 0, flips = 0;
  const byRepeat = {};
  for (const v of vs) {
    byTrap[v.trap] = byTrap[v.trap] || { wins: 0, losses: 0, ties: 0 };
    if (v.winner === 'X') { wins++; byTrap[v.trap].wins++; }
    else if (v.winner === 'Y') { losses++; byTrap[v.trap].losses++; }
    else { ties++; byTrap[v.trap].ties++; }
    const k = v.trap + '|' + v.repeat;
    byRepeat[k] = byRepeat[k] || {};
    byRepeat[k][v.order] = v.winner;
  }
  for (const k of Object.keys(byRepeat)) {
    const o = byRepeat[k];
    if (o.XY === 'X' && o.YX === 'X') consistentWins++;
    else if (o.XY === 'Y' && o.YX === 'Y') consistentLosses++;
    else if ((o.XY === 'X' && o.YX === 'Y') || (o.XY === 'Y' && o.YX === 'X')) flips++;
  }
  const decided = wins + losses;
  const rnd = mulberry32(12345);
  const [lo, hi] = bootstrapCI(byTrap, rnd, 2000);
  return {
    verdicts: vs.length, wins, losses, ties,
    winRateExclTies: decided ? wins / decided : null,
    winRateInclTies: vs.length ? (wins + ties / 2) / vs.length : null,
    ci95: [lo, hi],
    pairsJudged: Object.keys(byRepeat).length,
    consistentWins, consistentLosses, positionFlips: flips,
    byTrap,
  };
}

/* ---------------------------------- main --------------------------------- */

function main() {
  const opts = parseArgs(process.argv);
  if (!opts.runId) { console.error('No run found. Pass a runId.'); process.exit(1); }
  const runDir = path.join(RESULTS, opts.runId);
  const cli = findClaude(opts.claude);
  if (!cli) { console.error('claude CLI not found'); process.exit(1); }

  const runs = loadRuns(runDir);
  const traps = loadTraps();
  const meta = JSON.parse(fs.readFileSync(path.join(runDir, 'summary.json'), 'utf8')).meta;

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pe-judge-'));
  const settingsPath = path.join(tmpDir, 'judge-settings.json');
  fs.writeFileSync(settingsPath, JSON.stringify(JUDGE_SETTINGS, null, 2));

  const outFile = path.join(runDir, 'judge.json');
  let verdicts = [];
  if (opts.resume && fs.existsSync(outFile)) verdicts = JSON.parse(fs.readFileSync(outFile, 'utf8')).verdicts.filter((v) => !v.error);
  const done = new Set(verdicts.map((v) => v.pair + '|' + v.trap + '|' + v.repeat + '|' + v.order));

  const jobs = [];
  for (const pair of opts.pairs) {
    const [y, x] = pair.split('v').map(Number); // "0v2": Y=arm0 (control), X=arm2 (tested)
    for (const trapId of Object.keys(traps)) {
      for (let r = 1; r <= meta.repeats; r++) {
        const X = runs[trapId + '|' + ARM[x] + '|' + r];
        const Y = runs[trapId + '|' + ARM[y] + '|' + r];
        if (!X || !Y) continue;
        for (const order of ['XY', 'YX']) {
          if (done.has(pair + '|' + trapId + '|' + r + '|' + order)) continue;
          jobs.push({ pair, trapId, r, order, X, Y });
        }
      }
    }
  }
  const order = shuffle(jobs, mulberry32(opts.seed));
  console.log('Judging ' + order.length + ' verdicts with ' + opts.model + ' (run ' + opts.runId + ')');

  let i = 0, cost = 0;
  for (const j of order) {
    i++;
    const trap = traps[j.trapId];
    const xa = stripRefinedLine(j.X.text), ya = stripRefinedLine(j.Y.text);
    const a = j.order === 'XY' ? xa : ya;
    const b = j.order === 'XY' ? ya : xa;
    process.stdout.write('  [' + i + '/' + order.length + '] ' + j.pair + ' ' + j.trapId + ' #' + j.r + ' ' + j.order + ' ... ');
    const v = askJudge(cli, opts, judgePrompt(trap, a, b), tmpDir, settingsPath);
    let winner = null;
    if (!v.error) {
      winner = v.winner === 'tie' ? 'tie' : ((v.winner === 'A') === (j.order === 'XY') ? 'X' : 'Y');
      cost += v.costUsd || 0;
    }
    verdicts.push({ pair: j.pair, trap: j.trapId, group: trap.group, repeat: j.r, order: j.order,
      winner, raw: v.winner || null, confidence: v.confidence || null, reason: v.reason || null, error: v.error || null });
    console.log(v.error ? 'ERROR ' + v.error.slice(0, 60) : (winner === 'X' ? ARM[j.pair.split('v')[1]] : winner === 'Y' ? ARM[j.pair.split('v')[0]] : 'tie') + ' (' + (v.confidence || '?') + ')');
    if (i % 10 === 0) fs.writeFileSync(outFile, JSON.stringify({ meta: { runId: opts.runId, judgeModel: opts.model, pairs: opts.pairs, judgeCostUsd: cost }, verdicts }, null, 2));
  }

  const summary = {};
  for (const pair of opts.pairs) summary[pair] = tally(verdicts, pair);
  // per-group breakdown
  const byGroup = {};
  for (const pair of opts.pairs) {
    byGroup[pair] = {};
    for (const g of ['grounding', 'stance']) byGroup[pair][g] = tally(verdicts.filter((v) => v.group === g), pair);
  }
  fs.writeFileSync(outFile, JSON.stringify({ meta: { runId: opts.runId, judgeModel: opts.model, pairs: opts.pairs, judgeCostUsd: cost, finishedAt: new Date().toISOString() }, summary, byGroup, verdicts }, null, 2));

  const L = ['# Blind pairwise judge — run ' + opts.runId, '', '- judge model: `' + opts.model + '` · verdicts: ' + verdicts.filter((v) => !v.error).length + ' · errors: ' + verdicts.filter((v) => v.error).length + ' · judge cost: $' + cost.toFixed(2), ''];
  L.push('| pair (tested vs control) | verdicts | tested wins | control wins | ties | win rate (excl. ties) | 95% CI | consistent wins / losses / position flips |');
  L.push('|---|---|---|---|---|---|---|---|');
  for (const pair of opts.pairs) {
    const [y, x] = pair.split('v').map(Number);
    const s = summary[pair];
    L.push('| ' + ARM[x] + ' vs ' + ARM[y] + ' | ' + s.verdicts + ' | ' + s.wins + ' | ' + s.losses + ' | ' + s.ties + ' | **' +
      (s.winRateExclTies === null ? 'n/a' : (s.winRateExclTies * 100).toFixed(0) + '%') + '** | ' +
      (s.ci95[0] === null ? 'n/a' : (s.ci95[0] * 100).toFixed(0) + '–' + (s.ci95[1] * 100).toFixed(0) + '%') + ' | ' +
      s.consistentWins + ' / ' + s.consistentLosses + ' / ' + s.positionFlips + ' |');
    for (const g of ['grounding', 'stance']) {
      const sg = byGroup[pair][g];
      L.push('| ↳ ' + g + ' only | ' + sg.verdicts + ' | ' + sg.wins + ' | ' + sg.losses + ' | ' + sg.ties + ' | ' +
        (sg.winRateExclTies === null ? 'n/a' : (sg.winRateExclTies * 100).toFixed(0) + '%') + ' | ' +
        (sg.ci95[0] === null ? 'n/a' : (sg.ci95[0] * 100).toFixed(0) + '–' + (sg.ci95[1] * 100).toFixed(0) + '%') + ' | ' +
        sg.consistentWins + ' / ' + sg.consistentLosses + ' / ' + sg.positionFlips + ' |');
    }
  }
  L.push('', '> Each pair is judged twice with positions swapped; both verdicts count. "Consistent" = the same arm won in both orders;');
  L.push('> "position flips" = the judge changed its mind when the order changed (pure position bias, cancels in the total).');
  L.push('> CI is a bootstrap over traps (the cluster), not over verdicts.', '');
  L.push('## Per trap (tested-arm wins / losses / ties)', '');
  L.push('| trap | group | ' + opts.pairs.map((p) => ARM[p.split('v')[1]] + ' vs ' + ARM[p.split('v')[0]]).join(' | ') + ' |');
  L.push('|---|---|' + opts.pairs.map(() => '---|').join(''));
  for (const trapId of Object.keys(traps).sort()) {
    L.push('| ' + trapId + ' | ' + traps[trapId].group + ' | ' + opts.pairs.map((p) => { const t = summary[p].byTrap[trapId]; return t ? t.wins + ' / ' + t.losses + ' / ' + t.ties : '-'; }).join(' | ') + ' |');
  }
  fs.writeFileSync(path.join(runDir, 'judge.md'), L.join('\n') + '\n');
  console.log('\n' + L.slice(0, 12).join('\n'));
  console.log('\nWrote ' + outFile + ' and judge.md');
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* */ }
}

if (require.main === module) main();
