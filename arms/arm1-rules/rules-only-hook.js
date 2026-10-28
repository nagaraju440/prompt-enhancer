#!/usr/bin/env node
/*
 * Arm 1 hook — STATIC RULES ONLY.
 *
 * This is the control that answers the obvious objection: "isn't your enhancer
 * just a CLAUDE.md with extra steps?" It injects the same standing-rules file
 * the full enhancer injects, and nothing else — no intent detection, no role,
 * no quality bar, no knowledge-base retrieval.
 *
 * If Arm 2 does not beat Arm 1, the dynamic layers are not earning their
 * complexity and that is the finding.
 *
 * Reads PE_ROOT/.claude/session-guardrail.txt. Always exits 0.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = process.env.PE_ROOT
  ? path.resolve(process.env.PE_ROOT)
  : path.resolve(__dirname, '..');

try {
  const file = path.join(ROOT, '.claude', 'session-guardrail.txt');
  const body = fs.readFileSync(file, 'utf8').trimEnd();
  if (body) {
    process.stdout.write(
      '<standing_rules authority="always in force this session; supersede habit, ' +
      'not my explicit instruction">\n' + body + '\n</standing_rules>\n'
    );
  }
} catch {
  /* fail-open, exactly like the real hook */
}
process.exit(0);
