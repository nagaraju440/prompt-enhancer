'use strict';
/*
 * enhancer-config.js — all tunables for the local-only prompt-context injector.
 * -----------------------------------------------------------------------------
 * GENERIC edition. Nothing in here names a company, a product, a ticket
 * tracker or a colleague. Everything project-specific comes from ONE optional
 * overlay file in the project being served:
 *
 *   <PE_ROOT>/.claude/enhancer.project.json
 *   {
 *     "name":          "RealWorld API",                 // used in role lines
 *     "stack":         "NestJS 7 + TypeORM 0.2 + MySQL", // used in role lines
 *     "ticketPattern": "#\\d+",                          // regex source, optional
 *     "ticketLabel":   "issue",                          // how to call a ticket
 *     "repos":         ["api", "web"],                   // repo names that anchor a prompt
 *     "people":        { "alice": "reviewer" }           // who is who, for comms
 *   }
 *
 * The overlay only fills placeholders and anchors; it never adds directives.
 * That keeps the engine's behaviour identical across projects, which is what
 * makes a benchmark on one project say something about another.
 *
 * No external LLM call happens anywhere in this pipeline. All of this feeds a
 * deterministic local BM25 retrieval + regex intent detection whose output is
 * injected as reference material; Claude (which already has the live
 * conversation) does the actual reasoning.
 */
const fs = require('fs');
const path = require('path');

/* ----------------------------- project overlay ----------------------------- */

function loadProject() {
  // Same precedence as prompt-enhancer.js: explicit override, then the dir
  // Claude Code hands every hook, then the engine's own parent.
  const env = process.env.PE_ROOT || process.env.CLAUDE_PROJECT_DIR || '';
  const root = env.trim() ? path.resolve(env.trim()) : path.resolve(__dirname, '..', '..');
  const defaults = {
    name: 'this codebase',
    stack: '',
    ticketPattern: '\\b[A-Z][A-Z0-9]+-\\d+\\b',
    ticketLabel: 'ticket',
    repos: [],
    people: {},
  };
  try {
    const raw = fs.readFileSync(path.join(root, '.claude', 'enhancer.project.json'), 'utf8');
    const j = JSON.parse(raw);
    return Object.assign(defaults, j);
  } catch {
    return defaults;
  }
}

const PROJECT = loadProject();
const ON = PROJECT.name === 'this codebase' ? 'on this codebase' : 'on ' + PROJECT.name;
const STACK = PROJECT.stack ? ' (' + PROJECT.stack + ')' : '';

function safeRe(src, flags) {
  try { return new RegExp(src, flags); } catch { return null; }
}
const TICKET_RE_G = safeRe(PROJECT.ticketPattern, 'g') || /\b[A-Z][A-Z0-9]+-\d+\b/g;
const TICKET_RE = safeRe(PROJECT.ticketPattern, '') || /\b[A-Z][A-Z0-9]+-\d+\b/;
const REPO_RE_G = PROJECT.repos.length
  ? new RegExp('\\b(?:' + PROJECT.repos.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'gi')
  : null;
const REPO_RE = PROJECT.repos.length
  ? new RegExp('\\b(?:' + PROJECT.repos.map((r) => r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')\\b', 'i')
  : null;

module.exports = {
  PROJECT,
  PROJECT_TICKET_RE: TICKET_RE,
  PROJECT_REPO_RE: REPO_RE,

  // ---- prompt gating ----
  MIN_PROMPT_LEN: 20,       // shorter prompts skip context injection entirely
  MAX_PROMPT_LEN: 4000,     // very long prompts are already self-contained — skip
  MIN_ANCHOR_TOKENS: 6,     // continuation/anaphora gate: fewer non-stopword tokens + no anchor = skip

  // ---- diagnostics log ----
  LOG_FIELD_MAX_CHARS: 2000,
  LOG_ROTATE_BYTES: 1000000,

  // ---- retrieval budget ----
  MAX_CONTEXT_CHARS: 12000,
  MAX_FILES: 6,
  MIN_SCORE: 1.0,
  MAX_SECTION_CHARS: 3000,
  MIN_BUDGET_TAIL: 200,
  PINNED_MAX_SECTIONS: 2,
  MAX_FILE_BYTES: 300000,

  // ---- BM25 parameters (Lucene defaults) ----
  BM25_K1: 1.5,
  BM25_B: 0.75,

  // ---- additive boosts ----
  BOOST_CURRENT_FOCUS: 4.0,
  BOOST_LESSONS: 2.0,
  BOOST_REPO_MATCH: 3.0,
  BOOST_PURPOSE_MATCH: 2.5,
  BOOST_HEADING_MATCH: 1.5,
  BOOST_FILENAME_MATCH: 1.0,

  // ---- per-file priority multiplier ----
  DEFAULT_PRIORITY: 1.0,
  REPO_PRIORITY: 1.15,
  FILE_PRIORITY: {
    'CURRENT_FOCUS.md': 1.3,
    'LESSONS.md': 1.25,
    '.claude/knowledge/workspace.md': 1.1,
    '.claude/knowledge/decisions.md': 1.1,
    '.claude/knowledge/INDEX.md': 0.8,
  },

  // ---- discovery ----
  ROOT_FILES: ['CURRENT_FOCUS.md', 'LESSONS.md'],
  KB_DIR: '.claude/knowledge',
  REPOS_SUBDIR: 'repos',
  PINNED_FILES: ['CURRENT_FOCUS.md'],

  // ---- tokenization ----
  MIN_TOKEN_LEN: 2,
  TOKEN_RE: /[a-z0-9][a-z0-9._-]*[a-z0-9]|[a-z0-9]/g,
  STOP_WORDS: new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'for', 'of', 'to',
    'in', 'on', 'at', 'by', 'is', 'are', 'be', 'was', 'were', 'been', 'with', 'as',
    'it', 'this', 'that', 'these', 'those', 'i', 'we', 'you', 'they', 'my', 'our',
    'your', 'me', 'us', 'do', 'does', 'did', 'can', 'could', 'should', 'would',
    'will', 'shall', 'may', 'might', 'need', 'want', 'how', 'what', 'why', 'where',
    'when', 'which', 'who', 'from', 'into', 'about', 'over', 'under', 'via', 'use',
    'using', 'used', 'get', 'add', 'also', 'not', 'no', 'yes', 'please', 'let',
  ]),

  // ---- deterministic keyword classifier (domain axis) ----
  // First-highest-scoring type wins; ties broken by array order. `hint` is a
  // short routing line injected alongside the retrieved context.
  CLASSIFIERS: [
    { type: 'pr-review', hint: 'A code review: read the diff before the description, build the coverage matrix, then findings.',
      patterns: [/\breview\b[^.]*\b(pr|diff|change|patch)\b|\b(pr|diff|patch)\b[^.]*\breview\b/i, /\bpr\s*#?\d+/i, /pull[- ]request/i, /code review/i, /review this/i] },
    { type: 'database', hint: 'Data / schema question: answer from the entities and the real data shape, and show the query.',
      patterns: [/\bdatabase\b/i, /\bschema\b/i, /\btable\b/i, /\bquery\b/i, /\bselect\b/i, /\bcolumn\b/i, /\bentity\b/i, /\bmigration\b/i, /\bstored\b/i] },
    { type: 'security', hint: 'Auth / permission question: trace the enforcement point and assume the caller is hostile.',
      patterns: [/\bauth(z|entication|orization)?\b/i, /\bpermission/i, /\btokens?\b/i, /\bjwt\b/i, /\blogin\b/i, /\blogged[- ]in\b/i, /\bpassword/i, /\bowner(ship)?\b/i, /\bwithout logging in\b/i] },
    { type: 'backend', hint: 'Backend change: mirror the nearest sibling module; controller → service → repository/entity; keep the response envelope.',
      patterns: [/\bendpoint\b/i, /\bcontroller\b/i, /\bservice\b/i, /\bdto\b/i, /\brepository\b/i, /\bmodule\b/i, /\broute\b/i, /\bapi\b/i, /\bmiddleware\b/i] },
    { type: 'frontend', hint: 'Frontend change: follow the existing component conventions; check every consumer of a changed contract.',
      patterns: [/\bcomponent\b/i, /\bpage\b/i, /\bfrontend\b/i, /\breact\b/i, /\bui\b/i, /\bbrowser\b/i] },
    { type: 'architecture', hint: 'Design: the delta against what exists, invariants first, no implementation code.',
      patterns: [/\bdesign\b/i, /architecture/i, /\bapproach\b/i, /\bscope\b/i, /\bplan\b/i] },
  ],
  DEFAULT_CLASS: { type: 'general', hint: 'Load only the knowledge-base sections relevant to the request.' },

  /* =======================================================================
   * PROMPT ENRICHMENT — the stance + quality bar implied by the work type.
   * Pure regex over the prompt. Never adds scope.
   * ===================================================================== */

  ENRICH_MIN_PROMPT_LEN: 8,
  ENRICH_MAX_PROMPT_LEN: 6000,
  ENRICH_MAX_DIRECTIVES: 6,
  ENRICH_MAX_SECONDARY: 2,

  ENRICH_ROLE_BY_DOMAIN: {
    backend: 'senior backend engineer ' + ON + STACK,
    frontend: 'senior frontend engineer ' + ON,
    database: 'data-model engineer ' + ON + ' — answers from the entities and the real data shape',
    security: 'security-minded senior engineer ' + ON,
    'pr-review': 'staff-level code reviewer ' + ON,
    architecture: 'solutioning architect ' + ON,
    general: 'senior engineer ' + ON,
  },
  ENRICH_ROLE_FALLBACK: 'senior engineer ' + ON,

  // Highest hit-count wins the primary stance; ties break by array order, so
  // specific intents are listed before generic ones. `explain` MUST stay last.
  ENRICH_INTENTS: [
    {
      type: 'review',
      role: 'staff-level code reviewer ' + ON,
      patterns: [/\breview\b/i, /code[- ]review/i, /\bflag\b.*\bbugs?\b/i, /check\s+(the\s+)?standards/i, /go through this (pr|diff|change|patch)/i, /\bcritique\b/i, /\bsanity[- ]check\b/i, /anything wrong with/i],
      directives: [
        'Run the full checklist even when the ask sounds narrow ("just flag bugs") — correctness, the project\'s documented conventions, impact on every consumer, design integrity.',
        'Review the CHANGE, not the description\'s claims: what the diff does NOT touch but should is where the expensive defects are.',
        'Two layers, both mandatory: local correctness (does it break) AND design integrity (invariants, cross-consumer impact, evolvability).',
        'No finding without a concrete runtime consequence — inputs/state → wrong output. If you cannot produce the failure scenario, it is not a finding.',
        'Rank findings by severity and say which parts of the change are fine and should ship.',
      ],
    },
    {
      type: 'qa',
      role: 'QA analyst ' + ON,
      patterns: [/\bqa\b/i, /test plan/i, /\btest cases?\b/i, /verification/i, /how (do|would) (i|we) (test|verify)/i, /regression/i, /\bedge cases?\b/i],
      directives: [
        'Produce an edge-case catalog, not a happy-path script.',
        'Each case: preconditions → steps → expected result → what a failure looks like on screen or in the log.',
        'Derive the cases from the code paths that actually exist — every branch, every early return, every unguarded lookup — and say which cases cannot be reached.',
      ],
    },
    {
      type: 'requirements',
      role: 'requirements analyst scoping work ' + ON,
      patterns: [/\bscope\b/i, /break (it |this )?down/i, /what'?s needed/i, /\bbreakdown\b/i, /\bestimate\b/i, /acceptance criteria/i, /\bsub-?tasks?\b/i, /what (do|would) (we|i) need/i],
      directives: [
        'Scope against what was actually asked — never against an assumed requirement.',
        'Break it into tasks small enough to implement without another scoping conversation, each naming the file or module it lands in.',
        'Separate in-scope from explicitly out-of-scope: the second list is what stops the work growing later.',
        'Every unknown is a numbered open question with an owner, never a filled-in assumption.',
      ],
    },
    {
      type: 'design',
      role: 'solutioning architect ' + ON,
      patterns: [/\bdesign\b/i, /\barchitect/i, /\bapproach\b/i, /\btrade[- ]?offs?\b/i, /\boptions?\b.*\b(pick|choose|recommend)\b/i, /\bspec\b/i, /technical document/i, /how should (we|i) (build|structure|model|add)/i],
      directives: [
        'Design the DELTA against what exists, not a rebuild; state the invariants the change must preserve.',
        'Every decision carries its rejected alternative and why it lost.',
        'No assumptions: unknowns become numbered open questions, each with who can answer it.',
        'Impact analysis is part of the design — every consumer, every read path, every stored value that now has a new meaning.',
        'Include rollout + rollback. No implementation code in this pass.',
      ],
    },
    {
      type: 'docs',
      role: 'engineer writing a build-ready specification',
      patterns: [/\bdocument(ation)?\b/i, /\bwrite up\b/i, /\breadme\b/i, /\bwrite (a|the) doc/i],
      directives: [
        'Build-ready standard: a developer implements it without making a single design decision.',
        'Every factual claim is traceable to code (file:line) or is explicitly an open question.',
        'Name the insertion points — file, function, and what goes there — not just the intent.',
      ],
    },
    {
      type: 'investigate',
      role: 'senior engineer doing code archaeology ' + ON,
      patterns: [/\bwhy\b/i, /root cause/i, /\bwhere is\b/i, /\bwhere does\b/i, /how does\b/i, /\btrace\b/i, /\bexplain\b/i, /\bfind out\b/i, /which file/i, /what happens (when|if)/i, /\binvestigate\b/i, /\bunderstand\b/i, /what'?s going on/i, /\bis (it|that) possible\b/i],
      directives: [
        'Cite file:line with the verbatim snippet for every claim — paraphrase is not evidence.',
        'Follow the real call path end to end before concluding; do not stop at the first plausible match.',
        'Separate verified from inferred, and say plainly which files you did not read.',
        'Prefer the project knowledge base over re-scanning the repo; if the KB lacks the detail, say which knowledge file should carry it.',
      ],
    },
    {
      type: 'bugfix',
      roleFromDomain: true,
      role: 'senior engineer debugging code that is already in production',
      patterns: [/\bfix\b/i, /\bbugs?\b/i, /\bbroken\b/i, /not working/i, /\bfail(s|ing|ed)?\b/i, /\berrors?\b/i, /\bcrash/i, /\b(4\d\d|5\d\d)\b/, /\bwrong\b/i, /\bincorrect\b/i, /\bmismatch\b/i, /\bregression\b/i, /doesn'?t work/i, /can'?t (log ?in|sign ?in)/i, /\balways\b.*\b(empty|wrong|missing)\b/i, /\bundefined\b/i],
      directives: [
        'Locate the exact failing line and quote it as file:line before proposing anything.',
        'Name the ROOT CAUSE, not the symptom — and say why it surfaces now.',
        'Fix it at its single source; do not patch each call site.',
        'State the blast radius: everything else that reaches this code path, and whether existing data is already wrong.',
      ],
    },
    {
      type: 'refactor',
      roleFromDomain: true,
      role: 'senior engineer improving code without changing behavior',
      patterns: [/\brefactor/i, /clean ?up/i, /\bsimplify\b/i, /\brename\b/i, /\bextract\b/i, /\bdry\b/i, /\bdedupli/i, /\btidy\b/i, /\bmove\b.*\binto\b/i],
      directives: [
        'Behavior-preserving by default — call out explicitly anything that changes observably.',
        'One concern per change: never bundle a cleanup with a fix.',
        'Show that the old and new paths agree, at least by reasoning over the inputs that reach them.',
      ],
    },
    {
      type: 'perf',
      roleFromDomain: true,
      role: 'performance engineer',
      patterns: [/\bslow\b/i, /\bperformance\b/i, /\boptimi[sz]/i, /\btimeout/i, /n\s*\+\s*1/i, /\blatency\b/i, /\btakes too long\b/i, /\bspeed up\b/i, /\bfaster\b/i],
      directives: [
        'Quantify the cost first (rows scanned, round-trips, payload size) — no optimizing by vibe.',
        'Fix the algorithmic or query-shape cause before touching anything micro.',
        'Say what the change costs elsewhere: memory, cache staleness, added index write cost.',
      ],
    },
    {
      type: 'security',
      roleFromDomain: true,
      role: 'security-minded senior engineer',
      patterns: [/\bauth(z|entication|orization)?\b/i, /\bpermission/i, /\brole[- ]based\b/i, /\btokens?\b/i, /\bleak/i, /\bexposed?\b/i, /\bsanitiz/i, /sql injection/i, /\bmass[- ]assign/i, /\bnot (me|them|the owner)\b/i, /someone else'?s/i],
      directives: [
        'Trace the authorization decision to the line that enforces it; assume the caller is hostile.',
        'Authentication is not authorization: a route being behind login says nothing about whether THIS user may touch THIS record.',
        'Never log or return secrets, tokens, or password hashes.',
      ],
    },
    {
      type: 'data',
      role: 'data-model engineer ' + ON,
      patterns: [/\bquery\b/i, /\bselect\b/i, /how many\b/i, /\bcounts?\b/i, /\brows?\b/i, /\bin the (db|database)\b/i, /spot[- ]check/i, /how (is|are) .* stored/i],
      directives: [
        'Answer from the entity definitions and the real storage shape — column type, relation, eager or lazy — not from the field name.',
        'Show the query or the entity lines you relied on, then the conclusion.',
        'Say what invalidates the obvious assumption: a relation that is never loaded, a table nothing writes to, a column that stores a delimited string.',
      ],
    },
    {
      type: 'comms',
      role: 'senior engineer writing to colleagues — concise, decision-first',
      patterns: [/\bslack\b/i, /\bnotify\b/i, /\bpost to\b/i, /\bmessage\b/i, /\bemail\b/i, /\bdraft\b.*\b(reply|message|comment|update)\b/i, /\bstandup\b/i, /\bcomment on\b/i],
      directives: [
        'Draft first. Send only on an explicit "send it".',
        'Lead with the ask or the decision; no preamble, no restating what they already know.',
        'Match the audience — reviewer, product owner and tester are different messages.',
      ],
    },
    {
      type: 'implement',
      roleFromDomain: true,
      role: 'senior engineer ' + ON,
      patterns: [/\bimplement\b/i, /\bbuild\b/i, /\bcreate\b/i, /\bwrite\b.*\b(code|endpoint|api|service|component|function|script|query)\b/i, /\badd\b.*\b(endpoint|api|field|column|flag|page|component|filter|button|route|relation)\b/i, /\bwire (it |this )?up\b/i, /\bdevelop\b/i, /\bcode (this|it)\b/i, /\bmake it work\b/i, /\bsupport for\b/i, /\bnew (endpoint|api|module|feature|page|component|route)\b/i, /where (do|should) i put/i],
      directives: [
        'Read the nearest sibling module FIRST and mirror its conventions — the project\'s documented standards are hard gates, not suggestions. Never invent a pattern.',
        'Search before creating: reuse the existing util/service/helper instead of adding a parallel one.',
        { t: 'Keep the layer order the codebase already uses (controller → service → repository/entity) and keep the response envelope the other endpoints return.', d: ['backend', 'security', 'database'] },
        { t: 'A contract change is a cross-consumer change: find every caller of the field or route you touch before changing it.', d: ['backend', 'frontend', 'architecture'] },
        'Analyse the non-happy paths — empty set, already-exists, not found, concurrent write, permission denied — and say which can actually occur here and which cannot. Only the reachable ones get code; do not add error handling for states that cannot happen.',
        'Name the test cases that prove it: happy path, one per reachable edge case, one regression on the code you touched.',
        'Then state the blast radius: every existing caller/consumer of what you changed.',
      ],
    },
    {
      type: 'explain',
      roleFromDomain: true,
      role: 'senior engineer ' + ON,
      patterns: [
        /\b(is|are|was|were|does|do|did|can|could|will|would|should)\s+(it|this|that|there|they|we|you|the|a)\b/i,
        /\b(tell|show|give|walk)\s+me\b/i, /\bdo we have\b/i, /\bis (it|this|that) true\b/i,
        /\b(correct|right|true)\s*\?/i, /\bwhat (about|if|is|are|does)\b/i, /\bmeaning\b/i,
        /\bclarify\b/i, /\bconfirm\b/i, /\bsimpl[ey]\b/i, /\bshortly\b/i, /\bin short\b/i, /\bwhich\b.*\?/i,
      ],
      directives: [
        'Answer in the first sentence, then the evidence. Never build up to the answer, and never recap what I already know.',
        'Anything you assert about the code is cited file:line with the verbatim snippet, and you say plainly what you did NOT read. "I think" and "probably" are answers only when labelled as such.',
        'Plain words, short sentences. If I asked for it "simply" or "shortly", that IS the requirement — no jargon, no history, no hedging paragraph before the point.',
      ],
    },
  ],

  /* =======================================================================
   * PROMPT PREPARATION — the rest of what a thin prompt needs.
   * ===================================================================== */

  PREP_MAX_CHARS: 4800,
  PREP_LOW_COMPLEXITY_MAX_BAR: 3,

  // ---- brevity override (added 2026-10-28 after the Sonnet pilot) ----
  // When the prompt itself asks for a short answer, the quality bar, the output
  // contract, "done when", the scope reminder and the role brief all push the
  // other way — each one is another thing the answer "should" include. Measured
  // on `s11` ("shortly, why does login return 401 but signup 400?"): with the
  // full block, 2438/2242/2612 chars against a 1400 ceiling on Sonnet 5.5 and
  // the same failure on Opus 5; with no hook at all, 862-1036. So a brevity
  // request collapses the block to the one line below, and the shape sections
  // are skipped. Safety and the referent list still apply.
  PREP_BREVITY_RE: /\b(short(ly)?|briefl?y?|in short|in a (line|sentence)|one[- ](line|liner|sentence|para(graph)?)|concise(ly)?|tl;?dr|just (the )?(answer|yes or no)|yes or no|simpl[ey]|plain(ly)? (words|english)|no (jargon|preamble|fluff)|don'?t (ramble|pad)|keep it (short|brief|simple))\b/i,
  PREP_BREVITY_DIRECTIVE:
    'I asked for this SHORT — that is the requirement, not a preference. Lead with the answer in one or two ' +
    'sentences and stop there. No preamble, no recap, no structure I did not ask for, no "additionally". If ' +
    'something important does not fit, say so in one clause and let me ask.',
  PREP_LIGHT_INTENTS: ['explain'],
  PREP_COMPLEXITY_HIGH: 3,
  PREP_MAX_ENTITIES_PER_KIND: 6,
  PREP_MAX_PARTS: 6,

  PREP_SECTION_PRIORITY: [
    'confirm_before_acting', 'role', 'quality_bar', 'preconditions',
    'must_address', 'output_contract', 'done_when', 'parts',
    'scope_discipline', 'detected_work', 'if_underspecified', 'approach',
  ],

  // ---- entity extraction: the concrete referents that must not be dropped ----
  PREP_ENTITIES: [
    { kind: PROJECT.ticketLabel, re: TICKET_RE_G },
    { kind: 'PR',    re: /\b(?:pr|pull[- ]request)s?\s*#?\s*(\d{1,6})\b/gi, capture: 1 },
    ...(REPO_RE_G ? [{ kind: 'repo', re: REPO_RE_G }] : []),
    { kind: 'file',  re: /[\w./\\-]+\.(?:ts|tsx|js|jsx|mjs|md|json|sql|ya?ml|env)\b/gi },
    { kind: 'route', re: /\b(?:GET|POST|PUT|PATCH|DELETE)\s+\/[\w/:.-]*/g },
    { kind: 'env',   re: /\b(?:pre-?prod|production|prod|staging|uat|qa|dev)\b/gi },
    { kind: 'identifier', re: /\b[a-z][a-z0-9]+(?:_[a-z0-9]+){1,3}\b/g, intents: true },
  ],
  PREP_IDENT_INTENTS: ['data', 'implement', 'bugfix', 'investigate', 'explain'],
  PREP_IDENT_STOP: new Set([
    'snake_case', 'kebab_case', 'read_me', 'package_json', 'node_modules',
    'user_prompt', 'prompt_enhancer', 'file_path', 'e_g', 'i_e',
  ]),

  // ---- who is who (comms only) — from the project overlay ----
  PREP_PEOPLE: PROJECT.people,

  // ---- preconditions: fetch/read this BEFORE reasoning ----
  PREP_PRECONDITIONS: [
    { when: 'file',
      text: 'A specific file is named: read it before answering. Never speculate about code you have not opened — a claim about an unread file is a guess wearing a citation.' },
    { when: 'route',
      text: 'A route is named: open the controller that declares it AND the module that applies middleware to it before saying what it does or who may call it — the decorator alone does not tell you.' },
    { when: PROJECT.ticketLabel, intents: ['implement', 'design', 'qa', 'review', 'docs', 'requirements'],
      text: 'A ' + PROJECT.ticketLabel + ' is named but its content is not in this context: fetch or read it before deciding anything, or the work will be built against a guess at the requirement.' },
    { when: 'PR',
      text: 'A PR number is named: read the actual diff before commenting on it.' },
    { when: 'repo', intents: ['implement', 'bugfix', 'refactor', 'review'],
      text: 'A repo is named: its own conventions docs (README / CONTRIBUTING / AGENTS.md) bind this change and outrank any KB summary — load them before writing code.' },
    { when: 'identifier', intents: ['data'],
      text: 'Table/column identifiers are named: confirm their real shape in the entity definitions before asserting anything about them.' },
  ],

  /* ---- role briefs: what the person behind the stance actually knows ---- */
  PREP_ROLE_BRIEF: {
    'intent:review': {
      lines: [
        'Correct code is the floor, not the goal — the value is on the design-integrity layer: invariants, cross-consumer impact, evolvability, conformance to the project\'s own conventions.',
        'No finding without naming who ISSUES the bad input, the runtime consequence, and the line that should have stopped it.',
        'Review the lines that are there, not the author\'s claims about them: ask "should this be here at all?" before checking whether it works.',
        'A change that adds a field to a DTO, an entity, or a response envelope has consumers — name them.',
      ],
    },
    'intent:design': {
      lines: [
        'Design the DELTA against what exists — never a rebuild. Name the invariants the change must preserve before proposing anything.',
        'The deliverable is a spec a developer implements without making a single design decision. Every decision carries its rejected alternative and why it lost.',
        'Unknowns are numbered open questions with a named owner, never assumptions you resolved quietly.',
      ],
    },
    'intent:qa': {
      lines: [
        'Behaviour-level verification, not test code: preconditions → steps → expected result → failure signature.',
        'Read the service method for every branch and every lookup that can return nothing — each is a case.',
        'An edge case with no way to reach it in the product is not a test case — say so instead of listing it.',
      ],
    },
    'intent:requirements': {
      lines: [
        'The output is "what exactly needs to happen", scoped per module — not a design and not an estimate.',
        'Every unknown is an open question with the person who can answer it, never a filled-in guess.',
      ],
    },
    'intent:data': {
      lines: [
        'Column type and relation loading decide behaviour, not the field name: a `simple-array` is a delimited string, a non-eager relation is `undefined` until loaded.',
        'Show the entity lines, then the conclusion, so the conclusion is checkable.',
      ],
    },
    'intent:investigate': {
      lines: [
        'Prefer the project knowledge base over re-scanning the repo; if the KB lacks the detail, say which knowledge file should be updated.',
        'Trace the request from the route declaration through the middleware that guards it to the service line that does the work — the bug is usually at a boundary.',
      ],
    },
    'intent:comms': {
      lines: [
        'Draft only. Nothing is sent, posted, or commented until I say "send it".',
        'Decision first, then the why, in the fewest words that survive being forwarded.',
      ],
    },
    'intent:explain': {
      lines: [
        'Answer the question; do not re-establish the background.',
      ],
    },
    'domain:backend': {
      lines: [
        'Keep the layer order the codebase already uses (controller → service → repository/entity) and keep the response envelope the sibling endpoints return.',
        'Read the nearest sibling module first and mirror it. The project\'s documented conventions are hard gates.',
        'Route guards live in the module\'s middleware configuration, not on the controller — check both before saying who can call an endpoint.',
      ],
    },
    'domain:frontend': {
      lines: [
        'A contract change is cross-consumer: find every component that reads the field you touch.',
      ],
    },
    'domain:database': {
      lines: [
        'Answer from the entity definitions: column type, default, relation direction, eager or lazy. The field name is not evidence.',
        'Say what nothing writes to and what nothing reads — dead tables and unloaded relations are where the surprises live.',
      ],
    },
    'domain:security': {
      lines: [
        'Authentication is not authorization: being logged in says nothing about whether THIS user may touch THIS record. Find the ownership check, or say there is none.',
        'A lifecycle hook that hashes on insert does not run on update. Trace every write path a secret can travel.',
        'Never Object.assign a request body onto a persisted entity — name the fields.',
      ],
    },
    'domain:pr-review': {
      lines: [
        'Two layers, and the value is on the second: local correctness, then design integrity.',
        'Every actionable finding is its own item with severity, file:line, the failure scenario, and the fix.',
      ],
    },
    'domain:architecture': {
      lines: [
        'Design the delta; no implementation code.',
        'State the invariants first, then the decision table with rejected alternatives, then the blast radius.',
      ],
    },
    'domain:general': {
      lines: [
        'Prefer the project knowledge base over re-scanning a repo it already covers; if a fact is missing there, say which knowledge file should carry it.',
        'Cite file:line for anything you assert about the code, and say what you did not read.',
      ],
    },
  },

  PREP_OUTPUT_CONTRACTS: {
    requirements: 'In-scope task list (each naming the module it lands in) · explicitly out-of-scope · dependencies and order · numbered open questions, each with an owner.',
    implement: 'The change itself, then: files touched · edge cases considered (reachable vs not) · the test cases that prove it · consumers affected. Prose only where it carries information.',
    bugfix: 'Root cause as file:line → the fix → blast radius → how to verify it. In that order, and no fix before the cause is named.',
    review: 'Per finding: severity · file:line · what breaks · the concrete failure scenario (inputs → wrong output) · the fix. Then one verdict: READY / NEEDS CHANGES / COMMENT.',
    design: 'Decision table (decision · rejected alternative · why it lost) · invariants preserved · impact analysis · numbered open questions · rollout + rollback. No implementation code.',
    qa: 'A numbered checklist — preconditions → steps → expected result → failure signature — plus a regression map and what cannot be verified outside prod.',
    investigate: 'The answer first, then the evidence as file:line citations with verbatim snippets, then explicitly what you did NOT read.',
    data: 'The entity lines or query, then the conclusion — in that order, so the conclusion is checkable.',
    comms: 'The draft message alone, in a code block, ready to paste. No commentary around it unless I asked for options.',
    docs: 'The document itself, every claim either cited to file:line or explicitly marked an open question.',
    refactor: 'The diff, plus an explicit statement of what behavior is preserved and what (if anything) changes observably.',
    perf: 'The measured or reasoned cost before → the cause → the change → the cost after.',
    security: 'The exposure, the enforcement point that should stop it, and whether it is currently reachable.',
    explain: 'The answer first, then only the evidence that supports it. No preamble and no recap.',
  },

  PREP_DONE_CRITERIA: {
    requirements: 'every task is small enough to start without another scoping conversation, and every unknown is an open question with an owner rather than a guess.',
    implement: 'it type-checks, mirrors the sibling module\'s pattern, and every consumer you listed is either updated or explicitly declared unaffected.',
    bugfix: 'the root cause is named with file:line, the fix is at that single source rather than each call site, and you have said whether existing data is already wrong.',
    review: 'every actionable finding has a severity, a file:line and a failure scenario, and a verdict is stated.',
    design: 'a developer could implement it without making a single design decision, and every unknown is a numbered open question rather than an assumption.',
    qa: 'every reachable edge case has a case, and the un-verifiable ones are named as such.',
    investigate: 'every claim traces to a line you actually read, and the inferred parts are labelled inferred.',
    data: 'the entity lines or query are shown and the numbers answer the question actually asked.',
    comms: 'the draft is ready to paste, addressed to the right audience, and nothing has been sent.',
    docs: 'no sentence in it requires the reader to guess, and nothing is asserted that was not read.',
    refactor: 'behavior is demonstrably unchanged, or every observable change is stated outright.',
    perf: 'the cost is quantified before and after, and the fix addresses the cause rather than a symptom of it.',
    security: 'the enforcement point is identified, and you have said whether the exposure is currently reachable.',
    explain: 'the question actually asked is answered in the first two sentences, and nothing asserted about the code is uncited.',
  },

  PREP_SCOPE_INTENTS: ['implement', 'bugfix', 'refactor', 'perf', 'security'],
  PREP_SCOPE_DISCIPLINE:
    'Only what was asked. No extra features, no cleanup of surrounding code, no new abstraction for a one-time operation, ' +
    'no docstrings or type annotations on code you did not change. Do not add validation or fallbacks for states that cannot ' +
    'occur — validate at system boundaries only. The right amount of complexity is the minimum that solves the task in front ' +
    'of you. If the task looks unreasonable, or a stated requirement seems wrong, say so instead of engineering around it.',

  PREP_RISKS: [
    { id: 'prod', patterns: [/\bpre-?prod\b/i, /\bproduction\b/i, /\bprod\b/i, /\blive (db|database|data|server)\b/i],
      text: 'Production is named. Read-only there, always: no mutating statement, no script execution, and confirm with me before any action that reaches it. Never report an action as done that you did not perform.' },
    { id: 'destructive', patterns: [/\bdelete\b/i, /\bdrop\b/i, /\btruncate\b/i, /rm\s+-rf/i, /force[- ]push/i, /--force\b/i, /reset\s+--hard/i, /\bpurge\b/i, /\bwipe\b/i],
      text: 'A destructive or hard-to-reverse operation is named. Show me exactly what it would affect and confirm before executing. Never reach for a destructive shortcut to get around an obstacle.' },
    { id: 'outward', patterns: [/\bsend\b/i, /\bpost (it|this|that|to|a|an|the)\b/i, /\bpublish\b/i, /\bmerge\b/i, /\bapprove\b/i, /\bcomment on\b/i, /\bemail (it|this|that|them|him|her|the|everyone)\b/i, /\bnotify\b/i],
      text: 'This action is visible to other people once taken. Draft it, show it to me, and act only on an explicit go-ahead ("send it" / "post it").' },
  ],

  PREP_MULTIPART_SPLIT: /\n\s*(?:\d+[.)]|[-*•])\s+/,
  PREP_MULTIPART_SIGNALS: [
    /\band also\b/i, /\bplus\b/i, /\bafter that\b/i, /\bthen\b/i, /\bas well as\b/i,
    /\balso\b/i, /\band then\b/i, /;/,
  ],
  PREP_MULTIPART_MIN_SIGNALS: 2,
  PREP_ACTION_VERBS: [
    'implement', 'build', 'create', 'add', 'write', 'fix', 'review', 'check', 'post',
    'send', 'update', 'refactor', 'remove', 'delete', 'verify', 'test', 'document',
    'investigate', 'explain', 'compare', 'query', 'draft', 'design', 'scope', 'run',
    'list', 'tell',
  ],
  PREP_MULTIPART_MIN_VERBS: 3,

  PREP_VAGUE_MAX_TOKENS: 12,
  PREP_VAGUE_TEXT:
    'This prompt is thin: no concrete referent I can resolve deterministically. Before doing the work, state in one line the ' +
    'interpretation you are acting on. If two readings would produce materially different work, ask instead of picking one — ' +
    'and if the referent is obvious from the conversation you already have, just proceed; you have context this rule does not.',

  PREP_COMMIT_HINT:
    'This request is multi-constraint. Choose an approach and commit to it; do not revisit the decision unless you hit ' +
    'information that directly contradicts your reasoning. Make steady progress on a few things at a time rather than ' +
    'attempting everything at once.',
};
