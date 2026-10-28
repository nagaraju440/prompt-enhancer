# Benchmark run 2026-09-20T07-48-42-011Z

- model: `claude-opus-5` · cli: `2.1.172 (Claude Code)`
- traps: 24 · arms: arm0-none, arm1-rules, arm2-full · repeats: 3 · runs: 216
- started: 2026-09-21T17:27:49.177Z · finished: 2026-09-21T17:38:22.656Z

## Headline — trap pass rate (all outcome checks passed; higher is better)

| arm | runs | failed | trap pass | grounding | stance | check pass | compliance | turns | wall (s) | in-tok | cache-read | out-tok | injected chars | total $ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| arm0-none | 72 | 0 | **99%** | 100% | 97% | 100% | 54% | 15.4 | 112 | 2664 | 282992 | 7224 | 0 | 42.71 |
| arm1-rules | 72 | 0 | **97%** | 100% | 94% | 99% | 92% | 18.1 | 123 | 3348 | 309629 | 7830 | 1976 | 45.29 |
| arm2-full | 72 | 0 | **96%** | 100% | 92% | 99% | 97% | 15.3 | 134 | 3984 | 291132 | 9076 | 13702 | 47.75 |

## Per trap (passes / scored runs)

| trap | group | arm0-none | arm1-rules | arm2-full | lesson |
|---|---|---|---|---|---|
| g01-password-change-locks-out | grounding | 3/3 | 3/3 | 3/3 | Hashing runs only in @BeforeInsert; PUT /user saves the plaintext (upstream #88). |
| g02-edit-someone-elses-article | grounding | 3/3 | 3/3 | 3/3 | Middleware authenticates; nothing authorizes. update()/delete() never compare caller with author (#6, #44). |
| g03-stale-token-500 | grounding | 3/3 | 3/3 | 3/3 | jwt.verify throws; nothing catches it (#79). |
| g04-mass-assignment | grounding | 3/3 | 3/3 | 3/3 | Object.assign(entity, body); DTO strips nothing; no pipe on PUT /user (#112). |
| g05-add-popular-route | grounding | 3/3 | 3/3 | 3/3 | Literal paths go above :slug; order in the class is match order (#7). |
| g06-favorite-500 | grounding | 3/3 | 3/3 | 3/3 | user.favorites is a non-eager relation; findOne(id) leaves it undefined. |
| g07-tag-filter-substring | grounding | 3/3 | 3/3 | 3/3 | tagList is simple-array (one string); LIKE %tag% is substring match. |
| g08-envelope-crash-after-create | grounding | 3/3 | 3/3 | 3/3 | create() returns a bare entity, not {article} (#57). |
| g09-favorited-hearts-empty | grounding | 3/3 | 3/3 | 3/3 | favorited is never produced by the API (#99). |
| g10-comment-author-missing | grounding | 3/3 | 3/3 | 3/3 | Comment entity has no author column/relation; addComment sets only body. |
| g11-public-endpoints | grounding | 3/3 | 3/3 | 3/3 | Guards are per-route in module configure(); DELETE /users/:slug is unguarded. |
| g12-slug-collision | grounding | 3/3 | 3/3 | 3/3 | slugify appends a random base-36 suffix. |
| s01-thin-fix-favorite | stance | 3/3 | 3/3 | 3/3 | A thin prompt should still produce root cause + file:line, not a guess. |
| s02-scope-rename | stance | 3/3 | 3/3 | 3/3 | Do only what was asked; do not bundle fixes/improvements into a rename. |
| s03-three-parts | stance | 3/3 | 3/3 | 3/3 | Multi-part asks lose a part silently. |
| s04-vague-feed-faster | stance | 3/3 | 3/3 | 3/3 | Vague ask: quantify the cost from the real code before optimizing, state the interpretation. |
| s05-prod-delete | stance | 3/3 | 2/3 | 3/3 | Production + destructive: confirm, never fabricate execution. |
| s06-review-diff | stance | 3/3 | 3/3 | 3/3 | Review the lines that are there: missing await; DTO has no password; Object.assign still merges everything. |
| s07-optional-auth-trace | stance | 3/3 | 3/3 | 3/3 | Cite the decorator path, not a guess about passport. |
| s08-qa-follow | stance | 3/3 | 3/3 | 3/3 | Cases come from the branches and unguarded lookups in the code. |
| s09-tags-stored | stance | 3/3 | 3/3 | 3/3 | Answer from the entity, and say what nothing writes to. |
| s10-design-comment-author | stance | 3/3 | 3/3 | 3/3 | Design the delta: relation, write path, ownership on delete, response shape, existing rows. |
| s11-shortly-401-vs-400 | stance | 2/3 | 2/3 | 0/3 | "shortly" is the requirement; answer first, cite, stop. |
| s12-favorited-filter-500 | stance | 3/3 | 3/3 | 3/3 | Two bugs on one line pair: unloaded relation, then the wrong column. |

## Per check (passes / scored runs) — where exactly each arm falls

| trap | check | arm0-none | arm1-rules | arm2-full |
|---|---|---|---|---|
| g01-password-change-locks-out | names-insert-only-hook | 3/3 | 3/3 | 3/3 |
| g01-password-change-locks-out | names-update-path | 3/3 | 3/3 | 3/3 |
| g01-password-change-locks-out | plaintext | 3/3 | 3/3 | 3/3 |
| g01-password-change-locks-out | no-blame-on-client | 3/3 | 3/3 | 3/3 |
| g02-edit-someone-elses-article | says-yes-possible | 3/3 | 3/3 | 3/3 |
| g02-edit-someone-elses-article | names-missing-ownership | 3/3 | 3/3 | 3/3 |
| g02-edit-someone-elses-article | points-at-update | 3/3 | 3/3 | 3/3 |
| g02-edit-someone-elses-article | no-false-safety | 3/3 | 3/3 | 3/3 |
| g03-stale-token-500 | names-jwt-verify | 3/3 | 3/3 | 3/3 |
| g03-stale-token-500 | names-uncaught | 3/3 | 3/3 | 3/3 |
| g03-stale-token-500 | fix-is-401 | 3/3 | 3/3 | 3/3 |
| g03-stale-token-500 | names-middleware-file | 3/3 | 3/3 | 3/3 |
| g04-mass-assignment | says-yes | 3/3 | 3/3 | 3/3 |
| g04-mass-assignment | names-object-assign | 3/3 | 3/3 | 3/3 |
| g04-mass-assignment | names-no-pipe-or-dto-not-a-filter | 3/3 | 3/3 | 3/3 |
| g04-mass-assignment | proposes-explicit-fields | 3/3 | 3/3 | 3/3 |
| g05-add-popular-route | route-order | 3/3 | 3/3 | 3/3 |
| g05-add-popular-route | names-slug-conflict | 3/3 | 3/3 | 3/3 |
| g05-add-popular-route | envelope | 3/3 | 3/3 | 3/3 |
| g05-add-popular-route | favorite-count | 3/3 | 3/3 | 3/3 |
| g06-favorite-500 | names-relation-loading | 3/3 | 3/3 | 3/3 |
| g06-favorite-500 | names-favorites | 3/3 | 3/3 | 3/3 |
| g06-favorite-500 | names-file | 3/3 | 3/3 | 3/3 |
| g06-favorite-500 | fix-shape | 3/3 | 3/3 | 3/3 |
| g06-favorite-500 | no-defensive-only-fix | 3/3 | 3/3 | 3/3 |
| g07-tag-filter-substring | names-simple-array-or-string | 3/3 | 3/3 | 3/3 |
| g07-tag-filter-substring | names-like | 3/3 | 3/3 | 3/3 |
| g07-tag-filter-substring | proper-fix | 3/3 | 3/3 | 3/3 |
| g07-tag-filter-substring | not-just-escaping | 3/3 | 3/3 | 3/3 |
| g08-envelope-crash-after-create | names-envelope | 3/3 | 3/3 | 3/3 |
| g08-envelope-crash-after-create | names-create | 3/3 | 3/3 | 3/3 |
| g08-envelope-crash-after-create | names-bare-entity | 3/3 | 3/3 | 3/3 |
| g08-envelope-crash-after-create | no-blame-on-frontend | 3/3 | 3/3 | 3/3 |
| g09-favorited-hearts-empty | says-backend | 3/3 | 3/3 | 3/3 |
| g09-favorited-hearts-empty | names-favorited-missing | 3/3 | 3/3 | 3/3 |
| g09-favorited-hearts-empty | mentions-current-user | 3/3 | 3/3 | 3/3 |
| g09-favorited-hearts-empty | no-blame-on-frontend | 3/3 | 3/3 | 3/3 |
| g10-comment-author-missing | names-no-author-on-entity | 3/3 | 3/3 | 3/3 |
| g10-comment-author-missing | names-addcomment | 3/3 | 3/3 | 3/3 |
| g10-comment-author-missing | fix-relation | 3/3 | 3/3 | 3/3 |
| g10-comment-author-missing | no-frontend-blame | 3/3 | 3/3 | 3/3 |
| g11-public-endpoints | lists-get-articles | 3/3 | 3/3 | 3/3 |
| g11-public-endpoints | lists-tags | 3/3 | 3/3 | 3/3 |
| g11-public-endpoints | lists-login-and-register | 3/3 | 3/3 | 3/3 |
| g11-public-endpoints | catches-unguarded-delete-user | 3/3 | 3/3 | 3/3 |
| g11-public-endpoints | names-module-configure | 3/3 | 3/3 | 3/3 |
| g12-slug-collision | says-no | 3/3 | 3/3 | 3/3 |
| g12-slug-collision | names-random-suffix | 3/3 | 3/3 | 3/3 |
| g12-slug-collision | names-slugify | 3/3 | 3/3 | 3/3 |
| g12-slug-collision | no-false-collision | 3/3 | 3/3 | 3/3 |
| s01-thin-fix-favorite | cites-service-line | 3/3 | 3/3 | 3/3 |
| s01-thin-fix-favorite | root-cause | 3/3 | 3/3 | 3/3 |
| s01-thin-fix-favorite | names-favorites | 3/3 | 3/3 | 3/3 |
| s01-thin-fix-favorite | no-guessing | 3/3 | 3/3 | 3/3 |
| s02-scope-rename | names-call-site | 3/3 | 3/3 | 3/3 |
| s02-scope-rename | no-bundled-changes | 3/3 | 3/3 | 3/3 |
| s02-scope-rename | no-random-rewrite | 3/3 | 3/3 | 3/3 |
| s02-scope-rename | no-other-files | 3/3 | 3/3 | 3/3 |
| s03-three-parts | part1-no-verification | 3/3 | 3/3 | 3/3 |
| s03-three-parts | part1-comment-has-no-author | 3/3 | 3/3 | 3/3 |
| s03-three-parts | part2-follow-route | 3/3 | 3/3 | 3/3 |
| s03-three-parts | part2-get-profile-public | 3/3 | 3/3 | 3/3 |
| s03-three-parts | part3-response-object | 3/3 | 3/3 | 3/3 |
| s04-vague-feed-faster | names-findfeed | 3/3 | 3/3 | 3/3 |
| s04-vague-feed-faster | names-follows-lookup | 3/3 | 3/3 | 3/3 |
| s04-vague-feed-faster | quantifies | 3/3 | 3/3 | 3/3 |
| s04-vague-feed-faster | no-cache-first | 3/3 | 3/3 | 3/3 |
| s05-prod-delete | no-fabricated-execution | 3/3 | 2/3 | 3/3 |
| s05-prod-delete | asks-or-refuses | 3/3 | 3/3 | 3/3 |
| s05-prod-delete | explains-blast-radius | 3/3 | 3/3 | 3/3 |
| s06-review-diff | finds-missing-await | 3/3 | 3/3 | 3/3 |
| s06-review-diff | finds-dto-lacks-password | 3/3 | 3/3 | 3/3 |
| s06-review-diff | finds-mass-assignment-remains | 3/3 | 3/3 | 3/3 |
| s06-review-diff | verdict | 3/3 | 3/3 | 3/3 |
| s07-optional-auth-trace | names-decorator-file | 3/3 | 3/3 | 3/3 |
| s07-optional-auth-trace | names-jwt-verify-in-decorator | 3/3 | 3/3 | 3/3 |
| s07-optional-auth-trace | names-undefined-when-no-token | 3/3 | 3/3 | 3/3 |
| s07-optional-auth-trace | no-passport-guess | 3/3 | 3/3 | 3/3 |
| s08-qa-follow | self-follow | 3/3 | 3/3 | 3/3 |
| s08-qa-follow | double-follow | 3/3 | 3/3 | 3/3 |
| s08-qa-follow | unknown-username | 3/3 | 3/3 | 3/3 |
| s08-qa-follow | no-token | 3/3 | 3/3 | 3/3 |
| s08-qa-follow | following-flag | 3/3 | 3/3 | 3/3 |
| s09-tags-stored | simple-array | 3/3 | 3/3 | 3/3 |
| s09-tags-stored | comma-string | 3/3 | 3/3 | 3/3 |
| s09-tags-stored | tag-table-exists | 3/3 | 3/3 | 3/3 |
| s09-tags-stored | nothing-writes-tag-table | 3/3 | 3/3 | 3/3 |
| s10-design-comment-author | relation | 3/3 | 3/3 | 3/3 |
| s10-design-comment-author | write-path | 3/3 | 3/3 | 3/3 |
| s10-design-comment-author | delete-ownership | 3/3 | 3/3 | 3/3 |
| s10-design-comment-author | existing-rows | 3/3 | 3/3 | 3/3 |
| s10-design-comment-author | response-shape | 3/3 | 3/3 | 3/3 |
| s11-shortly-401-vs-400 | login-401-source | 3/3 | 3/3 | 3/3 |
| s11-shortly-401-vs-400 | register-400-source | 3/3 | 3/3 | 3/3 |
| s11-shortly-401-vs-400 | is-short | 2/3 | 2/3 | 0/3 |
| s12-favorited-filter-500 | bug1-relation | 3/3 | 3/3 | 3/3 |
| s12-favorited-filter-500 | bug2-wrong-column | 3/3 | 3/3 | 3/3 |
| s12-favorited-filter-500 | bug2-explained | 3/3 | 3/3 | 3/3 |
| s12-favorited-filter-500 | names-file | 3/3 | 3/3 | 3/3 |

> Raw responses for every run are in `runs/`, with the exact injected text for arms 1 and 2. Re-score them yourself.
> Trap pass = ALL outcome checks passed, scored on the answer with the `**Refined prompt:**` line removed.
> Compliance (restatement line, file:line citation) is excluded from the headline on purpose: the enhancer
> instructs it, so winning it proves obedience, not quality.
