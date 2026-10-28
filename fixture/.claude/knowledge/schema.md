---
purpose: The data model as TypeORM actually creates it — entities, columns, relations, what loads eagerly, what nothing writes to. Load for any question about storage, tags, favourites, comments, follows, or "how is X stored".
tags: entity column relation eager lazy simple-array tagList favorites favoriteCount comments follows tag table typeorm
---

# Data model (TypeORM entities, `synchronize: true`)

Tables are generated from the entity classes at boot. There are no migration files; a column
change is an entity change.

## `user` — `src/user/user.entity.ts`

| column | type | notes |
|---|---|---|
| id | int PK | |
| username | varchar | **no unique index** — uniqueness is checked in `UserService.create()` with a query, not by the DB |
| email | varchar | `@IsEmail()` (class-validator), no unique index either |
| bio | varchar default '' | |
| image | varchar default '' | |
| password | varchar | argon2 hash — hashed by `@BeforeInsert() hashPassword()`. **Only on insert.** There is no `@BeforeUpdate` hook. |

Relations:
- `favorites: ArticleEntity[]` — `@ManyToMany` + `@JoinTable()` → join table `user_favorites_article`. **Not eager.** A `userRepository.findOne(id)` returns `favorites === undefined`; you must pass `{ relations: ['favorites'] }` to get the array.
- `articles: ArticleEntity[]` — `@OneToMany` inverse of `ArticleEntity.author`. Not eager.

## `article` — `src/article/article.entity.ts`

| column | type | notes |
|---|---|---|
| id | int PK | |
| slug | varchar | set once in `create()`; not unique-indexed |
| title | varchar | |
| description | varchar default '' | |
| body | varchar default '' | |
| created | timestamp default CURRENT_TIMESTAMP | spec calls it `createdAt` |
| updated | timestamp default CURRENT_TIMESTAMP | bumped by `@BeforeUpdate()` |
| tagList | **`simple-array`** | stored as ONE comma-joined string column, e.g. `java,spring` — not a join table, not JSON |
| favoriteCount | int default 0 | denormalised counter, incremented/decremented in `ArticleService.favorite()/unFavorite()` — the join table is the truth, this is a cache |
| authorId | FK → user | via `@ManyToOne author` |

Relations:
- `author: UserEntity` — `@ManyToOne`. Not eager; `findAll()` adds it with `leftJoinAndSelect('article.author', 'author')`, `findOne()` does not.
- `comments: Comment[]` — `@OneToMany`, **`{eager: true}`** — every article load also loads its comments.

### Filtering by tag
Because `tagList` is a delimited string, `findAll()` filters with
`article.tagList LIKE :tag` where `tag = '%' + query.tag + '%'`. That is a substring match on
the joined string.

## `comment` — `src/article/comment.entity.ts`

| column | type |
|---|---|
| id | int PK |
| body | varchar |
| articleId | FK → article |

**There is no author column and no relation to `user`.** The RealWorld spec's comment object
has `author`; this entity cannot produce it. `addComment()` sets only `body`.

## `follows` — `src/profile/follows.entity.ts`

| column | type |
|---|---|
| id | int PK |
| followerId | int (plain column, **no FK**) |
| followingId | int (plain column, no FK) |

No unique index on `(followerId, followingId)`; `follow()` guards against duplicates with a
`findOne` before insert.

## `tag` — `src/tag/tag.entity.ts`

| column | type |
|---|---|
| id | int PK |
| tag | varchar |

Read by `GET /api/tags` (`TagService.findAll()`). **Nothing in the codebase writes to it** —
article creation stores tags only in `article.tagList`. On a fresh database `GET /tags` returns
`[]` forever unless rows are inserted by hand.

## Response shapes vs storage (what the frontends expect vs what exists)

| Spec field | Source today |
|---|---|
| `article.favorited` | **not produced** — nothing computes "does the current user favourite this" |
| `article.favoritesCount` | entity column is `favoriteCount` (singular) and is returned under that name |
| `article.createdAt` / `updatedAt` | columns are `created` / `updated` |
| `comment.author` | no data to produce it |
| `profile.following` | computed in `ProfileService.findProfile()` from `follows` |
