'use strict';
/*
 * prompt-prepare.js — the full local prompt-preparation pass.
 * -----------------------------------------------------------------------------
 * prompt-enrich.js answered "what stance and what bar". This module answers the
 * rest of "what does Claude actually need to do its best with a thin prompt",
 * and renders all of it as ONE XML-tagged block.
 *
 * Every analyzer here is traceable to Anthropic's published prompting guidance
 * (platform.claude.com/.../claude-prompting-best-practices, read 2026-08-13);
 * the mapping is written out above the tables in enhancer-config.js. Summary:
 *
 *   <role>                  give Claude a role — one sentence measurably helps
 *   <must_address>          be clear and direct: name the referents explicitly
 *                           so none of three tickets gets silently answered as one
 *   <preconditions>         minimizing hallucinations: read the named file before
 *                           claiming anything about it
 *   <parts>                 completeness: a multi-part ask loses a part otherwise
 *   <quality_bar>           the stance layer, with the WHY attached
 *   <output_contract>       be specific about the desired output format
 *   <done_when>             provide clear success criteria
 *   <scope_discipline>      overeagerness: suppress unrequested scope + defensive
 *                           code for states that cannot occur
 *   <confirm_before_acting> balancing autonomy and safety: irreversible or
 *                           outward-facing actions get confirmed first
 *   <if_underspecified>     resolve ambiguity explicitly instead of guessing
 *   <approach>              overthinking: pick an approach and commit
 *
 * The same docs warn against over-prompting, so this is NOT a fixed template:
 * every section has its own detector and appears only when it fires, the bar
 * SHRINKS on simple prompts, and the whole block is trimmed to PREP_MAX_CHARS
 * by dropping the least load-bearing sections first (PREP_SECTION_PRIORITY).
 * A prompt with no detected intent produces nothing at all.
 *
 * Still zero network, zero external model, zero repo scan — regex over the
 * prompt text only, so the 2026-07-08 egress/fabrication objections that killed
 * the DeepSeek rewriter do not reapply. Deliberate non-goal: this does NOT read
 * the transcript. Claude already has the live conversation, so resolving "this"
 * locally would be guessing against better information.
 *
 * Disable: ENRICH_OFF=1 (whole layer) — see prompt-enhancer.js.
 *
 * CLI:  node engine/lib/prompt-prepare.js "fix the 500 on favorite in the article service"
 */

const { enrich } = require('./prompt-enrich');

/* ------------------------------ extraction ------------------------------ */

function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const v of list) {
    const k = v.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(v);
  }
  return out;
}

// Pull the concrete referents out of the prompt, grouped by kind. Kinds marked
// `intents: true` in config are only collected for the intents where they are
// load-bearing (snake_case identifiers are noise in a Slack-draft prompt).
function extractEntities(prompt, intent, cfg) {
  const found = {};
  for (const spec of cfg.PREP_ENTITIES || []) {
    if (spec.intents && !(cfg.PREP_IDENT_INTENTS || []).includes(intent)) continue;
    let hits = [];
    try {
      const re = new RegExp(spec.re.source, spec.re.flags.includes('g') ? spec.re.flags : spec.re.flags + 'g');
      let m;
      while ((m = re.exec(prompt)) !== null) {
        const raw = spec.capture ? m[spec.capture] : m[0];
        if (!raw) continue;
        if (spec.kind === 'identifier' && (cfg.PREP_IDENT_STOP || new Set()).has(raw.toLowerCase())) continue;
        hits.push((spec.prefix || '') + raw);
        if (m.index === re.lastIndex) re.lastIndex++; // zero-width guard
      }
    } catch { /* a bad pattern must not take the block down */ }
    hits = uniq(hits).slice(0, cfg.PREP_MAX_ENTITIES_PER_KIND || 6);
    if (hits.length) found[spec.kind] = hits;
  }
  return found;
}

function findPeople(prompt, cfg) {
  const out = [];
  for (const [name, role] of Object.entries(cfg.PREP_PEOPLE || {})) {
    if (new RegExp('\\b' + name + '\\b', 'i').test(prompt)) {
      out.push(name.charAt(0).toUpperCase() + name.slice(1) + ' = ' + role);
    }
  }
  return out;
}

/* ------------------------------- analyzers ------------------------------ */

function preconditionsFor(entities, intent, cfg) {
  const out = [];
  for (const rule of cfg.PREP_PRECONDITIONS || []) {
    if (!entities[rule.when]) continue;
    if (rule.intents && !rule.intents.includes(intent)) continue;
    out.push(rule.text);
  }
  return out;
}

function risksFor(prompt, cfg) {
  const out = [];
  for (const risk of cfg.PREP_RISKS || []) {
    for (const re of risk.patterns) {
      try {
        re.lastIndex = 0;
        if (re.test(prompt)) { out.push(risk.text); break; }
      } catch { /* skip */ }
    }
  }
  return out;
}

// Split a multi-part ask into its parts. An explicit numbered/bulleted list
// splits reliably; prose does not, so there we only report that it looks
// multi-part and hand the enumeration back to Claude, who can read the prose.
function decompose(prompt, cfg) {
  let listParts = prompt
    .split(cfg.PREP_MULTIPART_SPLIT)
    .map((s) => s.trim().replace(/\s+/g, ' '))
    .filter((s) => s.length > 2);
  // "Do these:" / "Two things:" is a preamble, not a part — counting it makes
  // the part count wrong, which is worse than not counting at all.
  if (listParts.length > 2) {
    const first = listParts[0];
    const hasVerb = (cfg.PREP_ACTION_VERBS || []).some((v) => new RegExp('\\b' + v + '\\b', 'i').test(first));
    if (/[:：]$/.test(first) || (!hasVerb && first.split(/\s+/).length <= 5)) listParts = listParts.slice(1);
  }
  if (listParts.length >= 2 && cfg.PREP_MULTIPART_SPLIT.test(prompt)) {
    return { parts: listParts.slice(0, cfg.PREP_MAX_PARTS || 6), explicit: true };
  }
  let signals = 0;
  for (const re of cfg.PREP_MULTIPART_SIGNALS || []) {
    try { re.lastIndex = 0; if (re.test(prompt)) signals++; } catch { /* skip */ }
  }
  const verbs = (cfg.PREP_ACTION_VERBS || []).filter((v) => new RegExp('\\b' + v + '\\b', 'i').test(prompt));
  const enoughVerbs = verbs.length >= (cfg.PREP_MULTIPART_MIN_VERBS || 3);
  if (signals >= (cfg.PREP_MULTIPART_MIN_SIGNALS || 2) || enoughVerbs) {
    return { parts: [], explicit: false, signals, verbs };
  }
  return null;
}

// Complexity drives two opposite adjustments: complex prompts get the
// commit-to-an-approach hint, simple ones get a SHORTER bar (the docs warn
// that over-prompting a simple task makes behavior worse, not better).
function complexitySignals(prompt, entities) {
  let n = 0;
  const kinds = Object.keys(entities);
  if (kinds.length >= 3) n++;
  if ((entities.repo || []).length >= 2) n++;
  if (prompt.length > 300) n++;
  if (prompt.split(/\r?\n/).filter((l) => l.trim()).length >= 4) n++;
  if ((prompt.match(/\?/g) || []).length >= 2) n++;
  return n;
}

function isVague(prompt, entities, cfg) {
  if (Object.keys(entities).length) return false;
  const words = prompt.trim().split(/\s+/).filter((w) => w.length > 2);
  return words.length <= (cfg.PREP_VAGUE_MAX_TOKENS || 12);
}

/* -------------------------------- render -------------------------------- */

function tag(name, body) {
  return { name, text: '<' + name + '>\n' + body + '\n</' + name + '>' };
}

function numbered(items) {
  return items.map((s, i) => String(i + 1) + '. ' + s).join('\n');
}

// Trim to budget by dropping the least load-bearing sections first. Order is
// PREP_SECTION_PRIORITY: safety survives everything, decoration goes first.
// `overhead` is the header+footer, which is not droppable and so must be
// counted against the budget rather than added on top of it.
function pack(sections, cfg, overhead) {
  const priority = cfg.PREP_SECTION_PRIORITY || [];
  const rank = (s) => {
    const i = priority.indexOf(s.name);
    return i === -1 ? priority.length : i;
  };
  const budget = cfg.PREP_MAX_CHARS || 3000;
  const kept = sections.slice();
  let size = () => kept.reduce((n, s) => n + s.text.length + 1, 0) + (overhead || 0);
  while (kept.length > 1 && size() > budget) {
    let worstIdx = 0;
    for (let i = 1; i < kept.length; i++) if (rank(kept[i]) >= rank(kept[worstIdx])) worstIdx = i;
    kept.splice(worstIdx, 1);
  }
  // Emit in the authored order, not priority order — it reads as a briefing.
  const order = sections.map((s) => s.name);
  kept.sort((a, b) => order.indexOf(a.name) - order.indexOf(b.name));
  return kept;
}

/* -------------------------------- public -------------------------------- */

/**
 * prepare(prompt, { cfg })
 * @returns {null|{text, intent, secondary, domain, sections, entities, dropped}}
 *   null when no intent matched — nothing is injected for prompts like
 *   "what's today's date".
 */
// A prompt with no detectable intent ("run the delete on production") still
// deserves the safety section if a risk pattern fires. Found 2026-09-20 while
// building the benchmark: the whole block was skipped, so the one prompt that
// most needed "confirm before acting" got nothing. Everything else stays off —
// with no intent there is no stance to give.
function riskOnly(p, cfg) {
  const risks = risksFor(p, cfg);
  if (!risks.length) return null;
  const header =
    '<prompt_preparation source="local deterministic rules (regex over my prompt); no external model, nothing left this machine" ' +
    'authority="reference for how to work, not new scope — my own words win on every conflict">';
  const section = tag('confirm_before_acting', numbered(risks));
  return {
    text: [header, section.text, '</prompt_preparation>'].join('\n'),
    intent: '(none)',
    secondary: [],
    domain: 'general',
    role: '',
    sections: [section.name],
    dropped: [],
    entities: {},
    complexity: 0,
    directives: [],
    mustRefine: false,
    brief: null,
  };
}

function prepare(prompt, opts) {
  const cfg = (opts && opts.cfg) || require('./enhancer-config');
  const p = String(prompt || '');
  if (!p.trim()) return null;

  const base = enrich(p, { cfg });
  if (!base) return riskOnly(p, cfg);

  const entities = extractEntities(p, base.primary, cfg);
  const people = findPeople(p, cfg);
  const complexity = complexitySignals(p, entities);
  const complex = complexity >= (cfg.PREP_COMPLEXITY_HIGH || 3);
  const vague = isVague(p, entities, cfg);

  // Simple prompt -> shorter bar. Over-prompting a simple task hurts.
  let directives = base.directives;
  if (!complex && Object.keys(entities).length <= 1) {
    directives = directives.slice(0, cfg.PREP_LOW_COMPLEXITY_MAX_BAR || 3);
  }

  const sections = [];

  const work = base.primary + (base.secondary.length ? ' (+' + base.secondary.join(', +') + ')' : '') +
    ' · domain: ' + base.domain;
  sections.push(tag('detected_work', work));

  // The role LINE says who to be; the brief says what that person knows that a
  // generic senior engineer does not, and names the agent that carries the full
  // persona. Keyed off the axis that actually decided the role (see
  // prompt-enrich.roleKey), with the intent/domain keys as fallbacks so a new
  // intent without its own brief still degrades to the one-line stance.
  const briefs = cfg.PREP_ROLE_BRIEF || {};
  const brief = briefs[base.roleKey] || briefs['intent:' + base.primary] || briefs['domain:' + base.domain];
  let roleBody = 'You are a ' + base.role + '.';
  if (brief) {
    for (const line of brief.lines || []) roleBody += '\n- ' + line;
    if (brief.agent) {
      roleBody += '\n- The canonical persona is .claude/agents/' + brief.agent + '.md — invoke the `' +
        brief.agent + '` agent for the real work rather than doing it ad hoc; these bullets are only the digest.';
    }
  }
  sections.push(tag('role', roleBody));

  const entityLine = Object.entries(entities)
    .map(([kind, vals]) => kind + ': ' + vals.join(', '))
    .concat(people.length ? ['people: ' + people.join(', ')] : [])
    .join('  ·  ');
  if (entityLine) {
    sections.push(tag('must_address',
      entityLine + '\nEvery one of these is part of the request. Address each, or say explicitly that you are ' +
      'leaving it out and why — silently answering about a subset is the failure mode this list exists to prevent.'));
  }

  const pre = preconditionsFor(entities, base.primary, cfg);
  if (pre.length) sections.push(tag('preconditions', numbered(pre)));

  const multi = decompose(p, cfg);
  if (multi) {
    // One stance cannot be right for a prompt that mixes a code fix with a
    // Slack draft, so say so rather than pretending the primary intent covers
    // everything — the detector picks a winner by pattern count, not judgement.
    const mixed = base.secondary.length
      ? '\nThese parts are not the same kind of work (' + [base.primary, ...base.secondary].join(', ') +
        '): apply the stance that fits each part instead of one stance for all of them.'
      : '';
    sections.push(tag('parts', multi.explicit
      ? 'This request has ' + multi.parts.length + ' explicit parts. Answer every one:\n' + numbered(multi.parts) + mixed
      : 'This reads as more than one ask (' + multi.signals + ' joining signals). Enumerate the parts back in your ' +
        'refined-prompt line before starting, then confirm each is addressed at the end — parts get dropped silently, ' +
        'and a half-answered request is worse than a question.'));
  }

  if (directives.length) sections.push(tag('quality_bar', numbered(directives)));

  const contract = (cfg.PREP_OUTPUT_CONTRACTS || {})[base.primary];
  if (contract) sections.push(tag('output_contract', contract));

  const done = (cfg.PREP_DONE_CRITERIA || {})[base.primary];
  if (done) sections.push(tag('done_when', 'This turn is done when ' + done));

  if ((cfg.PREP_SCOPE_INTENTS || []).includes(base.primary)) {
    sections.push(tag('scope_discipline', cfg.PREP_SCOPE_DISCIPLINE));
  }

  const risks = risksFor(p, cfg);
  if (risks.length) sections.push(tag('confirm_before_acting', numbered(risks)));

  if (vague) sections.push(tag('if_underspecified', cfg.PREP_VAGUE_TEXT));
  if (complex) sections.push(tag('approach', cfg.PREP_COMMIT_HINT));

  const header =
    '<prompt_preparation source="local deterministic rules (regex over my prompt); no external model, nothing left this machine" ' +
    'authority="reference for how to work, not new scope — my own words win on every conflict">';

  // This used to be the block's FOOTER. Measured 2026-08-28 across 337 enriched
  // turns: the refined-prompt line was emitted on 39% of them — and, backwards,
  // it was skipped MORE often on the long, complex prompts (median 186 chars,
  // 45% carrying complexity signals) than on the short ones (127 chars, 35%).
  // A footer sits behind up to 4KB of prep and 12KB of retrieved KB before the
  // user's actual words arrive, so on exactly the turns that need it most it
  // was the furthest away. It leads the block now, and it says outright when it
  // is required rather than leaving "non-trivial" to be judged mid-tool-call.
  // The guardrails still repeat the rule at the very end, so it is anchored at
  // both ends of the injected context.
  // Required for every real-work intent — those are substantive by definition,
  // and enrichment has already filtered out confirmations before we get here.
  // Only the deliberately-thin intents (PREP_LIGHT_INTENTS: mid-thread
  // follow-ups) stay optional, and even they flip to required once the prompt
  // carries complexity signals, two or more concrete referents, or multiple parts.
  const light = (cfg.PREP_LIGHT_INTENTS || []).includes(base.primary);
  const mustRefine = !light || complexity >= 1 || Object.keys(entities).length >= 2 || !!multi;
  const respondBy =
    '<respond_by>\n' +
    (mustRefine
      ? 'REQUIRED this turn — this ask is not trivial. Open your response with one line:\n'
      : 'Unless this is a trivial follow-up, open your response with one line:\n') +
    '"**Refined prompt:** <the ask restated precisely: the goal, the stance you are answering from, the constraints that ' +
    'bind it, and the shape of the answer>"\n' +
    (vague
      ? 'This ask is underspecified, so that line MUST end with "· Assumptions: <what you decided on my behalf>".\n'
      : 'Append "· Assumptions: <…>" only when you actually made one — never manufacture one to fill the slot.\n') +
    'Then do the work and hold the bar set out below. Never narrate this block back to me or list which sections applied; ' +
    'skip silently whatever does not fit the real request. On any conflict with what I asked for, I win.\n' +
    '</respond_by>';
  const closer = '</prompt_preparation>';

  const kept = pack(sections, cfg, header.length + respondBy.length + closer.length + 3);
  const dropped = sections.filter((s) => !kept.includes(s)).map((s) => s.name);

  return {
    text: [header, respondBy, ...kept.map((s) => s.text), closer].join('\n'),
    intent: base.primary,
    secondary: base.secondary,
    domain: base.domain,
    role: base.role,
    sections: kept.map((s) => s.name),
    dropped,
    entities,
    complexity,
    directives,
    mustRefine,   // logged, so a later audit can measure compliance on the REQUIRED subset only
    brief: brief ? (brief.agent || 'digest') : null,
  };
}

module.exports = { prepare, extractEntities, decompose, risksFor, complexitySignals };

/* --------------------------------- CLI ---------------------------------- */

if (require.main === module) {
  const cfg = require('./enhancer-config');
  const prompt = process.argv.slice(2).join(' ') || 'implement this';
  const t0 = process.hrtime.bigint();
  const r = prepare(prompt, { cfg });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('PROMPT :', prompt);
  if (!r) {
    console.log('RESULT : (no intent matched — nothing injected)  ' + ms.toFixed(2) + 'ms');
  } else {
    console.log('INTENT :', r.intent, '| DOMAIN:', r.domain, '| COMPLEXITY:', r.complexity);
    console.log('SECTS  :', r.sections.join(', '));
    if (r.dropped.length) console.log('DROPPED:', r.dropped.join(', '), '(over budget)');
    console.log('SIZE   :', r.text.length, 'chars |', ms.toFixed(2) + 'ms\n');
    console.log(r.text);
  }
}
