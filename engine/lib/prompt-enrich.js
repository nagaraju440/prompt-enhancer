'use strict';
/*
 * prompt-enrich.js — deterministic, local prompt ENRICHMENT.
 * -----------------------------------------------------------------------------
 * The second layer of the UserPromptSubmit hook, and a different job from
 * kb-retrieval.js:
 *
 *   kb-retrieval.js  answers "what FACTS does this prompt need"  -> grounding
 *   prompt-enrich.js answers "what STANCE and what BAR does it need" -> quality
 *
 * "implement this" carries no KB anchor at all, so retrieval correctly skips
 * it — yet it is exactly the prompt that most needs "...as a senior backend
 * engineer, with the non-happy paths enumerated and the test cases named".
 * That gap is what this module fills.
 *
 * Pure regex over the prompt text: no network, no external model, no repo scan
 * (see decisions.md 2026-07-08 for why a stateless external rewriter was
 * removed — nothing here reintroduces one). Everything is table-driven from
 * enhancer-config.js: ENRICH_INTENTS, ENRICH_ROLE_BY_DOMAIN, ENRICH_MAX_*.
 *
 * The emitted block is a STANCE, never new scope. The render footer says so
 * explicitly, because the standing rule is that the requested scope is the
 * deliverable — a directive bullet must never be read as licence to widen it.
 *
 * Disable temporarily: set ENRICH_OFF=1 in the environment.
 *
 * CLI:  node .claude/lib/prompt-enrich.js "implement this"
 */

// classify() is pure (regex over CLASSIFIERS, no IO) and its CLI is guarded,
// so requiring it here is free. Wrapped anyway: enrichment must never be the
// reason a prompt fails.
let classify = null;
try { ({ classify } = require('./kb-retrieval')); } catch { /* domain -> fallback */ }

/* ------------------------------- scoring -------------------------------- */

// Score every intent by how many of its patterns hit. Highest wins the
// primary stance; ties break by config array order (specific listed first).
function scoreIntents(prompt, cfg) {
  const hits = [];
  const intents = cfg.ENRICH_INTENTS || [];
  for (let i = 0; i < intents.length; i++) {
    const intent = intents[i];
    let score = 0;
    for (const re of intent.patterns || []) {
      try {
        re.lastIndex = 0; // defensive: a /g pattern in config would be stateful
        if (re.test(prompt)) score++;
      } catch { /* skip a bad pattern, keep the rest */ }
    }
    if (score > 0) hits.push({ intent, score, idx: i });
  }
  hits.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));
  return hits;
}

function resolveDomain(prompt, cfg) {
  if (!classify) return cfg.DEFAULT_CLASS ? cfg.DEFAULT_CLASS.type : 'general';
  try { return classify(prompt, cfg).type; } catch { return 'general'; }
}

// An intent marked roleFromDomain phrases itself from the domain axis, so
// "implement an endpoint in the API" and "implement this frontend page"
// get different stances from one intent entry. Its own `role` is the fallback
// for domains with no mapping.
function resolveRole(primary, domain, cfg) {
  const byDomain = cfg.ENRICH_ROLE_BY_DOMAIN || {};
  if (primary.roleFromDomain && byDomain[domain]) return byDomain[domain];
  if (primary.role) return primary.role;
  return byDomain[domain] || cfg.ENRICH_ROLE_FALLBACK || 'senior engineer';
}

// Which axis actually decided the role — 'domain:<class>' or 'intent:<type>'.
// prompt-prepare.js keys PREP_ROLE_BRIEF off this, so the persona brief always
// matches the sentence above it: "implement in the frontend" gets the frontend brief,
// while "design the delta" gets the architect brief regardless of domain.
function roleKey(primary, domain, cfg) {
  const byDomain = cfg.ENRICH_ROLE_BY_DOMAIN || {};
  if (primary.roleFromDomain && byDomain[domain]) return 'domain:' + domain;
  if (primary.role) return 'intent:' + primary.type;
  return byDomain[domain] ? 'domain:' + domain : '';
}

// Flatten one intent's directives, dropping those scoped to other domains.
function directivesFor(intent, domain) {
  const out = [];
  for (const d of intent.directives || []) {
    if (typeof d === 'string') { out.push(d); continue; }
    if (!d || !d.t) continue;
    if (Array.isArray(d.d) && d.d.length && !d.d.includes(domain)) continue;
    out.push(d.t);
  }
  return out;
}

/* -------------------------------- public -------------------------------- */

/**
 * enrich(prompt, { cfg })
 * @returns {null|{primary,secondary,role,roleKey,domain,directives}}
 *   null when no intent matched — the caller then injects nothing, so a
 *   prompt like "what's today's date" stays untouched.
 *
 * Returns STRUCTURE ONLY. This module used to render its own plain-text block
 * too, but prompt-prepare.js has rendered the shipped XML block since
 * 2026-08-13 and never read that string — it was built and discarded on every
 * turn, and worse, it was a second copy of the wording that edits could land
 * in silently. Removed 2026-08-28.
 */
function enrich(prompt, opts) {
  const cfg = (opts && opts.cfg) || require('./enhancer-config');
  const p = String(prompt || '');
  if (!p.trim()) return null;

  const ranked = scoreIntents(p, cfg);
  if (!ranked.length) return null;

  const domain = resolveDomain(p, cfg);
  const primary = ranked[0].intent;
  const secondary = ranked.slice(1, 1 + (cfg.ENRICH_MAX_SECONDARY || 2)).map((r) => r.intent);
  const role = resolveRole(primary, domain, cfg);

  // Primary intent's bullets first, then secondaries fill the remaining
  // budget — so the dominant intent is never crowded out by a weak match.
  const seen = new Set();
  const directives = [];
  const cap = cfg.ENRICH_MAX_DIRECTIVES || 6;
  for (const intent of [primary, ...secondary]) {
    for (const d of directivesFor(intent, domain)) {
      const key = d.slice(0, 60).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      directives.push(d);
      if (directives.length >= cap) break;
    }
    if (directives.length >= cap) break;
  }
  if (!directives.length) return null;

  const secondaryTypes = secondary.map((s) => s.type);
  return {
    primary: primary.type,
    secondary: secondaryTypes,
    role,
    roleKey: roleKey(primary, domain, cfg),
    domain,
    directives,
  };
}

module.exports = { enrich, scoreIntents, resolveRole, roleKey, directivesFor };

/* --------------------------------- CLI ---------------------------------- */

if (require.main === module) {
  const cfg = require('./enhancer-config');
  const prompt = process.argv.slice(2).join(' ') || 'implement this';
  const t0 = process.hrtime.bigint();
  const r = enrich(prompt, { cfg });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('PROMPT :', prompt);
  if (!r) {
    console.log('RESULT : (no intent matched — nothing would be injected)  ' + ms.toFixed(2) + 'ms');
  } else {
    console.log('DOMAIN :', r.domain, '| INTENT:', r.primary, '| SECONDARY:', r.secondary.join(', ') || '(none)');
    console.log('ROLE   :', r.role, '  [key: ' + (r.roleKey || '(none)') + ']');
    console.log('TIMING :', ms.toFixed(2) + 'ms\n');
    r.directives.forEach((d, i) => console.log(String(i + 1) + '. ' + d));
    console.log('\n(structure only — prompt-prepare.js renders the shipped block)');
  }
}
