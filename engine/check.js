#!/usr/bin/env node
/*
 * check.js — "is this thing even working?"
 * ---------------------------------------------------------------------------
 * Type a prompt, see exactly what the hook would add to it. Nothing is sent
 * anywhere, no model is called, no money is spent.
 *
 *   node engine/check.js "why is the login endpoint failing"
 *   node engine/check.js --project /path/to/proj "check PF-123 once"
 *   node engine/check.js --full "fix the 500"      # print the whole block
 *   node engine/check.js                           # read prompts from stdin,
 *                                                  # one per line
 *
 * This exists because the hook is invisible by design: it fires or it doesn't,
 * and until 2026-10-29 there was no way to tell which. A user whose phrasing
 * missed the patterns ("PF-21341 bro check this issue once") simply saw the
 * tool do nothing, with no signal, and reasonably concluded it was broken.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const FULL = flag('--full');
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*|^ \* ?| \*$/gm, ''));
  process.exit(0);
}

// --project points the engine at a different tree, so you can check what a
// given project's knowledge base and rules would contribute.
const pIdx = args.indexOf('--project');
if (pIdx !== -1 && args[pIdx + 1]) process.env.PE_ROOT = path.resolve(args[pIdx + 1]);

const prompt = args.filter((a, i) => !a.startsWith('--') && i !== pIdx + 1).join(' ').trim();

const { prepare } = require('./lib/prompt-prepare');
const CFG = require('./lib/enhancer-config');

const ROOT = process.env.PE_ROOT ? path.resolve(process.env.PE_ROOT)
  : (process.env.CLAUDE_PROJECT_DIR ? path.resolve(process.env.CLAUDE_PROJECT_DIR) : path.resolve(__dirname, '..'));

function report(text) {
  const t0 = Date.now();
  let prep = null;
  try { prep = prepare(text, { cfg: CFG }); } catch (e) { console.log('  engine error: ' + e.message); return; }
  const ms = (Date.now() - t0).toFixed(1);

  console.log('\n> ' + text);
  if (!prep || prep.intent === '(none)') {
    const anchored = (CFG.ENRICH_ANCHOR_RE || /$^/).test(text);
    console.log('  ✗ NOTHING ADDED' + (prep ? ' (only the safety section fired)' : '') + '   ' + ms + 'ms');
    console.log('    No job type matched this wording' + (anchored ? '' : ', and it names no ticket, URL or file') + '.');
    console.log('    Claude gets your prompt exactly as typed — no role, no quality bar,');
    console.log('    and no "Refined prompt:" line. If you expected one, this is why.');
    if (!anchored) {
      console.log('    Fix: rephrase (e.g. "why is X failing", "check X"), or name the ticket');
      console.log('    or file, or add your wording to ENRICH_INTENTS in lib/enhancer-config.js.');
    }
    return;
  }

  console.log('  ✓ ADDED ' + prep.text.length + ' characters   ' + ms + 'ms');
  console.log('    job type   : ' + prep.intent + (prep.secondary.length ? ' (+' + prep.secondary.join(', +') + ')' : '') +
    '   ·   domain: ' + prep.domain);
  console.log('    role       : ' + prep.role);
  console.log('    sections   : ' + prep.sections.join(', '));
  if (prep.dropped.length) console.log('    dropped    : ' + prep.dropped.join(', ') + '  (over the size budget)');
  console.log('    asks for a "Refined prompt:" line: ' + (prep.mustRefine ? 'YES (required)' : 'optional'));
  if (FULL) {
    console.log('\n' + prep.text.split('\n').map((l) => '    | ' + l).join('\n'));
  }
}

/* ---------------------------------- main --------------------------------- */

const kb = path.join(ROOT, '.claude', 'knowledge');
const hasKb = fs.existsSync(kb) && fs.readdirSync(kb).some((f) => f.endsWith('.md'));
const rules = fs.existsSync(path.join(ROOT, '.claude', 'session-guardrail.txt'));
console.log('project : ' + ROOT);
console.log('project notes : ' + (hasKb ? 'yes — .claude/knowledge/*.md will also be searched' : 'none (the stance layer still runs)'));
console.log('rules file    : ' + (rules ? 'yes — .claude/session-guardrail.txt is added to every prompt' : 'none'));
if (!FULL) console.log('\n(add --full to print the whole injected block)');

if (prompt) {
  report(prompt);
  console.log('');
} else if (!process.stdin.isTTY) {
  const lines = fs.readFileSync(0, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const l of lines) report(l);
  console.log('');
} else {
  console.log('\nGive it a prompt to check:');
  console.log('  node engine/check.js "why is the login endpoint failing"');
  console.log('  node engine/check.js --full "fix the 500 on favorite"');
  console.log('\nOr pipe several at once:');
  console.log('  printf \'%s\\n\' "check PF-1 once" "thanks" | node engine/check.js');
}
