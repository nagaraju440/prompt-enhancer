# prompt-enhancer benchmark

Does a local, zero-dependency `UserPromptSubmit` hook that prepends a **stance** and **retrieved
project knowledge** to your prompt make Claude Code's answers better? This folder is the
self-contained experiment that answers it: engine, fixture, traps, runner, judge, results.

**Real prompts it handled:** [`EXAMPLES.md`](EXAMPLES.md) — 8 unedited prompt → restatement pairs
from four months of daily use, plus what the log says in aggregate.
**Numbers:** [`RESULTS.md`](RESULTS.md). **Method:** [`PLAN.md`](PLAN.md).

**The honest summary:** on a blind pairwise test, a second model preferred the enhanced answers
**62%** of the time overall and **70%** on vague, multi-part and review prompts. It did *not* make
answers more factually correct (Opus 5 was already at 96–99% either way), and it did *not* beat a
well-written static rules file. Full numbers, including where it did worse, in `RESULTS.md`.

## What is being tested

`engine/` is the hook. On every prompt it runs locally (~150 ms, Node, no network, no second
model) and prints two blocks that Claude Code injects as context:

1. **Preparation** — regex intent detection → a one-line role, a 3–6 item quality bar, an output
   contract, "done when", the concrete referents it must address, preconditions ("read the named
   file first"), scope discipline, and confirm-before-acting flags for prod/destructive/outward
   actions. Rendered only when a detector fires; shrinks on simple prompts.
2. **Grounding** — BM25 retrieval over the project's `.claude/knowledge/*.md`, `LESSONS.md` and
   `CURRENT_FOCUS.md`, packed to ~12 KB, tagged as reference material.

Plus the project's static `session-guardrail.txt`. The engine never rewrites your words.

## Layout

```
engine/            the hook itself (generic; project specifics via .claude/enhancer.project.json)
  install.js               one-command install / uninstall into any project
  refined-prompt-logger.js Stop hook: logs what Claude understood you to mean
fixture/           lujakob/nestjs-realworld-example-app @ c1c2cc4 + a realistic knowledge base
  .claude/knowledge/{workspace,schema,auth}.md · LESSONS.md · CURRENT_FOCUS.md · session-guardrail.txt
arms/              arm0-none · arm1-rules · arm2-full   (one settings.json each)
traps/             24 prompts with mechanical checks (build-traps.js is the source of truth)
run.js             24 traps × 3 arms × N repeats through `claude -p`, scored, raw answers saved
judge.js           blind pairwise judge (different model, positions swapped, no tools)
report.js          summary.json + judge.json → RESULTS.md
EXAMPLES.md        real prompt → restatement pairs from daily use
RESULTS.md         the benchmark numbers · PLAN.md the method
results/<runId>/   runs/*.json (every answer + the exact injected text), summary.md, judge.md
```

## Run it yourself

Needs Node ≥ 18 and the `claude` CLI, logged in (`claude auth login`) or `ANTHROPIC_API_KEY` set.

```bash
node run.js --dry-run              # what would run
node run.js --traps 2 --repeats 1  # smoke test (6 calls)
node run.js                        # full: 216 Opus 5 calls, ~1–2 h
node judge.js                      # 288 Sonnet 5 calls
node report.js                     # writes RESULTS.md
```

Try the engine on any prompt without spending anything:

```bash
PE_ROOT=fixture node engine/prompt-enhancer.js <<< '{"prompt":"fix the 500 on favorite"}'
```

## Install it on your own project

Two steps. No dependencies, no build, no config file to write.

```bash
git clone https://github.com/<you>/prompt-enhancer.git ~/prompt-enhancer
```

```bash
node ~/prompt-enhancer/engine/install.js /path/to/your/project
```

That's it — start a new Claude Code session and it runs on your next prompt. The installer edits
exactly one file (`.claude/settings.json`), keeps every setting and hook already in it, backs it up
first, and is safe to run twice. Requires Node ≥ 18, which you already have if you run Claude Code.

```bash
node ~/prompt-enhancer/engine/install.js --uninstall    # removes just the hook
```

**It works with zero configuration.** With no knowledge base at all, the stance layer still reads
your prompt and injects a role, a quality bar, an output contract and confirm-before-acting flags
(~3 KB). The grounding layer simply stays quiet.

Try it right now without starting a session:

```bash
echo '{"prompt":"fix the login bug"}' | node ~/prompt-enhancer/engine/prompt-enhancer.js
```

### Make it yours (all optional, add any time)

| Add this file | And you get |
|---|---|
| `.claude/session-guardrail.txt` | your own standing rules, injected verbatim on every prompt |
| `.claude/knowledge/*.md` (with a `purpose:` frontmatter line) | the grounding layer turns itself on and retrieves the relevant sections |
| `LESSONS.md`, `CURRENT_FOCUS.md` at the repo root | past corrections and in-flight work get retrieved too, with a scoring boost |
| `.claude/enhancer.project.json` | `name` and `stack` sharpen the role line; `ticketPattern`, `repos`, `people` are recognised as referents |

`install.js --starter` drops a starter rules file and project JSON for you to edit (it never
overwrites files you already have).

### The log

The installer wires **two** hooks, and together they write `.claude/enhancer-log.md`:

| hook | records |
|---|---|
| `prompt-enhancer.js` (`UserPromptSubmit`) | your prompt, the detected intent and domain, which KB files were retrieved, which sections were injected |
| `refined-prompt-logger.js` (`Stop`) | your prompt paired with the one-line restatement Claude opened with — the before/after pairs in [`EXAMPLES.md`](EXAMPLES.md) |

It is **on by default**, because it is how you find out whether the thing is working and which
pattern to tune when it isn't. It is local, rotated at 1 MB, and never leaves your machine — but it
does hold your prompts verbatim, so:

- `ENHANCER_LOG=0` turns all logging off, both hooks.
- `install.js --no-logger` skips the `Stop` hook; you keep the injection side only.
- In a git repo the installer writes `.claude/.gitignore` so a stray `git add .` can't commit it.

**Switches:** `ENHANCER_OFF=1` disables the hook · `ENRICH_OFF=1` keeps grounding but drops the
stance layer · `ENHANCER_LOG=0` disables logging · every failure is fail-open, so a broken config
can never block your prompt.
