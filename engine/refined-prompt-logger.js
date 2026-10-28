#!/usr/bin/env node
/*
 * refined-prompt logger  (Stop hook)
 * --------------------------------------------------------------------
 * Runs after Claude finishes responding. Reads the transcript for this
 * turn, finds the user's original prompt and Claude's own "**Refined
 * prompt:**" restatement line (see session-guardrail.txt), and logs the
 * pair to enhancer-log.md. No external LLM call, no network — this is
 * Claude (who already has full conversation context) restating its own
 * understanding, not a second model rewriting the prompt. See
 * README for why a stateless external rewriter is the wrong design.
 *
 * ALWAYS exits 0 — must never block or fail the turn (fail-open).
 */
'use strict';

const fs = require('fs');
const path = require('path');

// Same root precedence as prompt-enhancer.js, so both hooks write to the same
// log in the project being worked on.
const ROOT = (function () {
  for (const v of [process.env.PE_ROOT, process.env.CLAUDE_PROJECT_DIR]) {
    if (v && String(v).trim()) return path.resolve(String(v).trim());
  }
  return path.resolve(__dirname, '..');
})();
const LOGFILE = path.join(ROOT, '.claude', 'enhancer-log.md');

// Anchored to the start of a line (allowing a quote/bullet prefix) and matched
// only against prose, so a turn that *discusses* this feature is not mistaken
// for one that emits it. That was a real defect: before 2026-08-28 the pattern
// was /\*\*Refined prompt:\*\*\s*(.+)/ and matched the first occurrence
// anywhere, so a markdown table cell containing the words got logged as a
// refined prompt — the corpus still holds one row reading
//   ` line | "did I understand you" | existed — but purely descriptive |`
// The old `.+` also stopped at the first newline, truncating any restatement
// that wrapped onto a second line; this captures through to the blank line.
// No /m flag on purpose: with it, `$` in the lookahead matches at the end of
// EVERY line, so the lazy capture stopped at the first newline and a wrapped
// restatement lost its second half. `(?:^|\n)` does the line anchoring instead,
// and without /m the `$` means the true end of input. The capture is bounded
// (800 chars) so a response that never emits a blank line cannot swallow its
// own body — the longest restatement ever logged was 702 chars.
const REFINED_RE = /(?:^|\n)[ \t]*(?:[>*-]\s*)?\*\*Refined prompt:\*\*[ \t]*([\s\S]{0,800}?)(?=\n[ \t]*\n|$)/i;

// Drop fenced code blocks (including an unterminated final fence) and markdown
// table rows before matching — those are where the phrase appears when it is
// being talked about rather than used.
function stripNonProse(s) {
  return String(s)
    // complete fenced blocks (/m is correct here: `$` anchors the CLOSING fence
    // to its own line end)
    .replace(/^[ \t]*```[^\n]*\n[\s\S]*?\n[ \t]*```[ \t]*$/gm, '')
    // whatever fence is left is unterminated, so drop it and everything after.
    // Deliberately no /m — here `$` must mean the true end of the text.
    .replace(/(^|\n)[ \t]*```[\s\S]*$/, '$1')
    // markdown table rows
    .replace(/^[ \t]*\|.*$/gm, '');
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((b) => b && b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
  }
  return '';
}

// Strip any injected <system-reminder>...</system-reminder> blocks so the
// logged "original" is just what the human actually typed.
function stripReminders(s) {
  return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '').trim();
}

function truncateField(s, max) {
  s = String(s);
  return s.length > max ? s.slice(0, max) + '\n…[truncated ' + (s.length - max) + ' chars]' : s;
}

(function main() {
  try {
    // ENHANCER_LOG=0 turns off all local logging (this hook and the injection
    // diagnostics in prompt-enhancer.js). The log never leaves the machine, but
    // it does contain your prompts, so it has to be switchable.
    if (process.env.ENHANCER_LOG === '0') return process.exit(0);
    const raw = readStdin();
    let hook;
    try { hook = JSON.parse(raw); } catch { return process.exit(0); }

    const transcriptPath = hook && hook.transcript_path;
    if (!transcriptPath || !fs.existsSync(transcriptPath)) return process.exit(0);

    const lines = fs.readFileSync(transcriptPath, 'utf8').split(/\r?\n/).filter(Boolean);

    // Walk backwards to find the last *real* user turn (a plain user prompt,
    // not a tool_result payload), then collect assistant text after it.
    let lastUserText = '';
    let userIdx = -1;
    for (let i = lines.length - 1; i >= 0; i--) {
      let rec;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      if (rec.type !== 'user' || !rec.message) continue;
      const content = rec.message.content;
      // Skip tool_result-only messages (array of objects with tool_use_id).
      if (Array.isArray(content) && content.every((b) => b && b.tool_use_id)) continue;
      const t = textOf(content);
      if (!t.trim()) continue;
      lastUserText = t;
      userIdx = i;
      break;
    }
    if (userIdx === -1) return process.exit(0);

    let assistantText = '';
    for (let i = userIdx + 1; i < lines.length; i++) {
      let rec;
      try { rec = JSON.parse(lines[i]); } catch { continue; }
      if (rec.type !== 'assistant' || !rec.message) continue;
      assistantText += textOf(rec.message.content) + '\n';
    }

    const m = stripNonProse(assistantText).match(REFINED_RE);
    if (!m) return process.exit(0); // trivial/confirmation turn — nothing to log

    const original = truncateField(stripReminders(lastUserText), 2000);
    // A wrapped restatement is one logical line — collapse it so the corpus
    // stays greppable line-by-line.
    const refined = truncateField(m[1].trim().replace(/\s*\n\s*/g, ' '), 2000);
    if (!original || !refined) return process.exit(0);

    const ts = new Date().toISOString();
    const entry =
      '----- REFINED (Stop hook) ' + ts + ' -----\n' +
      'ORIGINAL:\n' + original + '\n\n' +
      'REFINED:\n' + refined + '\n\n';
    fs.appendFileSync(LOGFILE, entry, 'utf8');
  } catch {
    /* fail-open */
  } finally {
    process.exit(0);
  }
})();
