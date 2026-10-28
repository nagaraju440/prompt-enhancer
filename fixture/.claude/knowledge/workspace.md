---
purpose: What this project is, how it is laid out, how to run it, and the conventions every change must follow. Load for any question about structure, naming, response shapes, or where code goes.
tags: nestjs typeorm realworld conventions layout envelope RO dto module controller service
---

# RealWorld API (NestJS) — workspace overview

## What it is

A backend implementing the [RealWorld](https://github.com/gothinkster/realworld) API spec
(Medium clone: users, profiles, articles, comments, tags, favourites, follows). Any RealWorld
frontend (React, Vue, Angular…) is expected to work against it unchanged — **spec conformance
is the contract**, not just "it works with our own client".

Pinned at upstream commit `c1c2cc4` of `lujakob/nestjs-realworld-example-app` (2021-01-18).

## Stack

| Layer | Choice |
|---|---|
| Framework | NestJS 7 (`@nestjs/common` ^7.0.5) |
| ORM | TypeORM 0.2.24, `synchronize: true` (tables are created from entities on boot — there are NO migration files) |
| Database | MySQL (`ormconfig.json`) |
| Auth | JSON Web Token via `jsonwebtoken`, secret in `src/config.ts` (copied from `config.ts.example`) |
| Password hashing | `argon2` |
| Validation | `class-validator` + a hand-written `ValidationPipe` in `src/shared/pipes/validation.pipe.ts` |
| API docs | Swagger at `/docs` |
| Tests | Jest (`jest.json`); only `src/tag/tag.controller.spec.ts` exists |

Global prefix is `api` (`src/main.ts` → `app.setGlobalPrefix('api')`), so every route below is
really `/api/...`. Server listens on 3000.

## Layout

```
src/
  main.ts                 bootstrap, swagger, global prefix
  app.module.ts           imports Article/User/Profile/Tag modules
  config.ts               SECRET (not committed; copy config.ts.example)
  article/                articles + comments + favourites
    article.controller.ts / article.service.ts / article.entity.ts / comment.entity.ts
    article.interface.ts  ArticleRO, ArticlesRO, CommentsRO
    dto/                  CreateArticleDto, CreateCommentDto
  user/                   registration, login, current user, AuthMiddleware, @User() decorator
  profile/                profiles + follow/unfollow (FollowsEntity)
  tag/                    GET /tags only
  shared/pipes/           ValidationPipe
```

One module per RealWorld resource. Each module owns its controller, service, entity and DTOs.
Module files also own **which routes require auth** — see `auth.md`.

## Conventions (these are the rules, not suggestions)

### Layer order
`controller → service → repository/entity`. Controllers do no business logic and never touch a
repository; services do. Cross-module data (e.g. the article service needs users and follows)
is reached by injecting that module's repository via `TypeOrmModule.forFeature([...])` in the
importing module — see `article.module.ts`.

### The response envelope and the `RO` suffix
`RO` means **Response Object**. Every controller method returns the RealWorld envelope, named
`<Thing>RO` in `*.interface.ts`:

| Endpoint family | Returns | Shape |
|---|---|---|
| single article | `ArticleRO` | `{ article: {...} }` |
| list | `ArticlesRO` | `{ articles: [...], articlesCount: n }` |
| comments | `CommentsRO` | `{ comments: [...] }` |
| user | `UserRO` | `{ user: {..., token} }` |
| profile | `ProfileRO` | `{ profile: {..., following} }` |

The frontends read `response.article.slug`, `response.user.token`, etc. A method that returns a
bare entity instead of the envelope breaks every RealWorld client (see `LESSONS.md`).

### Request bodies are nested too
Handlers read `@Body('article')`, `@Body('user')`, `@Body('comment')` — the client sends
`{ "article": {...} }`, never a flat object. New endpoints follow the same nesting.

### DTOs
Plain classes in `dto/`, `readonly` fields. Only `CreateUserDto` carries `class-validator`
decorators (`@IsNotEmpty`); `UpdateUserDto`, `CreateArticleDto`, `CreateCommentDto` have none.
The custom `ValidationPipe` is applied **per handler** with `@UsePipes(new ValidationPipe())`
— it is not global. Today only `POST /users` and `POST /users/login` use it.

### Slugs
`ArticleService.slugify()` = `slug(title, {lower: true}) + '-' + <6 base-36 chars from Math.random()>`.
Two articles with the same title therefore get different slugs. The slug is set once at create;
`update()` has a `// Todo: update slug also when title gets changed` and does not.

### Timestamps
`ArticleEntity.created` / `updated` (NOT `createdAt` / `updatedAt` as the spec names them);
`@BeforeUpdate()` bumps `updated`.

### Comments load eagerly, favourites do not
`ArticleEntity.comments` is `{eager: true}`; `UserEntity.favorites` is a plain `@ManyToMany`
with no eager flag. See `schema.md` for what that means for service code.

## Running

```
cp src/config.ts.example src/config.ts
cp ormconfig.json.example ormconfig.json   # then fill in MySQL creds
npm install
npm start              # ts-node via index.js, port 3000
npm test               # jest
```
