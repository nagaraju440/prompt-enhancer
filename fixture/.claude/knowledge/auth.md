---
purpose: How authentication works, which routes are guarded and which are not, and where authorization (ownership) is — and is not — enforced. Load for any question about login, tokens, JWT, permissions, "who can call this", or "without logging in".
tags: auth jwt token middleware AuthMiddleware User decorator protected routes ownership authorization login password secret
---

# Authentication and authorization

## The token

- Issued by `UserService.generateJWT(user)` (`src/user/user.service.ts`): payload
  `{ id, username, email, exp }`, signed with `SECRET` from `src/config.ts`, **expiry 60 days**.
- Returned inside the `UserRO` envelope on `POST /users` (register), `POST /users/login`, and
  `GET /user`.
- Sent by clients as `Authorization: Token <jwt>` (RealWorld convention). The code only ever
  reads `header.split(' ')[1]`, so `Bearer <jwt>` works too — the scheme word is ignored.

## Two ways a request learns who the user is

### 1. `AuthMiddleware` — `src/user/auth.middleware.ts` (the guard)
Applied **per route, per module**, in each module's `configure(consumer)`. Behaviour:
- no `Authorization` header, or nothing after the space → `HttpException('Not authorized.', 401)`
- header present → `jwt.verify(token, SECRET)` → `userService.findById(decoded.id)` → sets
  `req.user = user.user` and calls `next()`.
- `jwt.verify` **throws** on an expired, malformed or wrongly-signed token, and nothing in the
  middleware catches it — the framework turns that into a **500**, not a 401 (see `LESSONS.md`).
- `findById` throws `HttpException({errors}, 401)` if the id no longer exists.

### 2. `@User()` decorator — `src/user/user.decorator.ts` (optional identity, no guard)
Used as `@User('id')`, `@User('email')`, or bare `@User()` on handler parameters.
- If the middleware ran, returns `req.user[data]` (or the whole user).
- Otherwise it decodes the token itself with `jwt.verify` and returns `decoded[data]` — so a
  route that is NOT in the middleware list can still see who is calling **if** a token is
  sent, and gets `undefined` if none is. (Bare `@User()` on an unguarded route returns
  `decoded.user`, which does not exist in the payload → `undefined`.)
- Same `jwt.verify` throw → 500 problem as the middleware.

## Which routes are guarded (from the three `configure()` blocks)

| Module | Guarded routes (401 without token) |
|---|---|
| `UserModule` | `GET /user`, `PUT /user` |
| `ArticleModule` | `GET /articles/feed` · `POST /articles` · `PUT /articles/:slug` · `DELETE /articles/:slug` · `POST /articles/:slug/comments` · `DELETE /articles/:slug/comments/:id` · `POST /articles/:slug/favorite` · `DELETE /articles/:slug/favorite` |
| `ProfileModule` | `profiles/:username/follow` for **all** methods (POST follow, DELETE unfollow) |

Everything else is **public**: `GET /articles`, `GET /articles/:slug`,
`GET /articles/:slug/comments`, `GET /profiles/:username`, `GET /tags`, `POST /users`,
`POST /users/login`, and — notably — **`DELETE /users/:slug`**, which deletes the user whose
*email* equals the `:slug` param (`UserService.delete(email)`), with no token required and no
check of who is asking.

## Authorization (ownership) — where it is enforced

**Nowhere.** The middleware answers "is this a valid user"; no service or controller method
compares the caller with the record's owner:

| Action | Ownership check |
|---|---|
| `PUT /articles/:slug` | none — `ArticleService.update(slug, body)` does `Object.assign(article, body)` and saves |
| `DELETE /articles/:slug` | none — `delete({slug})` |
| `DELETE /articles/:slug/comments/:id` | none — and comments have no author to compare against anyway |
| `DELETE /users/:slug` | none, and unguarded |
| `PUT /user` | implicitly the caller (`@User('id')`), fine |

The Swagger `@ApiResponse({ status: 403 })` lines on the article controller describe an
intended behaviour, not an implemented one — nothing returns 403.

## Passwords

- Hashed by `UserEntity.hashPassword()` under `@BeforeInsert()` only.
- `UserService.update()` does `delete toUpdate.password` then `Object.assign(toUpdate, dto)`
  and saves. `UpdateUserDto` declares no `password` field, but nothing strips one from the
  request body, and `PUT /user` has no validation pipe.
- Login: `UserService.findOne({email, password})` → `argon2.verify(hash, password)`; unknown
  email or wrong password both return `null` → controller throws `HttpException({errors}, 401)`.
- Registration duplicate → `400` with `{ message: 'Input data validation failed', errors }`.
