#!/usr/bin/env node
/*
 * run.js — the A/B/C benchmark runner.
 * ---------------------------------------------------------------------------
 * Runs every trap prompt through the Claude Code CLI once per ARM per REPEAT,
 * in a fresh non-interactive session each time, inside the fixture project,
 * and scores every answer mechanically.
 *
 *   arm0-none    no hooks at all                  -> true baseline
 *   arm1-rules   static standing-rules only       -> "isn't this just CLAUDE.md?"
 *   arm2-full    the full enhancer                -> the tool under test
 *
 * FAIRNESS RULES BAKED IN HERE
 *  - the ONLY difference between arms is the UserPromptSubmit hook. Permissions,
 *    model, MCP config and working directory are merged in identically for all
 *    three from COMMON_SETTINGS below.
 *  - --strict-mcp-config with an empty config, so none of the developer's real
 *    MCP servers load and change the answers.
 *  - tools are READ-ONLY (Read/Grep/Glob) and identical per arm. The traps are
 *    questions about a codebase; a permission prompt in --print mode would
 *    silently degrade an answer, and a write would change the fixture for the
 *    next run.
 *  - run order is interleaved and shuffled from a fixed seed, so drift in the
 *    service over the run cannot land on one arm.
 *  - a run whose JSON says is_error:true (e.g. an auth failure) is a FAILED
 *    run, not a zero-score answer. It is excluded from every rate and counted
 *    in the "failed" column so it cannot hide.
 *  - every raw response is written to disk so anyone can re-score them, and
 *    for arms 1 and 2 the exact text the hook injected is saved beside it.
 *
 * USAGE
 *   node run.js --dry-run                  show what would run
 *   node run.js --repeats 1 --traps 2      smoke test
 *   node run.js                            full run (24 traps x 3 arms x 3 repeats)
 *   node run.js --arms 0,2                 skip the rules-only arm
 *   node run.js --only g06,s05             specific traps
 *   node run.js --resume <runId>           fill in missing runs of an earlier run
 *   node run.js --parallel 4               concurrent sessions (default 4; order stays shuffled)
 *
 * No npm dependencies.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync, spawn } = require('child_process');

const ROOT = __dirname;
const ENGINE_DIR = path.join(ROOT, 'engine');
const FIXTURE = path.join(ROOT, 'fixture');
const TRAPS_DIR = path.join(ROOT, 'traps');
const RESULTS = path.join(ROOT, 'results');
const ARMS_ALL = ['arm0-none', 'arm1-rules', 'arm2-full'];

/* --------------------------------- args --------------------------------- */

function parseArgs(argv) {
  const out = {
    repeats: 3,
    traps: 0,
    only: [],
    arms: ARMS_ALL.slice(),
    model: 'claude-opus-5',
    dryRun: false,
    claude: '',
    timeoutMs: 420000,
    seed: 20260920,
    resume: '',
    maxTurns: 40,
    parallel: 4,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--repeats') out.repeats = parseInt(next(), 10);
    else if (a === '--traps') out.traps = parseInt(next(), 10);
    else if (a === '--only') out.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--arms') out.arms = next().split(',').map((s) => {
      const t = s.trim();
      return /^\d$/.test(t) ? ARMS_ALL[Number(t)] : t;
    }).filter(Boolean);
    else if (a === '--model') out.model = next();
    else if (a === '--claude') out.claude = next();
    else if (a === '--timeout') out.timeoutMs = parseInt(next(), 10) * 1000;
    else if (a === '--seed') out.seed = parseInt(next(), 10);
    else if (a === '--resume') out.resume = next();
    else if (a === '--max-turns') out.maxTurns = parseInt(next(), 10);
    else if (a === '--parallel') out.parallel = Math.max(1, parseInt(next(), 10));
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else { console.error('unknown arg: ' + a); process.exit(2); }
  }
  return out;
}

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*|^ \* ?/gm, ''));
}

/* ------------------------------ locate CLI ------------------------------ */

function findClaude(explicit) {
  const candidates = [
    explicit,
    process.env.CLAUDE_CLI,
    path.join(os.homedir(), '.local', 'bin', 'claude.exe'),
    path.join(os.homedir(), '.local', 'bin', 'claude'),
    path.join(process.env.APPDATA || '', 'npm', 'claude.cmd'),
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ].filter(Boolean);
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* keep looking */ }
  }
  return null;
}

/* ---------------------------- settings per arm --------------------------- */

const COMMON_SETTINGS = {
  permissions: {
    allow: ['Read', 'Grep', 'Glob'],
    deny: ['Bash', 'Write', 'Edit', 'NotebookEdit', 'WebFetch', 'WebSearch', 'Agent', 'Task'],
  },
  includeCoAuthoredBy: false,
};

function materializeSettings(armName, runDir) {
  const armDir = path.join(ROOT, 'arms', armName);
  let raw = fs.readFileSync(path.join(armDir, 'settings.json'), 'utf8');
  raw = raw
    .split('{{ARM_DIR}}').join(armDir.replace(/\\/g, '/'))
    .split('{{ENGINE_DIR}}').join(ENGINE_DIR.replace(/\\/g, '/'));
  const cfg = JSON.parse(raw);
  delete cfg.$comment;
  const merged = Object.assign({}, COMMON_SETTINGS, cfg);
  const dest = path.join(runDir, 'settings-' + armName + '.json');
  fs.writeFileSync(dest, JSON.stringify(merged, null, 2), 'utf8');
  return dest;
}

/* --------------------------------- traps -------------------------------- */

function loadTraps(opts) {
  const files = fs.readdirSync(TRAPS_DIR).filter((f) => f.endsWith('.json')).sort();
  let traps = [];
  for (const f of files) {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(TRAPS_DIR, f), 'utf8'));
      if (!t.id || !t.prompt) { console.error('skipping malformed trap: ' + f); continue; }
      traps.push(t);
    } catch (e) {
      console.error('skipping unreadable trap ' + f + ': ' + e.message);
    }
  }
  if (opts.only.length) traps = traps.filter((t) => opts.only.some((o) => t.id === o || t.id.startsWith(o)));
  return opts.traps > 0 ? traps.slice(0, opts.traps) : traps;
}

/* -------------------------------- scoring ------------------------------- */

// The refined-prompt opener is an instructed artefact of arm 2. Outcome checks
// run on the answer WITHOUT it, so a trap cannot pass just because the
// restatement happened to contain the right words.
function stripRefinedLine(text) {
  return String(text).replace(/^\s*\*\*Refined prompt:\*\*[^\n]*\n?/m, '');
}

function scoreOne(text, trap) {
  const body = stripRefinedLine(text);
  const results = [];
  for (const chk of trap.checks || []) {
    const cls = chk.class || 'outcome';
    const target = cls === 'compliance' ? text : body;
    let pass = null;
    let error = null;
    try {
      if (chk.type === 'max_chars') {
        pass = target.length <= chk.max;
      } else {
        const hit = new RegExp(chk.pattern, chk.flags || 'i').test(target);
        pass = chk.type === 'must_not_match' ? !hit : hit;
      }
    } catch (e) {
      error = e.message;
    }
    results.push({ id: chk.id, class: cls, type: chk.type, pass, error });
  }
  const outcome = results.filter((r) => r.class === 'outcome');
  const compliance = results.filter((r) => r.class === 'compliance');
  return {
    checks: results,
    outcomePassed: outcome.filter((r) => r.pass === true).length,
    outcomeTotal: outcome.length,
    compliancePassed: compliance.filter((r) => r.pass === true).length,
    complianceTotal: compliance.length,
    passed: outcome.length > 0 && outcome.every((r) => r.pass === true),
    chars: body.length,
  };
}

/* ------------------------------ deterministic ---------------------------- */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rnd) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/* ------------------------------ injected text ---------------------------- */

// What the hook of this arm would inject for this prompt — rendered locally
// with the same env the CLI run gets, and saved beside the answer. Arm 0 has
// no hook, so nothing.
function renderInjected(armName, prompt) {
  let script = null;
  if (armName === 'arm1-rules') script = path.join(ROOT, 'arms', 'arm1-rules', 'rules-only-hook.js');
  if (armName === 'arm2-full') script = path.join(ENGINE_DIR, 'prompt-enhancer.js');
  if (!script) return '';
  const r = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ prompt }),
    env: Object.assign({}, process.env, { PE_ROOT: FIXTURE }),
    encoding: 'utf8',
    timeout: 10000,
    windowsHide: true,
  });
  return r.stdout || '';
}

/* ---------------------------------- run --------------------------------- */

function runOne(cli, opts, trap, armName, settingsPath, repeat, runDir) {
  return new Promise((resolve) => {
  const args = [
    '--print', trap.prompt,
    '--output-format', 'stream-json', '--verbose',
    '--settings', settingsPath,
    '--strict-mcp-config',
    '--mcp-config', '{"mcpServers":{}}',
    '--max-turns', String(opts.maxTurns),
  ];
  if (opts.model) args.push('--model', opts.model);

  const injected = renderInjected(armName, trap.prompt);

  const t0 = Date.now();
  const child = spawn(cli, args, {
    cwd: FIXTURE,
    env: Object.assign({}, process.env, {
      PE_ROOT: FIXTURE,
      ENHANCER_OFF: armName === 'arm0-none' ? '1' : '',
    }),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '', timedOut = false;
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  const timer = setTimeout(() => { timedOut = true; try { child.kill(); } catch { /* */ } }, opts.timeoutMs);
  child.on('close', (status) => {
  clearTimeout(timer);
  const proc = { status: timedOut ? -1 : status, stdout, stderr, error: timedOut ? 'timeout' : '' };
  const wallMs = Date.now() - t0;

  // stream-json: one JSON object per line. Every assistant message's text
  // blocks are kept, in order — the model may write its real answer, then call
  // a tool (e.g. ask the user, which headless mode auto-dismisses), then send a
  // one-line follow-up. With plain --output-format json only that follow-up
  // survived as `result` (found on 6 of the first 157 answers, 2026-09-21).
  let parsed = null;
  const pieces = [];
  for (const line of String(proc.stdout || '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    let j; try { j = JSON.parse(line); } catch { continue; }
    if (j.type === 'assistant' && j.message && Array.isArray(j.message.content)) {
      for (const b of j.message.content) if (b.type === 'text' && b.text && b.text.trim()) pieces.push(b.text.trim());
    } else if (j.type === 'result') {
      parsed = j;
    }
  }
  // Fallback for a non-stream reply (older CLI / --output-format json).
  if (!parsed && !pieces.length) { try { parsed = JSON.parse(proc.stdout); } catch { /* leave null */ } }
  const finalText = parsed && typeof parsed.result === 'string' ? parsed.result : '';
  if (!pieces.length && finalText) pieces.push(finalText);
  const text = pieces.join('\n\n');

  const usage = (parsed && parsed.usage) || {};
  const ok = proc.status === 0 && !!parsed && !parsed.is_error;
  const record = {
    trapId: trap.id,
    group: trap.group,
    arm: armName,
    repeat,
    ok,
    exitCode: proc.status,
    error: !ok ? (parsed && parsed.is_error ? String(parsed.result || 'is_error').slice(0, 500) : (proc.stderr || proc.error || '').toString().slice(0, 500)) : null,
    wallMs,
    apiMs: parsed ? parsed.duration_api_ms : null,
    costUsd: parsed ? parsed.total_cost_usd : null,
    inputTokens: usage.input_tokens ?? null,
    cacheReadTokens: usage.cache_read_input_tokens ?? null,
    cacheCreationTokens: usage.cache_creation_input_tokens ?? null,
    outputTokens: usage.output_tokens ?? null,
    numTurns: parsed ? parsed.num_turns : null,
    assistantMessages: pieces.length,
    finalText,
    injectedChars: injected.length,
    injected,
    stderr: (proc.stderr || '').slice(0, 4000),
    text,
  };
  record.score = ok ? scoreOne(text, trap) : null;

  const fname = trap.id + '__' + armName + '__r' + repeat + '.json';
  fs.writeFileSync(path.join(runDir, 'runs', fname), JSON.stringify(record, null, 2), 'utf8');
  resolve(record);
  });
  });
}

/* -------------------------------- summary -------------------------------- */

function mean(list) {
  const nums = list.filter((n) => typeof n === 'number' && !Number.isNaN(n));
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
}

function rate(records, pick) {
  const scored = records.filter((r) => r.score);
  if (!scored.length) return null;
  return scored.filter(pick).length / scored.length;
}

function summarize(records, opts, traps) {
  const rows = [];
  for (const arm of opts.arms) {
    const rs = records.filter((r) => r.arm === arm);
    const scored = rs.filter((r) => r.score);
    const g = scored.filter((r) => r.group === 'grounding');
    const s = scored.filter((r) => r.group === 'stance');
    rows.push({
      arm,
      runs: rs.length,
      failedRuns: rs.filter((r) => !r.ok).length,
      trapPassRate: rate(scored, (r) => r.score.passed),
      groundingPassRate: rate(g, (r) => r.score.passed),
      stancePassRate: rate(s, (r) => r.score.passed),
      checkPassRate: scored.length
        ? scored.reduce((a, r) => a + r.score.outcomePassed, 0) / Math.max(1, scored.reduce((a, r) => a + r.score.outcomeTotal, 0))
        : null,
      complianceRate: scored.length
        ? scored.reduce((a, r) => a + r.score.compliancePassed, 0) / Math.max(1, scored.reduce((a, r) => a + r.score.complianceTotal, 0))
        : null,
      meanWallMs: mean(rs.map((r) => r.wallMs)),
      meanTurns: mean(rs.map((r) => r.numTurns)),
      meanInputTokens: mean(rs.map((r) => r.inputTokens)),
      meanCacheReadTokens: mean(rs.map((r) => r.cacheReadTokens)),
      meanCacheCreationTokens: mean(rs.map((r) => r.cacheCreationTokens)),
      meanOutputTokens: mean(rs.map((r) => r.outputTokens)),
      meanAnswerChars: mean(scored.map((r) => r.score.chars)),
      meanInjectedChars: mean(rs.map((r) => r.injectedChars)),
      meanCostUsd: mean(rs.map((r) => r.costUsd)),
      totalCostUsd: rs.reduce((a, r) => a + (r.costUsd || 0), 0),
    });
  }

  const perTrap = traps.map((t) => {
    const row = { id: t.id, group: t.group, lesson: t.lesson || '' };
    for (const arm of opts.arms) {
      const rs = records.filter((r) => r.trapId === t.id && r.arm === arm && r.score);
      row[arm] = rs.length ? rs.filter((r) => r.score.passed).length + '/' + rs.length : '-';
    }
    return row;
  });

  // Per-check failure counts per arm — which specific checks each arm misses.
  const perCheck = [];
  for (const t of traps) {
    for (const c of t.checks || []) {
      if ((c.class || 'outcome') !== 'outcome') continue;
      const row = { trap: t.id, check: c.id };
      for (const arm of opts.arms) {
        const rs = records.filter((r) => r.trapId === t.id && r.arm === arm && r.score);
        const passed = rs.filter((r) => (r.score.checks.find((x) => x.id === c.id) || {}).pass === true).length;
        row[arm] = rs.length ? passed + '/' + rs.length : '-';
      }
      perCheck.push(row);
    }
  }

  return { rows, perTrap, perCheck };
}

function pct(x) { return x === null || x === undefined ? 'n/a' : (x * 100).toFixed(0) + '%'; }
function fmt(n, d) { return n === null || n === undefined ? 'n/a' : n.toFixed(d === undefined ? 1 : d); }

function writeSummary(runDir, meta, summary) {
  fs.writeFileSync(path.join(runDir, 'summary.json'), JSON.stringify({ meta, summary }, null, 2), 'utf8');

  const L = [];
  L.push('# Benchmark run ' + meta.runId);
  L.push('');
  L.push('- model: `' + (meta.model || 'default') + '` · cli: `' + meta.cliVersion + '`');
  L.push('- traps: ' + meta.trapCount + ' · arms: ' + meta.arms.join(', ') + ' · repeats: ' + meta.repeats + ' · runs: ' + meta.totalRuns);
  L.push('- started: ' + meta.startedAt + ' · finished: ' + (meta.finishedAt || '(incomplete)'));
  L.push('');
  L.push('## Headline — trap pass rate (all outcome checks passed; higher is better)');
  L.push('');
  L.push('| arm | runs | failed | trap pass | grounding | stance | check pass | compliance | turns | wall (s) | in-tok | cache-read | out-tok | injected chars | total $ |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of summary.rows) {
    L.push('| ' + [
      r.arm, r.runs, r.failedRuns,
      '**' + pct(r.trapPassRate) + '**', pct(r.groundingPassRate), pct(r.stancePassRate),
      pct(r.checkPassRate), pct(r.complianceRate),
      fmt(r.meanTurns, 1), fmt(r.meanWallMs === null ? null : r.meanWallMs / 1000, 0),
      fmt(r.meanInputTokens, 0), fmt(r.meanCacheReadTokens, 0), fmt(r.meanOutputTokens, 0),
      fmt(r.meanInjectedChars, 0), r.totalCostUsd.toFixed(2),
    ].join(' | ') + ' |');
  }
  L.push('');
  L.push('## Per trap (passes / scored runs)');
  L.push('');
  L.push('| trap | group | ' + meta.arms.join(' | ') + ' | lesson |');
  L.push('|---|---|' + meta.arms.map(() => '---|').join('') + '---|');
  for (const t of summary.perTrap) {
    L.push('| ' + t.id + ' | ' + t.group + ' | ' + meta.arms.map((a) => t[a]).join(' | ') + ' | ' + t.lesson + ' |');
  }
  L.push('');
  L.push('## Per check (passes / scored runs) — where exactly each arm falls');
  L.push('');
  L.push('| trap | check | ' + meta.arms.join(' | ') + ' |');
  L.push('|---|---|' + meta.arms.map(() => '---|').join(''));
  for (const c of summary.perCheck) {
    L.push('| ' + c.trap + ' | ' + c.check + ' | ' + meta.arms.map((a) => c[a]).join(' | ') + ' |');
  }
  L.push('');
  L.push('> Raw responses for every run are in `runs/`, with the exact injected text for arms 1 and 2. Re-score them yourself.');
  L.push('> Trap pass = ALL outcome checks passed, scored on the answer with the `**Refined prompt:**` line removed.');
  L.push('> Compliance (restatement line, file:line citation) is excluded from the headline on purpose: the enhancer');
  L.push('> instructs it, so winning it proves obedience, not quality.');
  fs.writeFileSync(path.join(runDir, 'summary.md'), L.join('\n') + '\n', 'utf8');
}

/* ---------------------------------- main --------------------------------- */

async function main() {
  const opts = parseArgs(process.argv);

  const cli = findClaude(opts.claude);
  if (!cli) {
    console.error('Could not find the claude CLI. Pass --claude <path> or set CLAUDE_CLI.');
    process.exit(1);
  }
  const ver = spawnSync(cli, ['--version'], { encoding: 'utf8', windowsHide: true });
  const cliVersion = (ver.stdout || '').trim();

  const traps = loadTraps(opts);
  if (!traps.length) { console.error('No traps found in ' + TRAPS_DIR); process.exit(1); }
  if (!fs.existsSync(path.join(FIXTURE, '.claude', 'knowledge'))) {
    console.error('Fixture is not set up: ' + FIXTURE + ' has no .claude/knowledge.');
    process.exit(1);
  }
  // Pre-flight: one cheap call so an expired login fails here, not 216 times.
  if (!opts.dryRun) {
    const pf = spawnSync(cli, ['--print', 'Reply with the single word OK', '--output-format', 'json',
      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--model', opts.model || 'claude-opus-5', '--max-turns', '1'],
      { cwd: FIXTURE, encoding: 'utf8', timeout: 90000, windowsHide: true });
    let pj = null; try { pj = JSON.parse(pf.stdout); } catch { /* */ }
    if (!pj || pj.is_error) {
      console.error('Pre-flight call failed: ' + (pj ? pj.result : (pf.stderr || pf.stdout || 'no output').slice(0, 300)));
      console.error('Log in first (`claude auth login`) or set ANTHROPIC_API_KEY, then re-run.');
      process.exit(1);
    }
  }

  const rnd = mulberry32(opts.seed);
  const jobs = [];
  for (const trap of traps) for (const arm of opts.arms) for (let r = 1; r <= opts.repeats; r++) jobs.push({ trap, arm, repeat: r });
  const order = shuffle(jobs, rnd);

  const runId = opts.resume || new Date().toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(RESULTS, runId);

  if (opts.dryRun) {
    console.log('DRY RUN — nothing will be executed.');
    console.log('  cli      : ' + cli + ' (' + cliVersion + ')');
    console.log('  model    : ' + opts.model);
    console.log('  fixture  : ' + FIXTURE);
    console.log('  traps    : ' + traps.length + ' (' + traps.map((t) => t.id).join(', ') + ')');
    console.log('  arms     : ' + opts.arms.join(', '));
    console.log('  repeats  : ' + opts.repeats);
    console.log('  TOTAL    : ' + order.length + ' runs');
    console.log('  order[0..4]: ' + order.slice(0, 5).map((j) => j.trap.id + '/' + j.arm + '#' + j.repeat).join(', '));
    return;
  }

  fs.mkdirSync(path.join(runDir, 'runs'), { recursive: true });
  const settingsByArm = {};
  for (const arm of opts.arms) settingsByArm[arm] = materializeSettings(arm, runDir);

  const meta = {
    runId, startedAt: new Date().toISOString(), cli, cliVersion, model: opts.model,
    arms: opts.arms, repeats: opts.repeats, trapCount: traps.length, totalRuns: order.length, seed: opts.seed,
    fixtureCommit: 'lujakob/nestjs-realworld-example-app@c1c2cc4',
  };

  console.log('Run ' + runId + ' — ' + order.length + ' runs (' + traps.length + ' traps x ' +
    opts.arms.length + ' arms x ' + opts.repeats + ' repeats), model ' + opts.model);

  const records = [];
  const pending = [];
  for (const job of order) {
    const fname = path.join(runDir, 'runs', job.trap.id + '__' + job.arm + '__r' + job.repeat + '.json');
    if (opts.resume && fs.existsSync(fname)) {
      const prev = JSON.parse(fs.readFileSync(fname, 'utf8'));
      if (prev.ok) { records.push(prev); continue; }
    }
    pending.push(job);
  }
  console.log('  ' + records.length + ' already done, ' + pending.length + ' to run, ' + opts.parallel + ' in parallel');
  let next = 0, done = 0;
  const label = (j) => j.trap.id + ' / ' + j.arm + ' #' + j.repeat;
  async function worker(id) {
    while (next < pending.length) {
      const job = pending[next++];
      const t = Date.now();
      const rec = await runOne(cli, opts, job.trap, job.arm, settingsByArm[job.arm], job.repeat, runDir);
      records.push(rec);
      done++;
      const status = !rec.ok ? 'ERROR ' + (rec.error || '').slice(0, 80)
        : (rec.score.passed ? 'pass' : 'FAIL ' + rec.score.outcomePassed + '/' + rec.score.outcomeTotal) +
          '  ' + (rec.wallMs / 1000).toFixed(0) + 's  ' + rec.numTurns + 't  $' + (rec.costUsd || 0).toFixed(3);
      console.log('  [' + done + '/' + pending.length + '] w' + id + ' ' + label(job) + ' ... ' + status);
      // Running summary so a killed run still has numbers.
      if (done % 5 === 0) writeSummary(runDir, meta, summarize(records, opts, traps));
    }
  }
  await Promise.all(Array.from({ length: Math.min(opts.parallel, pending.length) }, (_, k) => worker(k + 1)));

  meta.finishedAt = new Date().toISOString();
  writeSummary(runDir, meta, summarize(records, opts, traps));
  console.log('');
  console.log(fs.readFileSync(path.join(runDir, 'summary.md'), 'utf8'));
  console.log('Results: ' + runDir);
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });

module.exports = { scoreOne, summarize, shuffle, mulberry32, stripRefinedLine };
