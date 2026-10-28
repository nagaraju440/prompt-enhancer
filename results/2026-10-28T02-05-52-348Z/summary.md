# Benchmark run 2026-10-28T02-05-52-348Z

- model: `claude-sonnet-5-5` · cli: `2.1.172 (Claude Code)`
- traps: 1 · arms: arm0-none, arm1-rules, arm2-full · repeats: 3 · runs: 9
- started: 2026-10-28T02:05:52.359Z · finished: 2026-10-28T02:06:46.035Z

## Headline — trap pass rate (all outcome checks passed; higher is better)

| arm | runs | failed | trap pass | grounding | stance | check pass | compliance | turns | wall (s) | in-tok | cache-read | out-tok | injected chars | total $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| arm0-none | 3 | 0 | **100%** | n/a | 100% | 100% | 50% | 4.7 | 16 | 2391 | 89131 | 939 | 0 | 0.39 |
| arm1-rules | 3 | 0 | **100%** | n/a | 100% | 100% | 100% | 5.0 | 19 | 3067 | 107578 | 1225 | 1976 | 0.62 |
| arm2-full | 3 | 0 | **100%** | n/a | 100% | 100% | 100% | 4.0 | 17 | 3263 | 87846 | 914 | 14034 | 0.49 |

## Per trap (passes / scored runs)

| trap | group | arm0-none | arm1-rules | arm2-full | lesson |
|---|---|---|---|---|---|
| s11-shortly-401-vs-400 | stance | 3/3 | 3/3 | 3/3 | "shortly" is the requirement; answer first, cite, stop. |

## Per check (passes / scored runs) — where exactly each arm falls

| trap | check | arm0-none | arm1-rules | arm2-full |
|---|---|---|---|---|
| s11-shortly-401-vs-400 | login-401-source | 3/3 | 3/3 | 3/3 |
| s11-shortly-401-vs-400 | register-400-source | 3/3 | 3/3 | 3/3 |
| s11-shortly-401-vs-400 | is-short | 3/3 | 3/3 | 3/3 |

> Raw responses for every run are in `runs/`, with the exact injected text for arms 1 and 2. Re-score them yourself.
> Trap pass = ALL outcome checks passed, scored on the answer with the `**Refined prompt:**` line removed.
> Compliance (restatement line, file:line citation) is excluded from the headline on purpose: the enhancer
> instructs it, so winning it proves obedience, not quality.
