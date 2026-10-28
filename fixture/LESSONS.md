# Lessons Learned — RealWorld API (NestJS)

Corrections recorded from real bug reports on this codebase (upstream GitHub issue numbers in
brackets — see https://github.com/lujakob/nestjs-realworld-example-app/issues). Each one is a
rule for how to work here, with the incident that produced it. Do NOT repeat these.

## A lifecycle hook that hashes on insert does not run on update (#88)

**What happened:** `PUT /user` with `{ "user": { "password": "newpassword" } }` wrote the string
`newpassword` into the `password` column. `UserEntity.hashPassword()` is `@BeforeInsert()` only;
`UserService.update()` does `Object.assign(toUpdate, dto)` and saves, so the plaintext went
straight to MySQL. Users who changed their password could never log in again — `argon2.verify`
compares the typed password against a non-hash and fails.

**Rule:** every write path a secret can travel must hash it explicitly, and `@BeforeInsert`
covers exactly one of them. When you see a hook, ask which lifecycle events it does NOT cover.

## Authentication is not authorization (#6, #44)

**What happened:** any logged-in user could `PUT` or `DELETE` any other user's article. The
route is in `AuthMiddleware`'s list, so people assumed it was "protected" — but the middleware
only proves the caller is *a* user, and `ArticleService.update()/delete()` never compare
`req.user.id` with `article.author.id`. The Swagger `403 Forbidden` annotations on those handlers
describe a check that does not exist.

**Rule:** for every mutating route, name the line that compares the caller with the record's
owner. If you cannot, there is no ownership check, whatever the decorators say.

## An invalid token must be a 401, not a 500 (#79)

**What happened:** an expired or tampered token made `jwt.verify()` throw inside
`AuthMiddleware.use()` (and inside the `@User()` decorator on public routes). Nothing caught it,
so the client got `500 Internal Server Error` and the mobile app treated it as an outage instead
of logging the user out.

**Rule:** wrap `jwt.verify` and translate its errors to `HttpStatus.UNAUTHORIZED`. A guard that
can crash is a guard that leaks framework errors.

## Never `Object.assign` a request body onto a persisted entity (#112)

**What happened:** `UserService.update()` and `ArticleService.update()` both merge the raw body
into the loaded entity. Any extra field the client sends — `id`, `password`, `authorId`,
`favoriteCount` — is persisted. The DTO type is a TypeScript annotation; it strips nothing at
runtime, and `PUT /user` / `PUT /articles/:slug` have no validation pipe.

**Rule:** copy the allowed fields by name, or whitelist with a validation pipe
(`whitelist: true, forbidNonWhitelisted: true`). The DTO class is not a filter.

## Every handler returns the RO envelope, never a bare entity (#57)

**What happened:** `ArticleController.create()` returned `ArticleEntity` directly while every
other handler returns `{ article }`. The React frontend read `response.article.slug` → `Cannot
read property 'slug' of undefined` right after creating an article. The server logged nothing —
from its side the request succeeded.

**Rule:** the envelope (`ArticleRO`, `UserRO`, …) is the contract with every RealWorld client.
A handler whose return type is not a `*RO` interface is a bug even if it "works" in Postman.

## Static routes are declared before parameterised ones (#7)

**What happened:** `GET /articles/feed` was declared *after* `GET /articles/:slug`, so Nest
matched `feed` as a slug and the feed endpoint returned `{ article: undefined }`. Fixed by moving
`getFeed()` above `findOne()` in `ArticleController`.

**Rule:** in a controller, any literal path (`feed`, `popular`, `search`) goes above the `:slug`
handler. Order in the class is match order.

## A relation that is not eager is `undefined`, not `[]`

**What happened:** `ArticleService.favorite()` loads the user with `findOne(id)` and then calls
`user.favorites.findIndex(...)`. `favorites` is a non-eager `@ManyToMany`, so it is `undefined`
→ `TypeError: Cannot read property 'findIndex' of undefined` → 500 on
`POST /articles/:slug/favorite`. Same pattern in `findAll()` for `?favorited=` (`author.favorites.map`).

**Rule:** before touching `entity.relation` in a service, find the `relations: [...]` or the
`eager: true` that loads it. If neither exists, the property is `undefined`.

## `simple-array` is a string; `LIKE %x%` matches substrings

**What happened:** `GET /articles?tag=java` returned articles tagged `javascript`, because
`tagList` is one comma-joined column and the filter is `article.tagList LIKE '%java%'`.

**Rule:** a `simple-array` filter needs delimiter-aware matching (e.g. compare against
`,java,` on `CONCAT(',', tagList, ',')`, or `FIND_IN_SET`), or a real join table.

## The `?favorited=` filter compares the wrong column

**What happened:** `findAll()` collects the ids of the articles a user favourited and then
filters `article.authorId IN (:ids)` — the article ids are being compared to author ids. Even
once the `favorites` relation is loaded, the result is wrong.

**Rule:** when a filter is "articles in this set", the column is `article.id`. Read the
`andWhere` literally; do not trust the variable name.

## Spec fields the frontends read must actually be produced (#99, #45)

**What happened:** article responses never include `favorited`, so every RealWorld frontend
renders an empty heart even for articles the user favourited. The spec's `favoritesCount` is
served as `favoriteCount`, and `createdAt/updatedAt` as `created/updated`.

**Rule:** the RealWorld spec is the contract. Before calling an endpoint "done", diff its
response against the spec's object shape, not against what our own client happens to read.
