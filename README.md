# prompt-enhancer

You type short prompts. Claude guesses what you meant. Sometimes it guesses wrong, and you find out
five minutes later.

This is a hook for Claude Code that fixes the guessing. Before Claude sees your prompt, it adds the
missing half: who to be, what a good answer looks like, what to check first, and when to stop and
ask. It runs on your machine in about 150 ms. No network, no second AI, no dependencies.

**It does not rewrite your prompt.** Your words go through untouched.

```
you type:   fix the 500 on the favorite endpoint

claude also gets:
            You are a senior backend engineer on <your project>.
            1. Locate the exact failing line and quote it as file:line before
               proposing anything.
            2. Name the ROOT CAUSE, not the symptom — and say why it surfaces now.
            3. Fix it at its single source; do not patch each call site.
            Root cause as file:line → the fix → blast radius → how to verify it.
            Only what was asked. No extra features, no cleanup of surrounding code.
            + whatever your project notes say about this code
```

Those are the real words it sends, copied out of the output — just fewer of them, so it fits here.
You can print the whole block for any prompt in one command (see below).

## Does it actually work?

I benchmarked it instead of guessing. 24 real developer questions, 3 setups, 216 runs, then a
**second AI compared the answers without knowing which was which**.

| | |
|---|---|
| Answers judged better **with** the hook | **62%** overall · **70%** on vague or multi-part prompts |
| Did it make answers more *correct*? | **No.** 96–99% right either way on a small codebase |
| Did it beat a plain rules file? | **No.** Dead even |

So: it makes Claude *behave* better, not *know* more. [`RESULTS.md`](RESULTS.md) has the full
numbers, including every case where it did worse. The experiment is in this repo — run it yourself.

Want to see it on real prompts instead of numbers? [`EXAMPLES.md`](EXAMPLES.md) has eight from four
months of daily use, unedited. Including the time I said "send it" and it stopped anyway, because
the recipient looked wrong.

## Install

You need Node 18+. You already have it if you run Claude Code.

```bash
git clone https://github.com/nagaraju440/prompt-enhancer.git ~/prompt-enhancer
```

```bash
node ~/prompt-enhancer/engine/install.js /path/to/your/project
```

Done. Open a new Claude Code session and it works on your next prompt.

To remove it:

```bash
node ~/prompt-enhancer/engine/install.js --uninstall
```

**No setup needed after that.** It reads your prompt and works out the rest. The installer touches
one file (`.claude/settings.json`), keeps everything already in it, backs it up, and does nothing if
you run it twice.

See what it sends, without starting a session:

```bash
echo '{"prompt":"fix the login bug"}' | node ~/prompt-enhancer/engine/prompt-enhancer.js
```

## Make it smarter about your project (optional)

It works out of the box. These make it better, and you can add them whenever.

| Drop this in | What happens |
|---|---|
| `.claude/session-guardrail.txt` | your team's rules get added to every prompt |
| `.claude/knowledge/*.md` | it starts pulling in the notes that match your prompt |
| `LESSONS.md`, `CURRENT_FOCUS.md` in your repo root | past mistakes and current work get pulled in too |
| `.claude/enhancer.project.json` | tell it your project name and stack, so the role line fits |

Run `install.js --starter` and it writes starter versions of those for you to edit. It never
overwrites a file you already have.

## The log

It keeps a simple diary at `.claude/enhancer-log.md`:

```
ORIGINAL:
fix the 500 on favorite

REFINED:
Find why POST /articles/:slug/favorite returns 500 and fix it at its
single source. · Assumptions: the unloaded relation, not the controller.
```

**What you asked, and what Claude thought you meant.** Read it once a week and you'll see straight
away when it misunderstood you — that is the whole value.

It stays on your machine, never gets sent anywhere, and is capped at 1 MB. If your project is a git
repo, the installer adds a `.gitignore` rule so it can't be committed by accident.

- `ENHANCER_LOG=0` — no diary at all
- `ENHANCER_LOG=debug` — also record *why* it chose that stance (only useful when tuning)

## Other switches

- `ENHANCER_OFF=1` — turn the whole hook off for a session
- `ENRICH_OFF=1` — keep project notes, drop the stance

Everything fails safe: a bad config, a missing file or a crash can never block or slow your prompt.
Worst case, you get your prompt exactly as you typed it.

## How it works

Two parts, both plain local code:

**1. The stance.** Simple pattern matching on your words picks one of 14 job types — bug fix, review,
design, data question, message to a colleague — and writes the matching role and quality bar. Each
piece only appears when it's relevant: "only what was asked" shows up on 16% of prompts, "confirm
before acting" on 16%, "answer every part" on 13%. **Short prompts get a shorter bar, not a longer
one** — piling instructions onto a simple question makes the answer worse, and the benchmark shows it.

**2. Your project notes.** A search (BM25, the same ranking search engines use) over your `.claude/knowledge/`
files picks the few sections that match your prompt, up to a 12 KB budget, and labels them as
reference — not as orders.

An earlier version sent your prompt to another AI to rewrite it. That got deleted: it invented
database columns that didn't exist, and once flipped an instruction to its opposite. Claude already
has your conversation. A second AI that doesn't is just guessing.

## What's in here

```
engine/          the hook (install.js puts it to work)
fixture/         the test codebase the benchmark runs against
traps/           the 24 questions, with the checks for each
run.js           runs the benchmark · judge.js the blind comparison
results/         every raw answer from every run, kept so you can check my work
EXAMPLES.md      real prompts, before and after
RESULTS.md       the numbers · PLAN.md how I set it up and what I predicted
```

## Licence

MIT — see [`LICENSE`](LICENSE). The test codebase is MIT from
[`lujakob/nestjs-realworld-example-app`](https://github.com/lujakob/nestjs-realworld-example-app),
see [`NOTICE`](NOTICE).
