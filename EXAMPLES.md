# Real prompts, real enhancements

These are **actual log entries** from one engineer's daily use of this hook — 2,720 typed prompts
across four months on a production codebase, of which 1,378 ran with the stance layer live.
Identifiers are replaced — ticket keys renumbered, repo, people and host names genericised, Slack
IDs masked; **nothing else is edited** — the prompts are as typed, including the typos and the "bro".

## How to read these

The hook does **not** rewrite your prompt. It injects a block before it — a role, a quality bar, an
output contract, and flags like *confirm before acting*. One line in that block asks Claude to open
with a one-line restatement of what it understood. The log captures both halves:

- **You typed** — your prompt, verbatim.
- **The hook detected** — what the local regex layer classified it as, in ~150 ms, with no model call.
- **Claude restated it as** — the first line of the answer, which is where you find out whether it
  understood you *before* it spends five minutes on the wrong thing.

That restatement is the visible payoff: **the ambiguity gets resolved out loud, where you can catch it.**

---

## 1. It resolves "it", "that", "there"

> **You typed:** `is it done now?`
>
> **The hook detected:** `explain` · no KB retrieval (nothing to anchor on) · restatement optional
>
> **Claude restated it as:** *"Has the `prod-snapshot` restore finished yet? · Assumptions: "it" means that restore."*

Four words. The assumption is stated, so if "it" meant something else you lose one line, not one answer.

---

## 2. It surfaces the assumption you didn't know you were making

> **You typed:** `foundation already done right ?`
>
> **The hook detected:** `explain` · KB: focus file, lessons, two repo notes · restatement optional
>
> **Claude restated it as:** *"Say whether the foundation is finished, and if not, what's missing and why. · Assumptions: "foundation" means part 1 of the agreed 11-part plan."*

The leading question ("…right?") does not get a reflexive yes. The restatement names which of eleven
parts it is answering about.

---

## 3. It refuses to send things on your behalf

> **You typed:** `Check <teammate>'s reply on Slack`
>
> **The hook detected:** `comms` · domain `slack` · restatement **required**
>
> **Claude restated it as:** *"Read <teammate>'s reply in the Slack thread, record whatever is clear, and draft a follow-up for anything still unclear. · Assumptions: nothing gets sent until you say 'send it'."*

The `comms` stance carries a draft-first rule. "Check the reply" never silently becomes "reply".

---

## 4. It stops before a mistake rather than after

> **You typed:** `His slack id is U04XXXXXXXX, send it`
>
> **The hook detected:** `comms` · section `confirm_before_acting` fired on the word "send"
>
> **Claude restated it as:** *"Send the ISSUE-199 PR summary to <teammate> on Slack using ID `U04XXXXXXXX`. · Assumption: none — I'm pausing on a likely wrong recipient before sending."*

An explicit "send it" — and it still paused, because the ID didn't match the person named earlier in
the thread. This is the one that pays for the whole hook.

---

## 5. It keeps a fix to the thing you asked about

> **You typed:** `Yes, fix 29962 locally. Do not commit or push.`
>
> **The hook detected:** `bugfix` · sections `scope_discipline` + `confirm_before_acting`
>
> **Claude restated it as:** *"Fix task 29962 locally on the web Step 5 branch: the Edit loader (`EditEventUtil.ts:442`) keeps soft-deleted rooms, and that is the single source of the deleted ids the new API save refuses. Add one filter there. No commit, no push. · Assumptions: the fix is only the filter from the task; API PR 3213 stays as it is."*

Root cause at `file:line`, one filter, nothing else touched — the `bugfix` bar asks for the single
source rather than a patch at each call site, and `scope_discipline` suppresses the bonus refactor.

---

## 6. "Explain simply" is treated as a requirement, not a preference

> **You typed:** `not understood explain simply`
>
> **The hook detected:** `investigate` · KB: focus file, decisions, review playbook
>
> **Claude restated it as:** *"Explain the unpin problem again in the simplest words, with an everyday example. · Assumptions: no code this time."*

---

## 7. It makes a vague build request concrete before building

> **You typed:** `what you will build bro ?`
>
> **The hook detected:** `implement` · KB: 4 repo notes · `scope_discipline` fired
>
> **Claude restated it as:** *"List in plain words the exact things I'd build, where each lives and what it does, so you can say yes or no to each. · Assumptions: you want the concrete list, not the reasoning again."*

---

## 8. It never routes a secret through the chat

> **You typed:** `no i will set new PAT token how to set`
>
> **The hook detected:** `security` · restatement **required**
>
> **Claude restated it as:** *"Give the steps to create a new issue-tracker PAT and save it so both the connector and my REST calls can use it, without the token ever going through chat. · Assumptions: issue tracker only. I'll check the wiki after you've done this."*

---

## 9. One word, a full brief

> **You typed:** `Continue`
>
> **The hook detected:** no retrieval anchor — a continuation, so grounding stayed quiet
>
> **Claude restated it as:** *"Re-review ISSUE-205 (web #9995, api #3101, rollout #243) with the upgraded process: the pre-check script, one agent per PR that re-verifies every task (yours, the other reviewer's and mine), the completeness gate, then post new tasks and replies. · Assumptions: the fourth PR stays out of scope, as you said earlier; old-format code is removed in these PRs."*

The shortest possible prompt. The restatement names three pull requests, the process, and a scope
decision made earlier in the conversation — all of which I'd otherwise have had to re-type or hope
it remembered.

---

## 10. It picks up the instruction buried in the aside

> **You typed:** `check from the prod snapshot and tell me bro dont assume`
>
> **The hook detected:** `data` · `confirm_before_acting` fired on the production reference
>
> **Claude restated it as:** *"Re-run the EXPLAIN ANALYZE on the local prod snapshot for program 1117903, the one from the incident. Measure the real prod-sized timings and table sizes instead of guessing from the test environment, and report only measured numbers. Read-only; the snapshot is confidential, so no PII."*

"dont assume" became *"report only measured numbers"*. The read-only and no-PII rules came from the
standing-rules file, not from the prompt — I didn't have to remember to say them.

---

## 11. "Simply" is obeyed, not noted and ignored

> **You typed:** `Can you explain simply what exactly the issue is here?`
>
> **The hook detected:** `explain` · the thinnest stance in the table — one directive, no quality-bar pile-on
>
> **Claude restated it as:** *"Explain the 403 on `POST /courses` in plain words. No jargon, no recap. · Assumptions: you want the cause only, not the fix options."*

Worth showing because it is the opposite failure mode to the one the benchmark caught. The judge's
complaint when the hook *lost* was padding — so the `explain` intent is deliberately the thinnest
one, and "simply" is treated as a requirement rather than a preference.

---

## 12. It treats an offhand "yes" as the consent it was

> **You typed:** `yes do it and send <colleague>`
>
> **The hook detected:** `comms` · `confirm_before_acting` fired on "send"
>
> **Claude restated it as:** *"[…the two-part query change…] Then check it on the test environment, update the doc and the SQL file, and send <colleague> a note. · Assumptions: your 'send <colleague>' counts as the go-ahead."*

The draft-first rule means nothing gets sent without an explicit go-ahead — so when you *do* give
one, it says out loud that it heard it. You find out it is about to send *before* it sends.

---

## What the log says in aggregate

From 1,378 typed prompts logged with the stance layer live (2026-08-13 → 2026-10-28):

| | |
|---|---|
| Median prompt length | **22 words** · 20% were under 10 words · 25% were 11 or fewer |
| Knowledge-base retrieval fired | **89%** of prompts |
| Budget forced a section to be dropped | **1%** of prompts |
| Restatement marked *required* (not merely offered) | **52%** |

**What kind of work it detected** — the stance is picked per prompt, not fixed:

| intent | share | | intent | share |
|---|---|---|---|---|
| explain | 36% | | implement | 4% |
| investigate | 20% | | design | 3% |
| bugfix | 10% | | security | 2% |
| review | 9% | | qa · docs · perf · refactor | 1% each |
| comms | 6% | | requirements · rollout | <1% |
| data | 5% | | | |

**Which sections actually fired** — the block is conditional, not a fixed template. Four sections
apply to every real task; the rest appear only when their detector fires, which is what keeps a
simple prompt from being buried:

| section | fires on | what it does |
|---|---|---|
| `role` · `quality_bar` · `output_contract` · `done_when` | 100% | who to be, the bar, the shape, the finish line |
| `detected_work` | 98% | the detected intent and domain |
| `if_underspecified` | 33% | "state your interpretation before starting" |
| `must_address` | 28% | lists the concrete referents so none is silently dropped |
| `scope_discipline` | 16% | only what was asked — no bonus refactors |
| `confirm_before_acting` | 16% | production / destructive / outward-facing |
| `parts` | 13% | multi-part ask — answer every part |
| `preconditions` | 11% | read the named file before claiming anything about it |
| `approach` | 3% | multi-constraint — pick an approach and commit |

> **Honest caveat.** This is one engineer's log on one codebase, and it measures *what the hook did*,
> not *whether the answers were better*. For the second question — measured against a control, with a
> blind judge — see [`RESULTS.md`](RESULTS.md). The short version: on hard prompts a blind judge
> preferred the enhanced answers 70% of the time; a plain static rules file did about as well.

## Keep your own log

Once installed, you get pairs exactly like the ones above for your own prompts, in
`.claude/enhancer-log.md`. Nothing else goes in that file — just what you asked and what Claude
understood. It stays on your machine, is capped at 1 MB, and `ENHANCER_LOG=0` turns it off.

Read it once a week. When a restatement doesn't match what you meant, that is the tool telling you
where it is weak. `ENHANCER_LOG=debug` then adds *why* it chose that stance, which points you at the
pattern to adjust in `engine/lib/enhancer-config.js`.
