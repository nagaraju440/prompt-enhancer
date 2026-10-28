'use strict';
/*
 * kb-retrieval.js — Retrieval-Augmented Prompt Enhancement (RAPE) engine.
 * ----------------------------------------------------------------------
 * Pure, dependency-free, deterministic local retrieval over a markdown KB.
 *
 * Pipeline:
 *   discover files (glob) -> parse frontmatter -> split into heading sections
 *   -> tokenize -> BM25 score sections vs. the prompt -> apply field boosts
 *   -> filter by MIN_SCORE -> greedily pack under MAX_CONTEXT_CHARS / MAX_FILES
 *   -> dedupe -> emit compact, header-preserving context.
 *
 * No embeddings, no vector DB, no network. Everything is a pure function of
 * (prompt, files-on-disk, config), so results are reproducible.
 *
 * Public API:
 *   classify(prompt, cfg) -> { type, hint }
 *   retrieve(prompt, { root, cfg }) -> { context, files, sections, classification, stats }
 *
 * CLI (for testing / perf):  node kb-retrieval.js "your prompt here"
 */
const fs = require('fs');
const path = require('path');
const CFG = require('./enhancer-config');

/* ----------------------------- tokenization ----------------------------- */

function tokenize(text, cfg) {
  const out = [];
  const matches = String(text).toLowerCase().match(cfg.TOKEN_RE);
  if (!matches) return out;
  for (const tok of matches) {
    if (tok.length < cfg.MIN_TOKEN_LEN) continue;
    if (cfg.STOP_WORDS.has(tok)) continue;
    out.push(tok);
  }
  return out;
}

function termFreq(tokens) {
  const tf = new Map();
  for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
  return tf;
}

/* --------------------------- markdown parsing --------------------------- */

// Split off a leading YAML frontmatter block. Returns { meta, body }.
// meta is a shallow string map (we only care about `purpose`/`tags` text).
function parseFrontmatter(raw) {
  if (!raw.startsWith('---')) return { meta: {}, body: raw };
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { meta: {}, body: raw };
  const block = raw.slice(3, end);
  const body = raw.slice(end + 4).replace(/^\r?\n/, '');
  const meta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (m) meta[m[1].toLowerCase()] = m[2].trim();
  }
  return { meta, body };
}

// Split a markdown body into sections by heading, fence-aware so that '#'
// inside a ``` code block is never treated as a heading. Each section keeps a
// breadcrumb (heading path) for context preservation.
function splitSections(body, fileTitle) {
  const lines = body.split('\n');
  const sections = [];
  const stack = []; // [{ level, text }]
  let cur = { breadcrumb: fileTitle, heading: '', lines: [] };
  let inFence = false;

  const push = () => {
    const text = cur.lines.join('\n').trim();
    if (text) sections.push({ breadcrumb: cur.breadcrumb, heading: cur.heading, body: text });
  };

  for (const line of lines) {
    const fence = /^\s*(```|~~~)/.test(line);
    if (fence) inFence = !inFence;

    const h = !inFence && line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) {
      push();
      const level = h[1].length;
      const heading = h[2].trim();
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
      stack.push({ level, text: heading });
      const crumb = [fileTitle].concat(stack.map((s) => s.text)).join(' > ');
      cur = { breadcrumb: crumb, heading, lines: [] };
    } else {
      cur.lines.push(line);
    }
  }
  push();
  return sections;
}

/* ------------------------------ discovery ------------------------------ */

// Recursive *.md walk (manual, so it works on every Node version / OS).
function walkMarkdown(absDir, relDir, acc) {
  let entries;
  try { entries = fs.readdirSync(absDir, { withFileTypes: true }); }
  catch { return acc; }
  entries.sort((a, b) => a.name.localeCompare(b.name)); // deterministic order
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = relDir ? relDir + '/' + e.name : e.name;
    if (e.isDirectory()) walkMarkdown(abs, rel, acc);
    else if (e.isFile() && e.name.endsWith('.md')) acc.push({ abs, rel });
  }
  return acc;
}

function discoverFiles(root, cfg) {
  const files = [];
  for (const rf of cfg.ROOT_FILES) {
    const abs = path.join(root, rf);
    if (fs.existsSync(abs)) files.push({ abs, rel: rf });
  }
  const kbAbs = path.join(root, cfg.KB_DIR);
  const kbFiles = walkMarkdown(kbAbs, cfg.KB_DIR.replace(/\\/g, '/'), []);
  files.push(...kbFiles);
  // De-dup by rel (in case a root file also lives under KB_DIR)
  const seen = new Set();
  return files.filter((f) => (seen.has(f.rel) ? false : (seen.add(f.rel), true)));
}

// Repo slugs are derived from repos/<slug>.md filenames — data-driven, so a new
// repo file automatically becomes a detectable/boostable term.
function repoSlugs(files, cfg) {
  const marker = '/' + cfg.REPOS_SUBDIR + '/';
  const slugs = new Map(); // slug -> rel
  for (const f of files) {
    const i = f.rel.indexOf(marker);
    if (i !== -1) {
      const slug = f.rel.slice(i + marker.length).replace(/\.md$/, '').toLowerCase();
      slugs.set(slug, f.rel);
    }
  }
  return slugs;
}

function priorityFor(rel, cfg) {
  if (Object.prototype.hasOwnProperty.call(cfg.FILE_PRIORITY, rel)) return cfg.FILE_PRIORITY[rel];
  if (rel.includes('/' + cfg.REPOS_SUBDIR + '/')) return cfg.REPO_PRIORITY;
  return cfg.DEFAULT_PRIORITY;
}

/* ------------------------------ corpus build ---------------------------- */

function buildCorpus(root, cfg) {
  const files = discoverFiles(root, cfg);
  const slugs = repoSlugs(files, cfg);
  const sections = [];

  for (const f of files) {
    // Size guard: a runaway KB file must not add CPU to EVERY prompt (fresh
    // node process per hook run). Skip anything over MAX_FILE_BYTES.
    try { if (fs.statSync(f.abs).size > (cfg.MAX_FILE_BYTES || 300000)) continue; } catch { continue; }
    let raw;
    try { raw = fs.readFileSync(f.abs, 'utf8'); } catch { continue; }
    const { meta, body } = parseFrontmatter(raw);
    const title = f.rel.split('/').pop();
    const purposeTokens = new Set(tokenize((meta.purpose || '') + ' ' + (meta.tags || ''), cfg));
    const nameTokens = new Set(tokenize(f.rel.replace(/\//g, ' ').replace(/\.md$/, ''), cfg));

    for (const s of splitSections(body, title)) {
      const headingTokens = new Set(tokenize(s.heading, cfg));
      const tokens = tokenize(s.heading + ' ' + s.body, cfg);
      sections.push({
        rel: f.rel,
        breadcrumb: s.breadcrumb,
        body: s.body,
        tokens,
        tf: termFreq(tokens),
        len: tokens.length,
        priority: priorityFor(f.rel, cfg),
        purposeTokens,
        headingTokens,
        nameTokens,
      });
    }
  }
  return { sections, slugs };
}

/* -------------------------------- BM25 --------------------------------- */

function bm25Stats(sections) {
  const df = new Map();
  let totalLen = 0;
  for (const s of sections) {
    totalLen += s.len;
    for (const term of s.tf.keys()) df.set(term, (df.get(term) || 0) + 1);
  }
  const N = sections.length || 1;
  const avgdl = totalLen / N || 1;
  return { df, N, avgdl };
}

function idf(term, stats) {
  const df = stats.df.get(term) || 0;
  // BM25+ style smoothing — always positive.
  return Math.log(1 + (stats.N - df + 0.5) / (df + 0.5));
}

function bm25Score(queryTerms, section, stats, cfg) {
  let score = 0;
  for (const t of queryTerms) {
    const f = section.tf.get(t);
    if (!f) continue;
    const denom = f + cfg.BM25_K1 * (1 - cfg.BM25_B + cfg.BM25_B * (section.len / stats.avgdl));
    score += idf(t, stats) * ((f * (cfg.BM25_K1 + 1)) / denom);
  }
  return score;
}

/* ----------------------------- classifier ------------------------------ */

function classify(prompt, cfg) {
  let best = null;
  let bestScore = 0;
  for (const c of cfg.CLASSIFIERS) {
    let hits = 0;
    for (const re of c.patterns) if (re.test(prompt)) hits++;
    if (hits > bestScore) { bestScore = hits; best = c; }
  }
  return best ? { type: best.type, hint: best.hint } : cfg.DEFAULT_CLASS;
}

/* ------------------------------ retrieval ------------------------------ */

function scoreSections(queryTerms, corpus, stats, mentionedRepoRels, cfg) {
  const qset = new Set(queryTerms);
  const scored = [];
  for (let i = 0; i < corpus.sections.length; i++) {
    const s = corpus.sections[i];
    const bm = bm25Score(queryTerms, s, stats, cfg);
    const matched = bm > 0;

    let boost = 0;
    if (s.rel === 'CURRENT_FOCUS.md' && matched) boost += cfg.BOOST_CURRENT_FOCUS;
    if (s.rel === 'LESSONS.md' && matched) boost += cfg.BOOST_LESSONS;
    if (mentionedRepoRels.has(s.rel) && matched) boost += cfg.BOOST_REPO_MATCH;
    // Field boosts require actual body relevance (bm > 0) — otherwise a file
    // whose NAME shares one token with the query passes the MIN_SCORE floor
    // with zero content relevance and pads every context with noise.
    if (matched && anyIn(qset, s.purposeTokens)) boost += cfg.BOOST_PURPOSE_MATCH;
    if (matched && anyIn(qset, s.headingTokens)) boost += cfg.BOOST_HEADING_MATCH;
    if (matched && anyIn(qset, s.nameTokens)) boost += cfg.BOOST_FILENAME_MATCH;

    const score = bm * s.priority + boost;
    if (score > 0) scored.push({ section: s, score, bm, boost, index: i });
  }

  // Deterministic ordering: score desc, then priority desc, then rel asc, then
  // original section index asc.
  scored.sort((a, b) =>
    b.score - a.score ||
    b.section.priority - a.section.priority ||
    (a.section.rel < b.section.rel ? -1 : a.section.rel > b.section.rel ? 1 : 0) ||
    a.index - b.index);
  return scored;
}

function anyIn(querySet, tokenSet) {
  for (const t of querySet) if (tokenSet.has(t)) return true;
  return false;
}

function normalizeForDedup(body) {
  return body.replace(/\s+/g, ' ').trim().toLowerCase();
}

function retrieve(prompt, opts) {
  opts = opts || {};
  const cfg = opts.cfg || CFG;
  const root = opts.root;
  const result = { context: '', files: [], sections: [], classification: classify(prompt, cfg), stats: {} };
  if (!root) return result;

  try {
    const corpus = buildCorpus(root, cfg);
    if (!corpus.sections.length) return result;

    const queryTerms = Array.from(new Set(tokenize(prompt, cfg)));

    // Which repo files are named in the prompt? (data-driven from repos/*.md)
    // Word-boundary matching, longest slug first with span removal — so 'bx-be'
    // never fires inside 'bx-be-nestjs' and 'rx' never fires inside a word.
    const mentionedRepoRels = new Set();
    let scan = prompt.toLowerCase();
    const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
    const slugEntries = Array.from(corpus.slugs).sort((a, b) => b[0].length - a[0].length);
    for (const [slug, rel] of slugEntries) {
      const re = new RegExp('(^|[^a-z0-9])' + escapeRe(slug) + '($|[^a-z0-9])');
      if (re.test(scan)) {
        mentionedRepoRels.add(rel);
        scan = scan.split(slug).join(' '); // remove matched spans so shorter slugs can't re-match inside them
      }
    }

    const stats = bm25Stats(corpus.sections);
    const scored = scoreSections(queryTerms, corpus, stats, mentionedRepoRels, cfg);

    // ---- greedy budget packing with dedup + distinct-file cap ----
    const chosen = [];
    const usedFiles = new Set();
    const seenBodies = [];
    let budget = cfg.MAX_CONTEXT_CHARS;

    const tryAdd = (entry, { pinned = false } = {}) => {
      const s = entry.section;
      if (!pinned && entry.score < cfg.MIN_SCORE) return false;
      if (!usedFiles.has(s.rel) && usedFiles.size >= cfg.MAX_FILES) return false;

      let body = s.body;
      if (body.length > cfg.MAX_SECTION_CHARS) {
        body = body.slice(0, cfg.MAX_SECTION_CHARS) + '\n…[truncated]';
      }
      const norm = normalizeForDedup(body);
      for (const prev of seenBodies) {
        if (prev === norm || prev.includes(norm) || norm.includes(prev)) return false; // duplicate/subset
      }
      const block = '### [' + s.rel + '] ' + s.breadcrumb + '\n' + body;
      if (block.length > budget) return false;

      chosen.push(block);
      seenBodies.push(norm);
      usedFiles.add(s.rel);
      budget -= block.length + 2; // account for the join separator
      result.sections.push({ rel: s.rel, breadcrumb: s.breadcrumb, score: +entry.score.toFixed(3), bm: +entry.bm.toFixed(3), boost: +entry.boost.toFixed(3) });
      return true;
    };

    // 1) Pinned files first: include at most PINNED_MAX_SECTIONS per file,
    //    choosing the most lexically-relevant sections (falls back to document
    //    order when nothing matches, so the file is still represented once).
    for (const rel of cfg.PINNED_FILES) {
      const ranked = corpus.sections
        .map((s, i) => ({ section: s, i }))
        .filter((e) => e.section.rel === rel)
        .map((e) => ({ section: e.section, bm: bm25Score(queryTerms, e.section, stats, cfg), index: e.i }))
        .sort((a, b) => b.bm - a.bm || a.index - b.index)
        .slice(0, cfg.PINNED_MAX_SECTIONS);
      for (const e of ranked) {
        if (budget < cfg.MIN_BUDGET_TAIL) break;
        tryAdd({ section: e.section, score: e.bm, bm: e.bm, boost: 0 }, { pinned: true });
      }
    }
    // 2) Then top-scored sections until the budget is spent.
    for (const entry of scored) {
      if (budget < cfg.MIN_BUDGET_TAIL) break;
      tryAdd(entry);
    }

    result.context = chosen.join('\n\n');
    result.files = Array.from(usedFiles);
    result.stats = { totalSections: corpus.sections.length, scored: scored.length, avgdl: +stats.avgdl.toFixed(1), files: corpus.slugs.size };
  } catch {
    // Fail-open: return whatever we have (possibly empty). The caller still
    // enhances with general instructions; the hook never blocks.
  }
  return result;
}

module.exports = { retrieve, classify, tokenize, splitSections, parseFrontmatter, buildCorpus };

/* --------------------------------- CLI --------------------------------- */

if (require.main === module) {
  const prompt = process.argv.slice(2).join(' ') || 'review PR 112 in the user module';
  const root = path.resolve(__dirname, '..', '..');
  const t0 = process.hrtime.bigint();
  const r = retrieve(prompt, { root });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  console.log('PROMPT:', prompt);
  console.log('CLASS :', r.classification.type, '—', r.classification.hint);
  console.log('STATS :', JSON.stringify(r.stats), '| retrieval ' + ms.toFixed(2) + 'ms');
  console.log('FILES :', r.files.join(', ') || '(none)');
  console.log('RANKED SECTIONS:');
  for (const s of r.sections) console.log('  ' + s.score.toString().padStart(6) + '  [' + s.rel + '] ' + s.breadcrumb + '  (bm=' + s.bm + ' boost=' + s.boost + ')');
  console.log('\n----- CONTEXT (' + r.context.length + ' chars) -----\n' + r.context);
}
