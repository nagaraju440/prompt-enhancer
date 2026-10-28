# CURRENT FOCUS — RealWorld API (NestJS)

> Living doc. What is actually in flight right now. Read after LESSONS.md.

## Active now

- [ ] **Spec conformance pass** — make article responses match the RealWorld spec: produce
      `favorited` per current user, rename `favoriteCount` → `favoritesCount` and
      `created/updated` → `createdAt/updatedAt` at the response boundary (not in the DB).
- [ ] **Ownership checks** on `PUT/DELETE /articles/:slug` and `DELETE /articles/:slug/comments/:id`
      — return 403 when the caller is not the author. Design first; the comment case needs a
      `comment.author` relation that does not exist yet.
- [ ] **Password change path** — hash on update (see LESSONS.md #88) and stop the raw body
      being merged into the entity.

## Recently done

- 2021-01 — `getFeed()` moved above `findOne()` in `ArticleController` (route order, #7).
- 2021-01 — Swagger tags and bearer auth wired for all controllers.

## Not doing

- Prisma branch: the `prisma/` folder is a parallel experiment, not the production path. All
  work here targets the TypeORM implementation on `master`.
