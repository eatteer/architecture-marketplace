---
name: presentation-layer
description: "The HTTP surface of a feature — controllers, request/query/response DTOs and their validators, presentation mappers, the success envelope `{ data, pagination? }` and its two builders, URI versioning under `/api/v1`, status codes per verb and 204 for a command with no result, dates on the wire in UTC, guard composition on a route, `actorFrom(principal)`, `?include=`, batch route shape, and gating a route to non-production."
when_to_use: "Trigger on — writing a `*.controller.ts`, a `*.dto.ts` or a `*.presentation-mapper.ts`, choosing a status code or route name, building a response with `dataResponse` or `paginatedResponse`, a breaking change to an endpoint, adding an API version, stacking guards, turning the current user into the command's actor, exposing an endpoint only outside production, an endpoint leaking an entity, a controller assembling a response DTO inline, a success body carrying `success`, `message` or `timestamp`, a date sent with an offset, or a response whose shape differs between two endpoints."
---

# Presentation layer

Lives in `src/features/<feature>/presentation/`. It adapts HTTP to the application layer and back.
It holds no business rules: every branch here is a transport concern.

```text
presentation/
├── controllers/  users.controller.ts
├── dtos/         create-user.dto.ts, user.dto.ts, get-users-query.dto.ts
└── mappers/      user.presentation-mapper.ts
```

## Controllers

A complete route — with its documentation (see `api-documentation`) and its permission (see
`authorization`) — is in [examples/users.controller.ts](examples/users.controller.ts). **Read it
before writing or reviewing a controller**; the rules below are what it shows.

A controller method does four things and nothing else: read the request, build the command, call one
use case, shape the response. No `try`/`catch` — the global filter maps every domain error (see the
`error-handling` skill). No conditional that depends on domain state.

**A method name is unique across the application** — `createUser`, never `create` — because it is
the operation id in the spec (see `api-documentation`).

**One use case per route.** A route that calls two use cases is either a missing use case or two
routes; either way, the orchestration belongs in the application layer where it can be tested
without HTTP.

### Routes and status codes

| Verb | Route | Status | Body |
| --- | --- | --- | --- |
| `GET` | `/api/v1/users` | 200 | `{ data: [...], pagination }` |
| `GET` | `/api/v1/users/:id` | 200 | `{ data }` — the resource |
| `POST` | `/api/v1/users` | 201 | `{ data: { id } }` |
| `PATCH` | `/api/v1/users/:id` | 204 | none |
| `DELETE` | `/api/v1/users/:id` | 204 | none |
| `POST` | `/api/v1/users/:id/suspend` | 204 | none — a command on one resource |
| `POST` | `/api/v1/users/bulk` | 200 | `{ data: [...] }` — one result per item |

**A command with nothing to return answers 204, with no body.** Its outcome is the status: there is
no data to put under `data`, and `{ "data": null }` is a body a client has to parse to learn
nothing. That includes a logout: it ends a session and has nothing to hand back. The trace id
travels as a response header, so a 204 carries it like every other response (see the `observability`
skill). A `POST` that is a command rather than a creation takes `@HttpCode` for it, since the
framework defaults every `POST` to 201.

Routes are kebab-case and plural. A batch route takes an explicit `bulk` suffix rather than relying
on a singular/plural pair, which is one keystroke away from silently sending the wrong body shape.

### Versioning

Every route is `/api/v<n>/<resource>`, and a controller names only its resource. The prefix and the
default version are declared once, in the shared request pipeline (see `project-bootstrap`):

```typescript
app.setGlobalPrefix(API_PREFIX, { exclude: [LIVENESS_PATH, READINESS_PATH] });

app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });
```

- **In the path, not in a header.** A path is visible in every log line, every bookmarked URL and
  every proxy rule; a version header is invisible in all three, and a client that forgets it gets
  whichever version the server defaults to without being told.
- **A version written into each controller's path is a version somebody forgets to bump.** The
  default covers every controller; only a controller that answers under a different version
  declares it.
- **A breaking change ships as a second controller** declaring `version: "2"`, next to the first,
  and the first keeps answering until its clients have moved. Breaking means removing or renaming a
  field, changing its type or its meaning, adding a required request field, or changing a status.
  Adding an optional request field or a response field is not a new version.
- **Anything addressed by the version is built from the same constants** — a cookie scoped to a
  route prefix, a redirect, a link in a document. A literal `/api/v1` next to them is a path that
  stops matching the day the version moves.
- **What is not the clients' contract stays outside both — and outside the envelope.** Health
  endpoints are the platform's: they take `VERSION_NEUTRAL` and are excluded from the prefix,
  because a probe configured against `/api/v1` breaks the day v2 ships. They answer the health
  library's own body, not `{ data }`: the envelope and its builders are the clients' API, and a
  probe reads the status anyway.

### Guard composition

Guards run left to right and short-circuit on the first throw, so **the order is part of the
behavior, not a style choice**.

```typescript
@Public()
@UseGuards(NonProductionGuard, CallbackSignatureGuard)
@Post("simulator/callbacks")
```

The environment guard goes first: checking the signature first would answer 401 in production and
confirm the route exists. It does not read `NODE_ENV` itself — it is handed the decision by a module
factory, the one place that reads it (see `configuration`). A route that must not exist in
production answers **404, never 403** — a 403 is an acknowledgement. An operator endpoint behind a
key, reachable in every environment, is a different case: see `authorization`.

Global guards run before route guards, which is why a route-level guard can rely on the principal
already being attached — and why a route that has to vanish in production is `@Public()`: otherwise
the global authentication guard answers 401 before the environment guard runs. The guards
themselves belong to the `authentication` and `authorization` skills; this skill owns only how they
stack on a route.

### The authenticated principal becomes the actor

`@CurrentUser()` yields the principal the authentication guard attached. The controller converts it
to an `Actor` with `actorFrom(principal)` and puts it on the command — that is the whole of its
involvement. It never reads a permission, never decides what the principal may do, and never passes
the raw principal inward.

```typescript
export function actorFrom(principal: Principal): Actor {
  return Actor.create(principal.type, principal.sub);
}
```

One helper in the shared presentation code, not the two fields spelled out per route: written at
each call site it is a pair of arguments somebody can swap, and the audit trail records whichever
came first.

## DTOs

Three kinds, and they do not share a class.

**Request DTO** — validated at the boundary, one per operation:

```typescript
export class CreateUserDTO {
  @IsEmail({}, { message: i18nValidationMessage("users.create_user.email_invalid") })
  public email!: string;

  @IsString({ message: i18nValidationMessage("common.validation.string") })
  @MaxLength(PERSON_NAME_MAX_LENGTH, { message: i18nValidationMessage("users.create_user.name_max_length") })
  public name!: string;

  @IsOptional()
  @IsIn(LANGUAGE_VALUES, { message: i18nValidationMessage("common.validation.enum") })
  public preferredLanguage?: string;
}
```

- **`@IsIn(VALUES)`, not `@IsEnum`.** The allowed values come from the domain's `const` array, so
  there is one list. A separate TypeScript `enum` for the wire is a second list that drifts.
- **An enumerable field is typed `string` here** and narrowed when the command is built. The DTO
  holds what arrived; the narrowing is a decision, and decisions are visible in the controller. That
  narrowing is one of the sanctioned `as` casts, because `@IsIn` has already rejected anything
  outside the union — see `code-conventions`.
- **Every validator carries its message key** — the scheme for which key belongs to the `i18n`
  skill.
- **The DTO validates shape, never business rules.** "Is this a well-formed email" belongs here; "is
  this email already taken" does not — it needs the database and a rule the domain owns.
- **A PATCH DTO's three-state fields are `field?: T | null`.** Absent, value, and `null` mean
  unchanged, set, and clear; see the table in `domain-modeling`.
- **An amount of money is a nested object with the amount as a string of minor units**, in both
  directions — never a JSON number. See the `money` skill.

**Query DTO** — the list parameters, extending the shared one:

```typescript
export class GetUsersQueryDTO extends ListQueryDTO {
  @IsOptional()
  @IsString({ message: i18nValidationMessage("common.validation.string") })
  @MaxLength(SEARCH_MAX_LENGTH, { message: i18nValidationMessage("common.validation.search.too_long") })
  public search?: string;

  @IsOptional()
  @IsIn(USER_SORT_BY_VALUES, { message: i18nValidationMessage("common.validation.enum") })
  public sortBy?: string;
}
```

`search` is bounded because its length is how much work one request can ask for (see `security`).
`sortBy` is constrained to a whitelist. An unconstrained sort field lets a caller sort by an
unindexed field and turn a fast endpoint into a collection scan. Paging, filtering and sorting
belong to the `pagination` skill.

**Response DTO** — the wire shape, with no optional members. A **class** with `@ApiProperty`, never
a `type` alias: TypeScript types are erased, so the decorators are the only thing the OpenAPI
generator can see, and an endpoint whose response is a type alias documents no body at all.

```typescript
export class UserDTO {
  @ApiProperty({ example: "01890a5d-ac96-774b-bcce-b302099a8057" })
  public id!: string;

  @ApiProperty({ example: "jane@example.com", format: "email" })
  public email!: string;

  @ApiProperty({ enum: USER_STATUS_VALUES, example: "active" })
  public status!: string;

  @ApiProperty({ format: "date-time", nullable: true, example: null })
  public deletedAt!: string | null;
}
```

Nobody constructs it with `new` — the presentation mapper returns an object that satisfies it — so
its properties carry the definite-assignment `!` like any other schema class. The `@Api*` decorators
belong to the `api-documentation` skill; what they are attached to is decided here.

Absent values are `null`, not omitted keys: JSON has no `undefined`, and a client that has to
distinguish "missing" from "null" has two failure modes instead of one.

**Never return an entity.** An entity's getters are its domain surface, and serializing them makes
every future rename a breaking API change — plus it exposes whatever the domain adds next, including
fields nobody decided to publish.

## Presentation mappers

```typescript
export class UserPresentationMapper {
  public static toDTO(user: User): UserDTO {
    return {
      id: user.id,
      email: user.email,
      status: user.status,
      deletedAt: user.deletedAt?.toISOString() ?? null,
    };
  }
}
```

**A mapper builds every response DTO that projects an entity or a result object.** A controller
never formats one of those itself, not even a three-field one: the mapper is the one place the wire
shape is written, so a DTO formatted inline is a second place that drifts — its dates stop ending in
`Z`, its absent values stop being `null`. A DTO that only wraps a primitive the use case returned —
`{ id }` for a creation, `{ downloadUrl }` — has nothing to format and is built where it is
returned.

Static, pure, synchronous. **Do not give a mapper a dependency to call**, even a static async one —
it stops being a projection, and its failures stop being visible to the controller that is supposed
to own them.

### Dates

**A date crosses the wire as an ISO 8601 string in UTC, with the `Z`** — `toISOString()` in the
mapper, never a local offset and never an epoch number. Converting in the mapper means every
endpoint formats them the same way without anyone remembering to.

- The domain and the database hold instants in UTC. Nothing between the database and the response
  converts to a time zone.
- **Converting to a time zone happens only where a person reads the date** — the client rendering
  it, an email or a document this application renders for a recipient. The zone is the reader's,
  and the server answering the request does not know it.

## The response envelope

A success has one shape, and it holds the result and nothing else:

```typescript
export type DataResponse<T> = {
  data: T;
};

export type PaginatedResponse<T> = {
  data: T[];
  pagination: APIPagination;
};

export function dataResponse<T>(data: T): DataResponse<T> {
  return { data };
}

export function paginatedResponse<T>(page: Paginated<T>): PaginatedResponse<T> {
  /* the page's items under `data`; its metadata under `pagination`, absent neighbors as null */
}
```

- **No `success`**: the status already says it, and a flag that can disagree with the status is a
  second answer to one question.
- **No `message`**: text for a person is the client's to write, in the client's language. A success
  message from the server is a string nobody displays and everybody has to translate.
- **No `code`**, **no `timestamp`**: a success has no rule to name, and the response's own `Date`
  header already says when.
- **No `traceId` in the body**: it is the `x-trace-id` header of every response, which is the only
  place it can be on a 204 too. The `observability` skill owns where it comes from.

The two builders are the **only** way to construct one. A hand-built object literal is how a field
goes missing from one endpoint, and a client that sees the field everywhere else has no reason to
guard for it.

A failure is not this shape. It is a Problem Details document under its own media type, built by the
global filter — see the `error-handling` skill.

## Optional relations: `?include=`

A list endpoint that always resolves its relations pays for them on every call, including the calls
that do not display them. Make it opt-in:

```text
GET /api/v1/orders?include=customer,items
```

- Parse the parameter against a whitelist of includable relation names; an unknown name is a 400,
  not silence.
- Resolve the requested relations in **one** batched query each, then index by id — never one query
  per row (see the `persistence-layer` skill).
- A relation that fails to load fails the request. **Never swallow it with a bare
  `.catch(() => undefined)`**: a degraded database should show up as an error, not as a 200 with
  fields quietly missing.
- The response DTO types an un-requested relation as `null`, so the field is always present and a
  client never has to check whether the key exists.

## Batch endpoints

The route takes the whole payload and answers with one entry per item, in request order:

```typescript
export class BatchItemResultDTO {
  @ApiProperty({ example: 0 })
  public index!: number;

  @ApiProperty({ example: true })
  public success!: boolean;

  @ApiProperty({ nullable: true, example: "01890a5d-ac96-774b-bcce-b302099a8057" })
  public id!: string | null;

  @ApiProperty({ nullable: true, example: null })
  public code!: string | null;
}
```

The response is 200 even when every item failed: the batch itself succeeded, and the per-item
outcomes are the data. A caller reads `success` per item, not the HTTP status. The orchestration
behind it belongs to the `application-layer` skill.

## Checklist

- [ ] Every controller method reads the request, builds one command, calls one use case, and shapes
      the response — nothing else.
- [ ] No `try`/`catch` and no domain condition in a controller.
- [ ] Every success body outside the health routes is built with `dataResponse` or
      `paginatedResponse`; no object literal envelope, and nothing beside `data` and `pagination`.
- [ ] Every command with no result answers 204 with no body.
- [ ] No controller path carries `api/` or a version; only a controller answering under a
      non-default version declares one.
- [ ] No endpoint returns an entity, and no response DTO has an optional member.
- [ ] Every response DTO that projects an entity or a result is built by a presentation mapper;
      only a wrapper around one returned primitive is built inline.
- [ ] Every free-text query field has a `MaxLength`.
- [ ] Every enumerable request field uses `@IsIn` over the domain's `const` array.
- [ ] `sortBy` is constrained to a whitelist.
- [ ] Guards are ordered so the environment guard runs first, and a hidden route answers 404.
- [ ] The controller converts the principal to an actor with `actorFrom` and passes nothing else
      inward.
- [ ] Every `?include=` name is whitelisted, batched, and typed `null` when not requested.
- [ ] No mapper has a dependency, and every date crosses the wire as a UTC ISO 8601 string ending
      in `Z`.
