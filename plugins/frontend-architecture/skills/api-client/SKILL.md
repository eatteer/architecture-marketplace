---
name: api-client
description: "Talking to the backend — the API's types generated from its OpenAPI document and committed, the one `openapi-fetch` client with credentials and its middlewares, the order they run in, the request headers they attach, every failure turned into one `ApiError` built from RFC 9457 Problem Details (or from a response that is not one, or from no response at all), unwrapping the `{ data }` envelope and a paginated list, the backend's catalogs taken from the generated types, and the mapper from a DTO to the feature's model."
when_to_use: "Trigger on — calling an endpoint, writing a query or mutation function, running or changing `api:types`, a type error after the backend changed, editing `schema.gen.ts` by hand, a raw `fetch` or a second HTTP client, adding a request or response middleware, a header the backend expects, a DTO leaking into a component, writing a mapper, a status or permission list typed out by hand, `unwrap` or `unwrapPage`, a `data` that is `undefined` after a successful call, a failure that is not an `Error`, reading `error.status` or `error.code`, a proxy's HTML error page, an offline request, a cookie the browser does not send, or a 400 for a query parameter the backend does not declare."
---

# API client

The backend's contract reaches the browser once, as generated types, and every request goes through
one client that turns the transport's two shapes — data or a failure — into a value or a thrown
`ApiError`. Nothing past this layer knows about HTTP bodies, envelopes or Problem Details.

## The generated types

`pnpm api:types` reads the backend's OpenAPI document and writes the whole contract into one
generated file: `openapi-typescript` with `--export-type`, `--root-types` (so every schema is also a
named export — `UserDto`, `ProblemDetailsDto`), `--root-types-no-schema-prefix` and
`--root-types-keep-casing` (so the names match the backend's), and `--enum-values` (so every enum
the backend declares is also an exported array of its values).

- **The generated file is committed and never edited.** It is the contract as of the last
  regeneration: a renamed property or a removed endpoint in the backend is a compile error at every
  reader the moment it is regenerated, rather than an `undefined` at runtime. It is regenerated with
  the backend running, after each change to its API, and the diff is reviewed like any other.
- **A catalog the backend owns is read from the generated types, never typed again.** The statuses a
  filter offers, the fields a list can be sorted by, the permissions a guard checks: each is an
  exported array or a union in the generated file, and the feature's model re-exports it under its
  own name.

  ```typescript
  import { pathsApiV1UsersGetParametersQueryStatusValues } from "@/common/api/schema.gen";
  import type { SessionDto, UserDto } from "@/common/api/schema.gen";

  export const USER_STATUS_VALUES = pathsApiV1UsersGetParametersQueryStatusValues;

  export type UserStatus = UserDto["status"];

  export type Permission = SessionDto["permissions"][number];
  ```

  A permission the backend renames is then a compile error at every check that names it, instead of
  a gate that is silently always closed.

  Two lists are the front's own even though the generated file repeats them, and are typed once in
  `common/`: the sort orders every list shares (`SORT_ORDER_VALUES`, which the document declares
  per endpoint and never as one shared list — see `pagination`), and the languages the application
  speaks (`LANGUAGE_VALUES`, which `i18n` owns). The request bodies that carry them still check
  them against the generated types at compile time.
- **A generated DTO never reaches a component.** The mapper in the feature's `api/` stops it, and the
  feature's `model/` may derive its unions from the generated types, as above. The one exception is
  a type that is already the application's own shape, like the backend's pagination block: it is
  re-exported under a local name instead of copied.

## The one client

```typescript
export const apiClient = createClient<paths>({
  baseUrl: env.VITE_API_URL,
  credentials: "include",
  fetch: (request: Request): Promise<Response> => globalThis.fetch(request),
});

apiClient.use(
  requestContextMiddleware,
  problemDetailsMiddleware,
  createSessionRefreshMiddleware((): Promise<unknown> => apiClient.POST("/api/v1/auth/refresh", { body: {} })),
);
```

- **Every request goes through it.** A raw `fetch` skips the language, the trace, the refresh and
  the error conversion, and fails in a shape nothing else understands.
- **`credentials: "include"`**, because the session travels in HttpOnly cookies and a cross-origin
  request only sends them when asked (see `authentication`). The two origins still have to be
  same-site for the cookies to exist at all — a `configuration` concern.
- **`fetch` is looked up on every call**, not captured when the client is created: whatever replaces
  the global later — the tests' network mock — is then the one used.
- **The base URL comes from validated configuration** (see `configuration`), and every path is
  written as the backend declares it, prefix included (`"/api/v1/users/{id}"`), so it is checked
  against the generated `paths`.

### The middlewares, and the order they run in

Request hooks run in the order the middlewares are registered; **response hooks run in reverse**.
That is what the order above encodes:

1. **The request context** attaches `x-lang` with the language on screen and a W3C `traceparent`
   unless one is already set. Which language that is belongs to `i18n`; what the trace is for and
   where its id ends up belongs to `observability`.
2. **Problem Details → `ApiError`** throws on every response that is not `ok`, and on a request that
   got no response at all.
3. **The session refresh**, registered last so its response hook runs first: it sees a raw 401
   before the second middleware turns it into an error, and can answer with the request sent again
   instead (see `authentication`).

A middleware mutates the `Request` it is handed — `request.headers.set(…)` — and returns it; that is
the library's contract, and cloning instead would drop what the client set.

## `ApiError`

Every failed request becomes one `ApiError`, a real `Error` subclass, so it keeps its stack and its
`cause`, and one type is all the query layer and the screens have to understand. The query client
registers it as the default error type (see `server-state`), so no caller casts.

```typescript
export class ApiError extends Error {
  public override readonly name = "ApiError";
  public readonly method: string;
  public readonly url: string;
  public readonly status: number;
  public readonly code: string;
  public readonly title: string;
  public readonly detail: string;
  public readonly fieldErrors: FieldError[];
  public readonly traceId: string | undefined;
  public readonly retryAfterSeconds: number | undefined;
  public readonly occurredAt: Date = new Date();

  public get isClientError(): boolean {
    return this.status >= CLIENT_ERROR_MIN_STATUS && this.status < SERVER_ERROR_MIN_STATUS;
  }
}
```

It is built from one of three things, and the reader of an `ApiError` never needs to know which:

| What arrived | `status` | `code` | `title` and `detail` |
| --- | --- | --- | --- |
| A Problem Details body (`application/problem+json`) | the response's | the backend's (`users.email_already_registered`) | the backend's, already translated |
| A response that is not Problem Details — a proxy's HTML error page | the response's | `client.unexpected_response` | the front's own translated text |
| No response — offline, DNS, CORS refused | `0`, what `fetch` itself reports | `client.network_error` | the front's own; the original failure is the `cause` |

- **A Problem Details body is validated before it is trusted**, with a Zod schema checked against the
  generated type — `z.object({ … }) satisfies z.ZodType<ProblemDetailsDto>` — so a change to the
  backend's error body fails the build here instead of at the first error a user sees. A body that
  fails the schema is treated as not Problem Details.
- **The front's own codes carry a `client.` prefix**, the same `<area>.snake_case` shape as the
  backend's, so the two never collide and one branch on `code` reads the same for both.
- **The trace id is the response's `x-trace-id` header, then the body's `traceId`, then the one the
  request's own `traceparent` carried** — so even a request that never got an answer has an id the
  backend's logs can be searched for.
- **`Retry-After` is read in its seconds form** into `retryAfterSeconds`; the backend never sends the
  date form.
- **`fieldErrors` is the body's `errors[]`**: one `{ field, message }` per invalid field, with a
  dotted path. Placing them on a form's fields is `forms`'.

Branch on **`status` for a transport fact** — does it exist, may I see it, must I sign in — and on
**`code` for a feature's own outcome**, compared with a named constant (see `code-conventions`).
What each failure shows the reader is `error-handling`'s.

## Unwrapping the envelope

The backend wraps a resource in `{ data }` and a list in `{ data, pagination }`. The client throws on
every failure, so by the time a result reaches the caller it carries data — the guard that remains is
for the compiler, which cannot know that:

```typescript
export function unwrap<T>({ data }: { data?: { data: T } }): T {
  if (data === undefined) {
    throw new Error(MISSING_DATA_MESSAGE);
  }

  return data.data;
}
```

`unwrapPage` does the same for a list and returns `Paginated<T> = { items, pagination }`, and
`mapPage` maps its items; what a list's query and pagination mean is `pagination`'s. A command the
backend answers with `204` is awaited and nothing is read from it:

```typescript
async function signOut(): Promise<void> {
  await apiClient.POST("/api/v1/auth/logout", { body: {} });
}
```

## Where a call lives, and what it returns

A call lives in a function in the feature's `api/` folder — a query function or a mutation function
(see `server-state`) — and **returns the feature's model, never a DTO**:

```typescript
async function fetchUser(id: string, signal: AbortSignal): Promise<User> {
  return toUser(unwrap(await apiClient.GET("/api/v1/users/{id}", { params: { path: { id } }, signal })));
}
```

- **A read passes on the `AbortSignal` it was given**, so a query the screen no longer needs cancels
  its request instead of letting it finish into a cache nobody reads.
- **The mapper is a pure function from the DTO to the model**, in a `.mapper.ts` beside the queries,
  and keeps only what the screens use. A date stays the ISO string the backend sent — formatting it
  is `formatting`'s — and becomes a `Date` only where the application computes with it. A field
  nobody reads is left out rather than carried along.
- **A request body is the form's output type when it already matches the generated body**, and a
  mapped object when it does not. The generated type checks the first at compile time, so passing
  `values` straight through is safe exactly as long as it compiles.
- **Only parameters the backend declares are sent.** The backend refuses a query parameter it does
  not know, and the generated type is the list of those it does.

## Checklist

- [ ] The generated schema is committed, untouched, and regenerated after the backend's API changed.
- [ ] Every catalog the backend owns — statuses, sort fields, permissions — is taken from the
      generated types.
- [ ] Every request goes through the one client; there is no raw `fetch` and no second client.
- [ ] The refresh middleware is registered after the one that converts failures.
- [ ] Every failure a caller can see is an `ApiError`, and every `client.` code is a named constant.
- [ ] Every call lives in a feature's `api/` function, passes the query's `signal` when it reads, and
      returns the model through a mapper.
- [ ] No component imports the generated schema; only the client's own folder, a feature's `api/`
      and its `model/` do.
