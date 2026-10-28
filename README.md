# prompt-enhancer

A local `UserPromptSubmit` hook for Claude Code. It reads the prompt you typed and prepends a
**stance** — a role, a quality bar, an output contract, and flags like *confirm before acting* —
plus the **project knowledge** relevant to that prompt. It never rewrites a word of what you typed.

No network. No second model. No dependencies. Node's `fs` and `path` are the only imports, and it
runs in about 150 ms.

```
you type:   fix the 500 on the favorite endpoint

it injects: <role>
            You are a senior backend engineer on <your project>.
            - Keep the layer order the codebase already uses (controller → service →
              repository/entity) and keep the response envelope the siblings return.
            - Read the nearest sibling module first and mirror it.
            </role>
            <quality_bar>
            1. Locate the exact failing line and quote it as file:line before proposing anything.
            2. Name the ROOT CAUSE, not the symptom — and say why it surfaces now.
            3. Fix it at its single source; do not patch each call site.
            </quality_bar>
            <output_contract>
            Root cause as file:line → the fix → blast radius → how to verify it.
            </output_contract>
            <scope_discipline>
            Only what was asked. No extra features, no cleanup of surrounding code...
            </scope_discipline>
            [+ the sections of your knowledge base that mention this code]
```

That is real output, trimmed for width — run the command under *Install* below to see the whole
block for any prompt of your own.

**Does it actually help?** Measured, not claimed — see [`RESULTS.md`](RESULTS.md). The short
version: a blind judge preferred the enhanced answers **62%** of the time overall and **70%** on
vague, multi-part and review prompts. It did **not** make answers more factually correct (Opus 5
scored 96–99% either way on a small codebase), and it did **not** beat a well-written static rules
file. Where it did worse is in there too.

**What it looks like in practice:** [`EXAMPLES.md`](EXAMPLES.md) — eight unedited prompt →
restatement pairs from four months of daily use, including the time an explicit "send it" was
paused because the recipient ID looked wrong.

---

## Install

Two steps. Requires Node ≥ 18, which you already have if you run Claude Code.

```bash
git clone https://github.com/<you>/prompt-enhancer.git ~/prompt-enhancer
```

```bash
node ~/prompt-enhancer/engine/install.js /path/to/your/project
```

Start a new Claude Code session; it runs on your next prompt. The installer edits exactly one file
(`.claude/settings.json`), preserves every setting and hook already in it, backs it up first, and is
safe to run twice.

```bash
node ~/prompt-enhancer/engine/install.js --uninstall    # removes the hooks, keeps your files
```

**It works with zero configuration.** With no knowledge base at all, the stance layer still reads
your prompt and injects a role, a quality bar, an output contract and confirm-before-acting flags
(~3 KB). The grounding layer simply stays quiet until you give it something to retrieve.

See it without starting a session:

```bash
echo '{"prompt":"fix the login bug"}' | node ~/prompt-enhancer/engine/prompt-enhancer.js
```

## Make it yours

All optional, add any time. The engine picks them up on the next prompt.

| Add this file | And you get |
|---|---|
| `.claude/session-guardrail.txt` | your own standing rules, injected verbatim on every prompt |
| `.claude/knowledge/*.md` (with a `purpose:` frontmatter line) | the grounding layer turns itself on and retrieves the relevant sections |
| `LESSONS.md`, `CURRENT_FOCUS.md` at the repo root | past corrections and in-flight work get retrieved too, with a scoring boost |
| `.claude/enhancer.project.json` | `name` and `stack` sharpen the role line; `ticketPattern`, `repos`, `people` are recognised as referents |

`install.js --starter` drops a starter rules file and project JSON for you to edit. It never
overwrites a file you already have.

## How it works

Two layers, independent, each fails open on its own:

**1. Preparation** (`lib/prompt-prepare.js`, `lib/prompt-enrich.js`) — regex intent detection over
your prompt text picks one of 14 intents (`bugfix`, `review`, `design`, `comms`, `data`, …) and a
domain, then renders only the sections whose detectors fire. On real usage: `role`, `quality_bar`,
`output_contract` and `done_when` apply to every task; `scope_discipline` fires on 16% of prompts,
`confirm_before_acting` on 16%, `parts` (multi-part asks) on 13%. A thin prompt gets a shorter bar,
not a longer one — over-prompting a simple question makes the answer worse.

**2. Grounding** (`lib/kb-retrieval.js`) — BM25 over your `.claude/knowledge/*.md`, `LESSONS.md` and
`CURRENT_FOCUS.md`, packed to a ~12 KB budget, tagged as reference material rather than instructions.

Both are local regex and arithmetic. Nothing is sent anywhere. An earlier version of this tool did
send the prompt to an external model for rewriting; that was removed after it invented schema
columns and once inverted an explicit instruction. Claude already has your conversation — handing it
the retrieved context directly beats paying a second, context-free model to guess at your meaning.

## The log

The installer wires **two** hooks, which both write `.claude/enhancer-log.md`:

| hook | records |
|---|---|
| `prompt-enhancer.js` (`UserPromptSubmit`) | your prompt, detected intent and domain, which KB files were retrieved, which sections were injected |
| `refined-prompt-logger.js` (`Stop`) | your prompt paired with the one-line restatement Claude opened with — the pairs in [`EXAMPLES.md`](EXAMPLES.md) |

On by default, because it is how you find out whether it is working and which pattern to tune when
it isn't. Local, rotated at 1 MB, never leaves your machine — but it holds your prompts verbatim, so:

- `ENHANCER_LOG=0` turns off all logging, both hooks.
- `install.js --no-logger` skips the `Stop` hook; you keep the injection side only.
- In a git repo the installer writes `.claude/.gitignore` so `git add .` can't commit it.

**Switches:** `ENHANCER_OFF=1` disables the hook · `ENRICH_OFF=1` keeps grounding, drops the stance
layer · `ENHANCER_LOG=0` disables logging. Every failure path is fail-open: a broken config, an
unreadable file or a crash can never block or delay your prompt.

---

## The benchmark

`RESULTS.md` is not a vibes check. The experiment that produced it ships in this repo, so you can
re-run it or disagree with it.

| | |
|---|---|
| **Codebase** | `lujakob/nestjs-realworld-example-app` @ `c1c2cc4`, vendored — a public NestJS app with *real* bug reports (#88 plaintext password on update, #6/#44 anyone can edit any article, #79 bad token → 500, #112 mass assignment, #57 bare entity instead of envelope) |
| **24 traps** | 12 *grounding* (the answer is a fact in the KB) and 12 *stance* (thin, vague, multi-part, risky, format-constrained). Each has regex checks verified against the source and a ground-truth key written from the code |
| **3 arms** | no hook · a static rules file only · the full enhancer. The only difference is the injection — model, tools, permissions and working directory are identical |
| **216 runs** | 24 traps × 3 arms × 3 repeats, fresh headless sessions, read-only tools, no MCP, shuffled order. Failed API calls are recorded as failures and re-run, never scored |
| **2 scorers** | regex traps (can't be charmed) and a blind pairwise judge — a different model, arm hidden, positions swapped, 288 verdicts |

```bash
node run.js          # 216 answers via claude -p (needs the CLI logged in)
node rescore.js      # re-grade saved answers after editing a trap — no re-spend
node judge.js        # 288 blind pairwise verdicts
node report.js       # writes RESULTS.md
```

Every raw answer and the exact text each hook injected is committed under
`results/<runId>/runs/`. `RESULTS.md` also carries the limitations and the corrections made during
the run — including seven scoring bugs of mine that made the tool look better than it was, which is
why `rescore.js` exists.

## Layout

```
engine/                     the hook
  prompt-enhancer.js          UserPromptSubmit: the stance + grounding injector
  refined-prompt-logger.js    Stop: logs what Claude understood you to mean
  install.js                  one-command install / uninstall
  lib/                        config (all tunables), retrieval, intent, preparation
fixture/                    the benchmarked codebase + a realistic knowledge base
traps/                      24 prompts with mechanical checks (build-traps.js is the source)
arms/                       the three settings files the benchmark compares
run.js · rescore.js · judge.js · report.js
results/<runId>/            every raw answer, the injected text, summary.md, judge.md
EXAMPLES.md                 real prompt → restatement pairs from daily use
RESULTS.md                  the numbers · PLAN.md the method and the prediction
```

## Licence

MIT — see [`LICENSE`](LICENSE). The vendored fixture is MIT from
[`lujakob/nestjs-realworld-example-app`](https://github.com/lujakob/nestjs-realworld-example-app);
see [`NOTICE`](NOTICE).
