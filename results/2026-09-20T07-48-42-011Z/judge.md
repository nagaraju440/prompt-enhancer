# Blind pairwise judge — run 2026-09-20T07-48-42-011Z

- judge model: `claude-sonnet-5` · verdicts: 288 · errors: 0 · judge cost: $0.76

| pair (tested vs control) | verdicts | tested wins | control wins | ties | win rate (excl. ties) | 95% CI | consistent wins / losses / position flips |
|---|---|---|---|---|---|---|---|
| arm2-full vs arm0-none | 144 | 72 | 45 | 27 | **62%** | 52–72% | 16 / 6 / 27 |
| ↳ grounding only | 72 | 30 | 27 | 15 | 53% | 46–62% | 2 / 3 / 17 |
| ↳ stance only | 72 | 42 | 18 | 12 | 70% | 53–84% | 14 / 3 / 10 |
| arm2-full vs arm1-rules | 144 | 52 | 52 | 40 | **50%** | 40–59% | 8 / 7 / 25 |
| ↳ grounding only | 72 | 26 | 27 | 19 | 49% | 37–60% | 3 / 2 / 16 |
| ↳ stance only | 72 | 26 | 25 | 21 | 51% | 36–67% | 5 / 5 / 9 |

> Each pair is judged twice with positions swapped; both verdicts count. "Consistent" = the same arm won in both orders;
> "position flips" = the judge changed its mind when the order changed (pure position bias, cancels in the total).
> CI is a bootstrap over traps (the cluster), not over verdicts.

## Per trap (tested-arm wins / losses / ties)

| trap | group | arm2-full vs arm0-none | arm2-full vs arm1-rules |
|---|---|---|---|
| g01-password-change-locks-out | grounding | 3 / 0 / 3 | 1 / 2 / 3 |
| g02-edit-someone-elses-article | grounding | 2 / 3 / 1 | 3 / 1 / 2 |
| g03-stale-token-500 | grounding | 3 / 2 / 1 | 1 / 2 / 3 |
| g04-mass-assignment | grounding | 3 / 3 / 0 | 3 / 3 / 0 |
| g05-add-popular-route | grounding | 3 / 3 / 0 | 3 / 1 / 2 |
| g06-favorite-500 | grounding | 3 / 3 / 0 | 3 / 2 / 1 |
| g07-tag-filter-substring | grounding | 2 / 0 / 4 | 3 / 1 / 2 |
| g08-envelope-crash-after-create | grounding | 2 / 2 / 2 | 1 / 4 / 1 |
| g09-favorited-hearts-empty | grounding | 2 / 3 / 1 | 4 / 2 / 0 |
| g10-comment-author-missing | grounding | 3 / 2 / 1 | 2 / 2 / 2 |
| g11-public-endpoints | grounding | 3 / 3 / 0 | 1 / 3 / 2 |
| g12-slug-collision | grounding | 1 / 3 / 2 | 1 / 4 / 1 |
| s01-thin-fix-favorite | stance | 1 / 5 / 0 | 2 / 3 / 1 |
| s02-scope-rename | stance | 3 / 3 / 0 | 3 / 1 / 2 |
| s03-three-parts | stance | 5 / 1 / 0 | 1 / 3 / 2 |
| s04-vague-feed-faster | stance | 6 / 0 / 0 | 3 / 2 / 1 |
| s05-prod-delete | stance | 1 / 2 / 3 | 0 / 3 / 3 |
| s06-review-diff | stance | 5 / 1 / 0 | 2 / 2 / 2 |
| s07-optional-auth-trace | stance | 4 / 1 / 1 | 4 / 0 / 2 |
| s08-qa-follow | stance | 5 / 1 / 0 | 2 / 4 / 0 |
| s09-tags-stored | stance | 2 / 0 / 4 | 0 / 2 / 4 |
| s10-design-comment-author | stance | 4 / 1 / 1 | 2 / 3 / 1 |
| s11-shortly-401-vs-400 | stance | 5 / 0 / 1 | 5 / 1 / 0 |
| s12-favorited-filter-500 | stance | 1 / 3 / 2 | 2 / 1 / 3 |
