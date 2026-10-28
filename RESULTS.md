# Results — prompt-enhancer benchmark

Run `2026-09-20T07-48-42-011Z` · answering model `claude-opus-5` · CLI `2.1.172 (Claude Code)` · fixture `lujakob/nestjs-realworld-example-app@c1c2cc4`

24 traps × 3 arms × 3 repeats = 216 fresh headless sessions, read-only tools, no MCP, shuffled order. Every raw answer and every injected block is in `results/2026-09-20T07-48-42-011Z/runs/`.

## 1. Headline — did the answer avoid the documented mistake?

A trap passes only when **every** outcome check passes. Checks are regexes verified against the fixture source; the `**Refined prompt:**` line is stripped before scoring.

| arm | trap pass rate | grounding traps | stance traps | individual checks |
|---|---|---|---|---|
| no hook (`arm0-none`) | **99%** | 100% | 97% | 100% |
| rules only (`arm1-rules`) | **99%** | 100% | 97% | 100% |
| full enhancer (`arm2-full`) | **96%** | 100% | 92% | 99% |

- full enhancer vs no hook: **−3 pp** on trap pass rate (grounding +0 pp, stance −6 pp).
- full enhancer vs rules only: **−3 pp** — what the dynamic layers (intent → stance, BM25 retrieval) add over a static rules file.
- rules only vs no hook: +0 pp — what a good CLAUDE.md alone buys.

## 2. Blind pairwise judge (`claude-sonnet-5`)

A different model compares two answers to the same prompt against the ground-truth key, blind to the arm, twice per pair with positions swapped. Ties excluded from the win rate; CI is a bootstrap over traps.

| comparison | verdicts | win rate | 95% CI | consistent wins / losses / position flips |
|---|---|---|---|---|
| full enhancer vs no hook | 144 | **62%** | 52%–72% | 16 / 6 / 27 |
| ↳ grounding | 72 | 53% | 46%–62% | 2 / 3 / 17 |
| ↳ stance | 72 | 70% | 53%–84% | 14 / 3 / 10 |
| full enhancer vs rules only | 144 | **50%** | 40%–59% | 8 / 7 / 25 |
| ↳ grounding | 72 | 49% | 37%–60% | 3 / 2 / 16 |
| ↳ stance | 72 | 51% | 36%–67% | 5 / 5 / 9 |

## 3. What it costs

| arm | injected chars | input tokens | cache-read tokens | output tokens | turns | wall time | $/answer | total $ |
|---|---|---|---|---|---|---|---|---|
| no hook | 0 | 2664 | 282992 | 7224 | 15.4 | 112 s | $0.593 | $42.71 |
| rules only | 1976 | 3348 | 309629 | 7830 | 18.1 | 123 s | $0.629 | $45.29 |
| full enhancer | 13702 | 3984 | 291132 | 9076 | 15.3 | 134 s | $0.663 | $47.75 |

Compliance with the injected format (restatement line, file:line citation) — reported, never headlined, because the enhancer instructs it: no hook 54% · rules only 92% · full enhancer 97%.

## 4. Side by side — where the difference is visible

### Where the enhancer did WORSE

| trap | no hook | full enhancer | lesson |
|---|---|---|---|
| `s11-shortly-401-vs-400` | 67% | 0% | "shortly" is the requirement; answer first, cite, stop. |

## 5. Per trap

| trap | group | no hook | rules only | full enhancer | lesson |
|---|---|---|---|---|---|
| `g01-password-change-locks-out` | grounding | 3/3 | 3/3 | 3/3 | Hashing runs only in @BeforeInsert; PUT /user saves the plaintext (upstream #88). |
| `g02-edit-someone-elses-article` | grounding | 3/3 | 3/3 | 3/3 | Middleware authenticates; nothing authorizes. update()/delete() never compare caller with author (#6, #44). |
| `g03-stale-token-500` | grounding | 3/3 | 3/3 | 3/3 | jwt.verify throws; nothing catches it (#79). |
| `g04-mass-assignment` | grounding | 3/3 | 3/3 | 3/3 | Object.assign(entity, body); DTO strips nothing; no pipe on PUT /user (#112). |
| `g05-add-popular-route` | grounding | 3/3 | 3/3 | 3/3 | Literal paths go above :slug; order in the class is match order (#7). |
| `g06-favorite-500` | grounding | 3/3 | 3/3 | 3/3 | user.favorites is a non-eager relation; findOne(id) leaves it undefined. |
| `g07-tag-filter-substring` | grounding | 3/3 | 3/3 | 3/3 | tagList is simple-array (one string); LIKE %tag% is substring match. |
| `g08-envelope-crash-after-create` | grounding | 3/3 | 3/3 | 3/3 | create() returns a bare entity, not {article} (#57). |
| `g09-favorited-hearts-empty` | grounding | 3/3 | 3/3 | 3/3 | favorited is never produced by the API (#99). |
| `g10-comment-author-missing` | grounding | 3/3 | 3/3 | 3/3 | Comment entity has no author column/relation; addComment sets only body. |
| `g11-public-endpoints` | grounding | 3/3 | 3/3 | 3/3 | Guards are per-route in module configure(); DELETE /users/:slug is unguarded. |
| `g12-slug-collision` | grounding | 3/3 | 3/3 | 3/3 | slugify appends a random base-36 suffix. |
| `s01-thin-fix-favorite` | stance | 3/3 | 3/3 | 3/3 | A thin prompt should still produce root cause + file:line, not a guess. |
| `s02-scope-rename` | stance | 3/3 | 3/3 | 3/3 | Do only what was asked; do not bundle fixes/improvements into a rename. |
| `s03-three-parts` | stance | 3/3 | 3/3 | 3/3 | Multi-part asks lose a part silently. |
| `s04-vague-feed-faster` | stance | 3/3 | 3/3 | 3/3 | Vague ask: quantify the cost from the real code before optimizing, state the interpretation. |
| `s05-prod-delete` | stance | 3/3 | 3/3 | 3/3 | Production + destructive: confirm, never fabricate execution. |
| `s06-review-diff` | stance | 3/3 | 3/3 | 3/3 | Review the lines that are there: missing await; DTO has no password; Object.assign still merges everything. |
| `s07-optional-auth-trace` | stance | 3/3 | 3/3 | 3/3 | Cite the decorator path, not a guess about passport. |
| `s08-qa-follow` | stance | 3/3 | 3/3 | 3/3 | Cases come from the branches and unguarded lookups in the code. |
| `s09-tags-stored` | stance | 3/3 | 3/3 | 3/3 | Answer from the entity, and say what nothing writes to. |
| `s10-design-comment-author` | stance | 3/3 | 3/3 | 3/3 | Design the delta: relation, write path, ownership on delete, response shape, existing rows. |
| `s11-shortly-401-vs-400` | stance | 2/3 | 2/3 | 0/3 | "shortly" is the requirement; answer first, cite, stop. |
| `s12-favorited-filter-500` | stance | 3/3 | 3/3 | 3/3 | Two bugs on one line pair: unloaded relation, then the wrong column. |

## 6. The cheaper-model test — a negative result, and the bug it found

**The hypothesis:** Opus 5 already does what the stance asks, which is why there was no correctness
gain above. A cheaper model skips steps, so the hook should help it more. If that held, the honest
headline would become *"lifts a cheap model to near-Opus answers"*.

**It did not hold.** Pilot on `claude-sonnet-5-5`, 6 traps × 3 arms × 3 repeats (the six traps where
the arms differed most on Opus), 2026-10-28:

| arm | trap pass |
|---|---|
| no hook | **100%** (18/18) |
| rules only | 94% (17/18) |
| full enhancer | **83%** (15/18) |

The hook made the cheaper model **worse**. Five of the six traps were 3/3 for all three arms —
Sonnet found the plaintext-password bug, the unloaded relation, every part of the three-part ask,
and refused the production delete, with or without help.

**All of the gap was one trap, and it was a real bug in the hook.** On `s11` — *"shortly, why does
login return 401 but signup 400?"*, ceiling 1,400 characters:

| | r1 | r2 | r3 |
|---|---|---|---|
| no hook | 975 ✓ | 1,036 ✓ | 862 ✓ |
| rules only | 1,471 ✗ | 1,118 ✓ | 1,077 ✓ |
| full enhancer | **2,438 ✗** | **2,242 ✗** | **2,612 ✗** |

Every section of the block — the quality bar, the output contract, "done when", the scope reminder,
the role brief — reads as *"also cover this"*. On a prompt that asked for brevity they all pushed the
wrong way, and making the bar shorter was not enough because the other sections kept pushing.

**The fix** (`PREP_BREVITY_RE` in `engine/lib/enhancer-config.js`): an explicit brevity request —
"shortly", "briefly", "in short", "one line", "simply", "no jargon", "keep it short" — now collapses
the whole block to the one-line role plus a single directive, drops the four shape sections and the
role brief, and makes the restatement opener optional. Safety (`confirm_before_acting`) and the
referent list still apply: being brief is not a licence to send something or answer half the question.

Re-ran `s11` on Sonnet 5.5 after the fix:

| | before | after |
|---|---|---|
| no hook | 975, 1036, 862 | 901, 1104, 833 |
| rules only | 1471, 1118, 1077 | 878, 1177, 1184 |
| **full enhancer** | **2438, 2242, 2612** | **885, 884, 803** |

0/3 → **3/3**, with both correctness checks still passing — the enhanced answers are now the
*shortest* of the three arms. Applying that to the pilot makes all three arms 100% on those six
traps: the regression is gone, and the "no correctness separation on this fixture" finding stands.

**What this changes about the claims above:** nothing, except that it reproduces them on a second
model. The judge's complaint when the hook lost — padding on simple prompts — was not an Opus quirk.
It was a real defect, it cost 11 percentage points on a cheaper model, and the benchmark is what
found it. That is the argument for keeping the benchmark in the repo.

## Limitations (read these before quoting a number)

- One small fixture (35 TypeScript files), one model, one CLI version, 3 repeats. A snapshot, not a law.
- The traps were written by the people who wrote the enhancer, from real upstream bug reports — but we chose which ones. Add your own; the format is `traps/*.json`.
- Regex checks can be satisfied by the right words for the wrong reason; the blind judge exists to catch that, and its ground-truth key was written from the code, not from any answer.
- The fixture ships a knowledge base the enhancer retrieves from. No KB → the grounding layer has nothing to retrieve; the stance layer still runs. On your project the gap depends on what you write down.
- Every run is a fresh session with a self-contained prompt. Real prompts are mostly mid-conversation follow-ups, which this cannot replay.
- Headless `claude -p` with read-only tools. Interactive use has more turns, more tools and more places to go wrong; we did not measure that.

Reproduce: `node run.js` then `node judge.js` then `node report.js`. Needs the `claude` CLI logged in.
