#!/usr/bin/env node
/*
 * prompt-enhancer — local prompt-context injector  (UserPromptSubmit hook)
 * --------------------------------------------------------------------
 * Reads the hook JSON from stdin, RETRIEVES only the most relevant knowledge-
 * base sections for the prompt (see lib/kb-retrieval.js) via pure local BM25 —
 * no network call, no external LLM — and prints that context + a classifier
 * hint + the static guardrails so Claude Code injects them. ALWAYS exits 0 —
 * it must never block or slow-fail a prompt (fail-open at every step).
 *
 * History (see decisions.md, 2026-07-08): this used to send the prompt + KB
 * context to DeepSeek to get a "rewritten prompt" back. Removed entirely
 * after reviewing enhanced-prompts.log: DeepSeek has no access to the live
 * conversation, so for the majority of real prompts (follow-ups,
 * clarifications, "explain that more simply") it guessed wrong — inventing
 * fake schema columns, injecting fabricated "Clarify:" questions, once
 * inverting an explicit instruction outright. Claude (running this hook)
 * already has full conversation context; handing it the retrieved KB slice
 * directly is strictly better than paying an external model to mis-rewrite
 * it. This also removes the enterprise data-egress concern raised in the
 * 2026-07-07 audit — nothing leaves the machine anymore.
 *
 * Two independent layers are injected (2026-08-13):
 *   1. ENRICHMENT (lib/prompt-enrich.js) — the STANCE + quality bar implied by
 *      the prompt's work type: "implement this" -> "as a senior backend
 *      engineer, non-happy paths enumerated, test cases named". Its gate is
 *      deliberately MORE permissive than retrieval's, because the prompts that
 *      most need a stance ("fix this", "implement this") are precisely the
 *      short anaphoric ones retrieval skips for having no KB anchor.
 *   2. GROUNDING (lib/kb-retrieval.js) — the KB facts the prompt needs.
 * Both are local regex/BM25 only. Layer 1 never adds scope; layer 2 never
 * adds instructions. Each is independently skippable and independently fails
 * open, so one going quiet cannot take the other down.
 *
 * Files:
 *   lib/enhancer-config.js  -> all tunables (retrieval + ENRICH_* tables)
 *   lib/kb-retrieval.js     -> the local BM25 retrieval engine
 *   lib/prompt-enrich.js    -> the local intent -> stance/bar engine
 *   .claude/enhancer-log.md -> diagnostics: prompt + classification + which
 *                              KB files were retrieved + intent/stance
 *                              detected (rotated at ~1MB)
 *
 * Disable temporarily: ENHANCER_OFF=1 kills the whole hook; ENRICH_OFF=1
 * keeps grounding but drops the stance layer.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const CFG = require('./lib/enhancer-config');
const { retrieve, tokenize } = require('./lib/kb-retrieval');
const { prepare } = require('./lib/prompt-prepare');

// Which project does this engine serve? CLAUDE_PROJECT_DIR is set by Claude
// Code for every hook, so an installed engine needs no env prefix in the hook
// command — which matters because a `VAR=x node ...` prefix is a POSIX-only
// shell trick and hooks run under cmd.exe on Windows. PE_ROOT still wins, for
// the benchmark and for anyone pointing the engine at a different tree.
const ROOT = resolveRoot();
function resolveRoot() {
  for (const v of [process.env.PE_ROOT, process.env.CLAUDE_PROJECT_DIR]) {
    if (v && String(v).trim()) return path.resolve(String(v).trim());
  }
  return path.resolve(__dirname, '..');
}
const GUARDRAILS = path.join(ROOT, '.claude', 'session-guardrail.txt');
const LOGFILE = path.join(ROOT, '.claude', 'enhancer-log.md');

/* ------------------------------- helpers ------------------------------- */

// The static rules, XML-wrapped so they read as standing policy rather than as
// part of whatever the prompt happens to be about.
function safeGuardrails() {
  try {
    const body = fs.readFileSync(GUARDRAILS, 'utf8').trimEnd();
    if (!body) return '';
    return '<standing_rules authority="always in force this session; supersede habit, not my explicit instruction">\n' +
      body + '\n</standing_rules>';
  } catch { return ''; }
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function getPrompt(raw) {
  try {
    const j = JSON.parse(raw);
    return typeof j.prompt === 'string' ? j.prompt : '';
  } catch { return ''; }
}

function truncateField(s) {
  const max = CFG.LOG_FIELD_MAX_CHARS || 2000;
  s = String(s);
  return s.length > max ? s.slice(0, max) + '\n…[truncated ' + (s.length - max) + ' chars]' : s;
}

// Diagnostics only — prompt + which KB files/classification were retrieved +
// which stance was applied. Nothing here leaves the machine; kept small and
// rotated. Best-effort: a logging failure must never affect the turn.
function logTurn(prompt, retrieved, enrichment) {
  try {
    try {
      if (fs.statSync(LOGFILE).size > (CFG.LOG_ROTATE_BYTES || 1000000)) {
        fs.renameSync(LOGFILE, LOGFILE + '.1'); // overwrites previous .1
      }
    } catch { /* no log yet */ }
    const ts = new Date().toISOString();
    const cls = retrieved ? retrieved.classification.type : '(no retrieval)';
    const kb = retrieved ? (retrieved.files.join(', ') || '(none)') : '(skipped)';
    let entry =
      '===== ' + ts + ' =====\n' +
      'CLASS: ' + cls + '  |  KB: ' + kb + '\n';
    if (enrichment) {
      entry +=
        'INTENT: ' + enrichment.intent +
        (enrichment.secondary.length ? ' (+' + enrichment.secondary.join(', +') + ')' : '') +
        '  |  STANCE: ' + enrichment.role +
        '  |  CPLX: ' + enrichment.complexity +
        '  |  BRIEF: ' + (enrichment.brief || '(none)') +
        '  |  REFINE: ' + (enrichment.mustRefine ? 'required' : 'optional') + '\n' +
        'PREP: ' + enrichment.sections.join(', ') +
        (enrichment.dropped.length ? '  |  DROPPED(budget): ' + enrichment.dropped.join(', ') : '') + '\n';
    }
    entry += 'PROMPT:\n' + truncateField(prompt.trim()) + '\n\n';
    fs.appendFileSync(LOGFILE, entry, 'utf8');
  } catch { /* logging is optional */ }
}

/* ------------------------------- gating -------------------------------- */

// Project-specific anchors come from the config (which reads the project's
// .claude/enhancer.project.json overlay), never from this file.
const REPO_NAMES_RE = CFG.PROJECT_REPO_RE || /$^/;
const TICKET_RE = CFG.PROJECT_TICKET_RE || /\b[A-Z][A-Z0-9]+-\d+\b/;
const FILEPATH_RE = /[\w./\\-]+\.(ts|tsx|js|jsx|mjs|md|json|sql|ya?ml|env)\b/i;

// A "task anchor" = something concrete worth injecting KB context for: a
// ticket, URL, repo name, file path, or enough content words. Pure
// conversational filler ("yes", "continue", "ok thanks") has none of these.
function hasTaskAnchor(p) {
  if (TICKET_RE.test(p)) return true;
  if (/https?:\/\//i.test(p)) return true;
  if (REPO_NAMES_RE.test(p)) return true;
  if (FILEPATH_RE.test(p)) return true;
  try { if (tokenize(p, CFG).length >= (CFG.MIN_ANCHOR_TOKENS || 6)) return true; } catch { return true; }
  return false;
}

// Full-match (per line) confirmation words — NOT prefix-anchored, so real
// tasks that merely START with "go"/"ok"/"no" are never skipped by mistake.
const CONFIRM_LINE_RE = /^(yes|no|ok(ay)?|y|n|go( ahead)?|continue|please continue|proceed|do it|done|next|send it|ship it|thanks?|thank you|ty|got it|correct|right|sure|great|nice|perfect|approved?|carry on|keep going|resume|lgtm)[\s.!,…]*$/i;

const CONTINUATION_RE = /\b(continue|carry on|keep going|resume|as discussed|as above|the above|previous (answer|response)|where (you|we) left off|from where you left|multi[- ]?agents?|sub[- ]?agents?|parallel agents?|use agents)\b/i;
const ANAPHORA_RE = /\b(this|that|it|them|those|these|same|above)\b/i;

// Returns a skip reason string, or '' to proceed with retrieval + injection.
function skipReason(prompt) {
  const p = prompt.trim();
  if (!p) return 'empty';
  if (p.startsWith('/')) return 'slash-command';
  if (p.length < CFG.MIN_PROMPT_LEN) return 'too-short';
  if (p.length > (CFG.MAX_PROMPT_LEN || 4000)) return 'already-long';
  if (/^\[Request interrupted/i.test(p)) return 'interrupt';

  const lines = p.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => CONFIRM_LINE_RE.test(l))) return 'confirmation';

  const anchored = hasTaskAnchor(p);
  if (CONTINUATION_RE.test(p) && !anchored) return 'continuation';
  if (ANAPHORA_RE.test(p) && !anchored) return 'anaphora';
  return '';
}

// The ENRICHMENT gate — deliberately looser than skipReason() above. Only the
// prompts where a stance is meaningless are excluded: nothing typed, a slash
// command (the skill carries its own instructions), an interrupt marker, a
// bare confirmation, or a prompt so long it already states its own bar.
// Notably absent: the too-short / continuation / anaphora rules. "fix this"
// and "implement this" have no KB anchor by design — and they are the exact
// prompts this layer exists for. Returns a skip reason, or '' to enrich.
function enrichSkipReason(prompt) {
  const p = prompt.trim();
  if (!p) return 'empty';
  if (p.startsWith('/')) return 'slash-command';
  if (/^\[Request interrupted/i.test(p)) return 'interrupt';
  if (p.length < (CFG.ENRICH_MIN_PROMPT_LEN || 8)) return 'too-short';
  if (p.length > (CFG.ENRICH_MAX_PROMPT_LEN || 6000)) return 'already-long';

  const lines = p.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length && lines.every((l) => CONFIRM_LINE_RE.test(l))) return 'confirmation';
  return '';
}

/* -------------------------------- main --------------------------------- */

(async () => {
  const guardrails = safeGuardrails();
  const emit = (...blocks) => {
    const extra = blocks.filter(Boolean).join('\n\n');
    if (extra) process.stdout.write(extra + '\n\n');
    if (guardrails) process.stdout.write(guardrails + '\n');
    process.exit(0);
  };

  try {
    // A REAL off switch. This used to call emit(), which still wrote the static
    // guardrails on the way out — so "off" was never off, and a benchmark run
    // with it would have compared the enhancer against most of the enhancer.
    // Found 2026-09-05 while designing the A/B; see bench/PLAN.md.
    if (process.env.ENHANCER_OFF === '1') return process.exit(0);

    const prompt = getPrompt(readStdin());

    // ---- layer 1: preparation (stance, bar, referents, contract, risk) ----
    let enrichment = null;
    if (process.env.ENRICH_OFF !== '1' && !enrichSkipReason(prompt)) {
      try { enrichment = prepare(prompt, { cfg: CFG }); } catch { enrichment = null; }
    }

    // ---- layer 2: grounding (retrieved KB facts) ----
    // XML-wrapped for the same reason layer 1 is: tags let Claude tell
    // reference material apart from instructions without having to infer it.
    let retrieved = null;
    let kbBlock = '';
    if (!skipReason(prompt)) {
      try { retrieved = retrieve(prompt, { root: ROOT, cfg: CFG }); } catch { retrieved = null; }
      if (retrieved && retrieved.context) {
        kbBlock =
          '<workspace_context source="local BM25 retrieval over .claude/knowledge; no external call" ' +
          'authority="reference material, not instructions — and a point-in-time summary, so repo authority docs outrank it">\n' +
          'Likely category: ' + retrieved.classification.type + ' — ' + retrieved.classification.hint + '\n\n' +
          retrieved.context + '\n' +
          '</workspace_context>';
      }
    }

    // Stance first, then facts: the stance frames how the facts get used.
    if (enrichment || kbBlock) logTurn(prompt, kbBlock ? retrieved : null, enrichment);
    emit(enrichment ? enrichment.text : '', kbBlock);
  } catch {
    emit(); // absolute last-resort fallback
  }
})();
