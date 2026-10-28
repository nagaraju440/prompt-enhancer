# Benchmark plan

## The question

Does prepending a **stance** (role, quality bar, output contract, risk flags) and **retrieved
knowledge** to a prompt make Claude Code's answer *better* — and does it beat simply writing a
good static rules file?

"Better" here is defined before running, mechanically, per prompt: did the answer avoid a
documented mistake, address every part, stay in scope, and not fabricate. Not "did it sound
nicer".

## Three arms

| Arm | Hook | Answers |
|---|---|---|
| `arm0-none` | none | true baseline |
| `arm1-rules` | injects the fixture's `session-guardrail.txt` only | *"isn't this just a CLAUDE.md?"* |
| `arm2-full` | the full enhancer (preparation layer + BM25 retrieval + rules) | does the dynamic layer earn its complexity? |

Arm 1 is the control that matters. If arm 2 ≈ arm 1, the intent detection and the retrieval
engine add nothing and that is the finding — better learned here than in the GitHub replies.

## The fixture

A real public repository, vendored at a pinned commit:
`lujakob/nestjs-realworld-example-app@c1c2cc4` (NestJS 7 + TypeORM 0.2 + MySQL, 35 `.ts` files,
1,174 lines). Chosen because:

- it implements a public spec (RealWorld), so "correct" has an external definition;
- it is small enough that a headless session can read all of it in seconds — so arm 0 is never
  handicapped by *not being able* to find the answer, only by not knowing where to look;
- it has **real bug reports** (#88 plaintext password on update, #6/#44 no ownership check,
  #79 bad token → 500, #112 mass assignment, #57 bare entity instead of envelope, #7 route
  order, …). The fixture's `LESSONS.md` is written from those, so the knowledge base is the kind
  a real team would have, not an answer key written for the test.

On top of the vendored code the fixture carries what a team using the enhancer would carry:
`.claude/knowledge/{workspace,schema,auth}.md`, `LESSONS.md`, `CURRENT_FOCUS.md`,
`.claude/session-guardrail.txt`, and `.claude/enhancer.project.json` (name/stack/ticket pattern —
the only project-specific input the engine takes).

## Traps

24 prompts, in two groups of 12:

- **grounding** — the KB/LESSONS carry the relevant fact. Arm 0 must find it by reading code.
  Measures the retrieval layer.
- **stance** — thin, vague, multi-part, risky, or format-constrained prompts ("fix the 500 on
  favorite", "make the feed faster", "run the delete on production", "shortly, why …").
  Measures the preparation layer.

Each trap declares checks on the answer text:

- `outcome` checks (the benchmark): was the answer RIGHT — names the real cause, the real
  column, the real rule; does not fabricate; covers every part; stays in scope.
- `compliance` checks (reported, never headlined): restatement line present, `file:line`
  citation present. Arm 2 wins these by construction — the enhancer instructs them. Winning
  them proves obedience, not quality.

Trap-writing rules:

- Phrase in natural user language. **Never quote the lesson text** — retrieval would find it
  trivially and real users do not quote the lesson back.
- Every trap must be **failable**: arm 0 has to plausibly get it wrong. A trap everything passes
  measures nothing; a trap everything fails is broken. The per-trap table exists to catch both.
- The answer key is the **code**, not our KB. Every check was verified against the source
  lines it names.

## Fairness controls

- The **only** difference between arms is the `UserPromptSubmit` hook. Permissions, model, MCP
  config, tools and working directory are merged in identically (`COMMON_SETTINGS` in `run.js`).
- `--strict-mcp-config` with an empty config: no MCP servers.
- Read-only tools (`Read`, `Grep`, `Glob`), identical per arm. A write would change the fixture
  for the next run; a permission prompt in `--print` mode would silently degrade an answer.
- No user-level hooks or `CLAUDE.md` on the machine that ran it (checked before the run).
- Run order shuffled from a fixed seed and interleaved across arms, so service drift cannot land
  on one arm. 3 repeats per prompt per arm — the model is non-deterministic and N=1 is noise.
- A run whose JSON reports `is_error` (e.g. auth failure) is a **failed run**, excluded from
  every rate and counted in its own column. (The first attempt at this benchmark, on 2026-09-05,
  counted 12 auth failures as answers. That is why this rule exists.)
- Every raw response is written to disk, with the exact text the hook injected, so anyone can
  re-score.

## Two scorers

1. **Regex traps** (`run.js`) — cannot be charmed, but only see what they were told to look for.
   The headline.
2. **Blind pairwise judge** (`judge.js`) — a different model (`claude-sonnet-5`) compares two
   answers against the trap's ground-truth key, blind to the arm, **twice with positions
   swapped**, no tools, empty directory. Reports win rate excluding ties with a bootstrap CI over
   traps, plus how often the judge flipped when the order flipped (pure position bias).

The `**Refined prompt:**` line is stripped from every answer before either scorer sees it.

## Scale and cost

24 traps × 3 arms × 3 repeats = **216 answering runs** (Opus 5), then
24 × 3 × 2 pairs × 2 orders = **288 judge calls** (Sonnet 5).

## Prediction, recorded before running (2026-09-20)

- Grounding traps: arm2 > arm1 > arm0, with the biggest gap on the ones whose fact is a *silence*
  in the code (nothing writes the tag table, `favorited` is never produced, `DELETE /users/:slug`
  is unguarded) — arm 0 has to notice an absence.
- Stance traps: arm2 > arm0 on the scope/risk/multi-part ones (`s02`, `s03`, `s05`); flat on the
  ones a strong model already handles (`s01`, `s07`). `s11` ("shortly") may go *against* arm 2 if
  the injected bar makes it write more.
- arm1 lands between the two on grounding (the rules file names the envelope and the
  authentication-vs-authorization distinction) and near arm0 on stance.
- Cost: arm 2 adds ~3–4k input tokens per turn (mostly cache-read after the first call), and
  its answers run longer.

If the data disagrees, the data wins and this section stays as written.
