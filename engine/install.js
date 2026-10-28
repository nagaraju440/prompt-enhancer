#!/usr/bin/env node
/*
 * install.js — wire the prompt enhancer into a project, in one command.
 * ---------------------------------------------------------------------------
 *   node /path/to/engine/install.js              install into the current dir
 *   node /path/to/engine/install.js /path/to/proj   ...into another project
 *   node /path/to/engine/install.js --uninstall   remove it again
 *   node /path/to/engine/install.js --local       write .claude/settings.local.json
 *                                                 (gitignored; your machine only)
 *   node /path/to/engine/install.js --starter     also drop a starter rules file
 *                                                 and project.json, if absent
 *   node /path/to/engine/install.js --no-logger   skip the Stop hook that records
 *                                                 what Claude understood you to mean
 *
 * It edits exactly one file: <project>/.claude/settings.json (or the .local
 * variant). Existing settings, including other UserPromptSubmit hooks, are
 * preserved — this appends one entry and nothing else. Running it twice is a
 * no-op rather than a duplicate. The previous file is kept as
 * settings.json.bak-<timestamp> before any change.
 *
 * Nothing else is required to start: with no knowledge base the grounding layer
 * stays quiet and the stance layer still runs. Add .claude/knowledge/*.md later
 * and retrieval turns itself on.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ENGINE = path.resolve(__dirname, 'prompt-enhancer.js');
const LOGGER = path.resolve(__dirname, 'refined-prompt-logger.js');
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const UNINSTALL = flag('--uninstall');
const LOCAL = flag('--local');
const STARTER = flag('--starter');
const NO_LOGGER = flag('--no-logger');
if (flag('--help') || flag('-h')) {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^\/\*|^ \* ?| \*$/gm, ''));
  process.exit(0);
}

const target = path.resolve(args.find((a) => !a.startsWith('--')) || process.cwd());
const claudeDir = path.join(target, '.claude');
const settingsFile = path.join(claudeDir, LOCAL ? 'settings.local.json' : 'settings.json');

// The hook command. No env-var prefix: the engine reads CLAUDE_PROJECT_DIR,
// which Claude Code sets for every hook, so the same string works in bash,
// zsh, PowerShell and cmd.exe. Forward slashes are valid on Windows too.
const COMMAND = 'node "' + ENGINE.replace(/\\/g, '/') + '"';
const LOG_COMMAND = 'node "' + LOGGER.replace(/\\/g, '/') + '"';

function fail(msg) { console.error('✗ ' + msg); process.exit(1); }

if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) fail('not a directory: ' + target);
if (!fs.existsSync(ENGINE)) fail('engine not found next to this script: ' + ENGINE);

/* --------------------------- read what is there --------------------------- */

let settings = {};
let existed = false;
if (fs.existsSync(settingsFile)) {
  existed = true;
  const raw = fs.readFileSync(settingsFile, 'utf8');
  try {
    settings = JSON.parse(raw);
  } catch (e) {
    fail('could not parse ' + settingsFile + ' (' + e.message + ').\n' +
      '  Fix the JSON first — this script will not overwrite a file it cannot read.');
  }
  if (settings === null || typeof settings !== 'object' || Array.isArray(settings)) {
    fail(settingsFile + ' is not a JSON object.');
  }
}

settings.hooks = settings.hooks && typeof settings.hooks === 'object' ? settings.hooks : {};
const list = Array.isArray(settings.hooks.UserPromptSubmit) ? settings.hooks.UserPromptSubmit : [];
const stopList = Array.isArray(settings.hooks.Stop) ? settings.hooks.Stop : [];

// Is one of our entries already here? Match on the script name, so an entry
// edited by hand (different timeout, env prefix) is still recognised.
const isOurs = (h) => h && h.type === 'command' && typeof h.command === 'string' &&
  /prompt-enhancer\.js/i.test(h.command);
const isOurLogger = (h) => h && h.type === 'command' && typeof h.command === 'string' &&
  /refined-prompt-logger\.js/i.test(h.command);
const mine = (entry) => Array.isArray(entry && entry.hooks) && entry.hooks.some(isOurs);
const mineLogger = (entry) => Array.isArray(entry && entry.hooks) && entry.hooks.some(isOurLogger);

/* ------------------------------- uninstall -------------------------------- */

if (UNINSTALL) {
  if (!existed) fail('nothing to uninstall: ' + settingsFile + ' does not exist');
  const kept = list.filter((e) => !mine(e));
  const keptStop = stopList.filter((e) => !mineLogger(e));
  if (kept.length === list.length && keptStop.length === stopList.length) {
    console.log('• no prompt-enhancer hook found in ' + settingsFile + ' — nothing to do');
    process.exit(0);
  }
  if (kept.length) settings.hooks.UserPromptSubmit = kept;
  else delete settings.hooks.UserPromptSubmit;
  if (keptStop.length) settings.hooks.Stop = keptStop;
  else delete settings.hooks.Stop;
  if (!Object.keys(settings.hooks).length) delete settings.hooks;
  backup(settingsFile);
  write(settingsFile, settings);
  console.log('✓ removed the prompt-enhancer hooks from ' + rel(settingsFile));
  console.log('  Your knowledge base, rules file and existing log were left alone.');
  process.exit(0);
}

/* -------------------------------- install --------------------------------- */

if (list.some(mine)) {
  const current = list.find(mine).hooks.find(isOurs).command;
  if (current.includes(ENGINE.replace(/\\/g, '/'))) {
    console.log('✓ already installed in ' + rel(settingsFile) + ' — nothing to change');
  } else {
    list.find(mine).hooks.find(isOurs).command = COMMAND;
    settings.hooks.UserPromptSubmit = list;
    backup(settingsFile);
    write(settingsFile, settings);
    console.log('✓ updated the existing hook to point at ' + rel(ENGINE));
  }
} else {
  list.push({ hooks: [{ type: 'command', command: COMMAND, timeout: 10 }] });
  settings.hooks.UserPromptSubmit = list;
  fs.mkdirSync(claudeDir, { recursive: true });
  if (existed) backup(settingsFile);
  write(settingsFile, settings);
  console.log('✓ installed into ' + rel(settingsFile) + (existed ? ' (existing settings preserved)' : ' (new file)'));
}

// The Stop hook that records what Claude understood your prompt to mean. It is
// what makes the before/after pairs in EXAMPLES.md; without it the log holds
// only the injection side. Skipped with --no-logger.
if (!NO_LOGGER && !stopList.some(mineLogger)) {
  stopList.push({ hooks: [{ type: 'command', command: LOG_COMMAND, timeout: 5 }] });
  settings.hooks.Stop = stopList;
  write(settingsFile, settings);
  console.log('✓ added the restatement logger (Stop hook) — writes prompt/understanding pairs to the log');
} else if (NO_LOGGER) {
  console.log('• skipped the restatement logger (--no-logger)');
}

// The log holds your prompts verbatim. It is local and rotated, but nothing
// stops `git add .` from committing it, so make the project ignore it.
protectLog();

/* ----------------------------- optional starter ---------------------------- */

if (STARTER) {
  const rules = path.join(claudeDir, 'session-guardrail.txt');
  if (!fs.existsSync(rules)) {
    fs.writeFileSync(rules, starterRules(), 'utf8');
    console.log('✓ wrote a starter rules file: ' + rel(rules) + ' — edit it, it is injected verbatim');
  } else {
    console.log('• kept your existing ' + rel(rules));
  }
  const proj = path.join(claudeDir, 'enhancer.project.json');
  if (!fs.existsSync(proj)) {
    fs.writeFileSync(proj, JSON.stringify({
      name: path.basename(target),
      stack: '',
      ticketPattern: '\\b[A-Z][A-Z0-9]+-\\d+\\b',
      ticketLabel: 'ticket',
      repos: [],
      people: {},
    }, null, 2) + '\n', 'utf8');
    console.log('✓ wrote ' + rel(proj) + ' — set `stack` and `repos` to sharpen the role line');
  } else {
    console.log('• kept your existing ' + rel(proj));
  }
}

/* --------------------------------- report ---------------------------------- */

const kb = path.join(claudeDir, 'knowledge');
const hasKb = fs.existsSync(kb) && fs.readdirSync(kb).some((f) => f.endsWith('.md'));
console.log('');
console.log('  project : ' + target);
console.log('  engine  : ' + ENGINE);
console.log('  stance layer    : on (works with no setup at all)');
console.log('  grounding layer : ' + (hasKb
  ? 'on — retrieving from ' + rel(kb)
  : 'quiet — add .claude/knowledge/*.md and it turns itself on'));
console.log('  log             : ' + (NO_LOGGER
  ? 'off (--no-logger)'
  : '.claude/enhancer-log.md — what you asked, and what Claude understood') +
  '\n                    local, rotated at 1 MB · ENHANCER_LOG=0 off · =debug adds matcher details');
console.log('');
console.log('  Start a new Claude Code session in this project; the hook runs on your next prompt.');
console.log('  See it for yourself, no session needed:');
console.log('    echo {"prompt":"fix the login bug"} | node "' + ENGINE.replace(/\\/g, '/') + '"');
console.log('  Turn it off for one session: set ENHANCER_OFF=1   ·   remove it: node install.js --uninstall');

/* --------------------------------- helpers --------------------------------- */

function write(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n', 'utf8'); }
function rel(p) { const r = path.relative(target, p); return r && !r.startsWith('..') ? r : p; }
function backup(file) {
  const b = file + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-');
  try { fs.copyFileSync(file, b); console.log('• backed up your previous settings to ' + rel(b)); } catch { /* best effort */ }
}

// Append an ignore rule for the diagnostics log, so a stray `git add .` cannot
// commit your own prompts. Writes .claude/.gitignore (scoped, never touches a
// .gitignore you maintain) and only when this is a git repo.
function protectLog() {
  try {
    if (!fs.existsSync(path.join(target, '.git'))) return;
    const gi = path.join(claudeDir, '.gitignore');
    const rule = 'enhancer-log.md\nenhancer-log.md.*\n';
    const have = fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '';
    if (/^enhancer-log\.md$/m.test(have)) return;
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(gi, have + (have && !have.endsWith('\n') ? '\n' : '') + rule, 'utf8');
    console.log('✓ added ' + rel(gi) + ' so the log (which holds your prompts) is never committed');
  } catch { /* best effort */ }
}

// A function declaration, not a const: it is used above, and only `function`
// hoists past the temporal dead zone.
function starterRules() {
  return [
    '— Standing rules for this project (injected on every prompt) —',
    '• Cite file:line for anything you assert about the code, and say what you did not read.',
    '• Only what was asked. No extra features, no refactors of code you were not asked to touch.',
    '• Confirm before anything irreversible or outward-facing: production, deletes, sends, publishes.',
    '• Never report an action as done that you did not actually perform.',
    '',
    '# Replace these with your own. This file is injected verbatim on every prompt,',
    '# so keep it short — a dozen lines of real rules beats a page of good intentions.',
    '',
  ].join('\n');
}
