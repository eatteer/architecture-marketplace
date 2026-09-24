---
name: error-handling
description: "Turning failures into responses — the domain error to HTTP status map each module provides through DI, the global exception filter, the RFC 9457 Problem Details body (`application/problem+json`, `code`, `traceId`, `errors[]`), the shape of a validation failure, why an unmapped domain error is a 500, classifying a refusal against a fault, the two valid endings for a `catch`, and the empty-body pipe."
when_to_use: "Trigger on — editing the errors map, `provideDomainErrorStatuses` or the global exception filter, mapping a new domain error, writing a `catch` block, a `catch` that only logs, a domain error with no status mapping reaching the client as 500, a body over the limit answering 500, a failure body whose shape differs from other failures, a status that depends on which module was imported, an empty body producing a 500 or refused on a cookie refresh, a 403 answered to a request with no credentials, a 409 that is really a bad value, or a 400 that does not say which field."
---

# Error handling

Errors are thrown where they are detected and translated exactly once, at the edge. No layer in
between catches one to re-shape it.

## The map

One map decides every domain error's HTTP meaning, and each module contributes its own entries to it
as a provider under one token:

```typescript
// the shared presentation code
export const DOMAIN_ERROR_STATUSES_TOKEN: unique symbol = Symbol("DOMAIN_ERROR_STATUSES_TOKEN");

export function provideDomainErrorStatuses(statuses: DomainErrorStatuses): ValueProvider<DomainErrorStatuses> {
  return { provide: DOMAIN_ERROR_STATUSES_TOKEN, useValue: statuses };
}

export const COMMON_ERROR_STATUSES: DomainErrorStatuses = [
  [InvalidValueObjectError, HttpStatus.BAD_REQUEST],
  [UnauthenticatedError, HttpStatus.UNAUTHORIZED],
  [IdempotencyKeyConflictError, HttpStatus.CONFLICT],
];
```

```typescript
// the feature's module — its own composition root
@Module({
  providers: [provideDomainErrorStatuses(USER_ERROR_STATUSES) /* , ... */],
})
export class UsersModule {}
```

A registry collects every list once, at startup, and the filter receives it injected:

```typescript
@Injectable()
export class DomainErrorStatusRegistry implements OnModuleInit {
  public constructor(private readonly _discovery: DiscoveryService) {}

  public onModuleInit(): void {
    /* every provider whose token is DOMAIN_ERROR_STATUSES_TOKEN, merged; a duplicate throws */
  }

  public statusOf(error: DomainError): HttpStatus | undefined {
    /* looked up by error.constructor */
  }
}
```

**Not a module-level map that each module fills when its file is imported.** That is global mutable
state written as a side effect of an `import`: a module a test does not import never registers, two
test files share whatever the last one added, and nothing in the module's metadata says the
registration exists. A provider is part of the module's declaration, so it is built with the module
and dropped with it. The framework has no multi-provider, so the registry asks the container which
providers were registered under the token — the same answer, without a list of modules anybody has
to keep in step.

**Two modules mapping the same error is a boot failure**, not something settled by whichever the
container built last: the status a client sees would otherwise change with an import.

**Not one central file listing every feature's errors.** That file has to import them, so shared
code depends on every feature, which is the direction everything else in the corpus forbids — and
deleting a feature leaves it importing classes that no longer exist. Providing from the feature's
module means the entries are deleted with the feature and nothing shared ever names it.

**Keyed by the constructor, not by `error.name`.** A string key survives a class rename without a
compile error and breaks under minification, so the branch goes silently dead and every error it
covered starts answering 500. The constructor is checked by the compiler and survives both.

**An error more than one feature raises lives in the shared code**, with a `common.*` code. The
guard that finds no principal and the guard that finds no permission belong to different features,
and both answer with the same unauthenticated error; owned by one of them, it makes the other import
across the boundary.

| Meaning | Status |
| --- | --- |
| The request is malformed or fails validation | 400 |
| No credentials, or credentials that do not verify | 401 |
| Verified, but not allowed to do this | 403 |
| The thing addressed does not exist, or must appear not to | 404 |
| The request is well-formed but conflicts with current state | 409 |
| The body is larger than the configured limit | 413 |
| The caller exceeded a rate limit or quota | 429 |
| Anything the caller could not have prevented | 500 |
| The instance is not ready to serve | 503 |

Two that get picked wrong, and both mislead the caller into the wrong next move:

- **401 when there is no principal, not 403.** There is nobody to forbid. A caller told "forbidden"
  believes the credential it sent was rejected on its merits and stops trying to authenticate; told
  "unauthenticated", it signs in and continues. Any guard that can run without a principal — one
  that sits behind the authentication guard, for instance — answers 401 in that branch.
- **409 only when the resource's state is what blocks it.** A wrong password on a change-password
  request is not a conflict: nothing about the state is in the way, the caller sent a value that
  does not check out, and that is 400. Reserve 409 for "this cannot happen *now*, given what the
  record is" — already settled, already registered, already cancelled.

**The codes the framework produces are namespaced too.** A client branches on this string, and
`not_found` from the framework next to `users.user_not_found` from the domain reads as two different
contracts. Map every status the application can answer on its own to a `common.*` code — including
**413, 429 and 503**, which the body parser, the rate limiter and a failing readiness check raise
without any domain error involved. Without an entry they fall to a generic code that tells a client
nothing it can act on.

**What the body parser throws is not a framework exception.** It is an `http-errors` object that
states its own status and marks itself `expose: true` — safe to show the client. The filter answers
it with that status; read as an unexpected error, a body over the limit answers 500 and is logged as
a fault. It is also thrown before any middleware runs, so the filter resolves the trace id itself
through the same idempotent helper the middleware uses (see the `observability` skill).

**The framework's own text never reaches the client, translated or not.** "Cannot GET
/internal/debug" and "ThrottlerException: Too Many Requests" are English, name internals, and say
nothing the caller can use. The status carries the meaning and the code carries the contract; with
no translator available the fallback is the status phrase, never the exception's message.

**A domain error missing from the map becomes a 500.** That is deliberate: the forgotten mapping is
a developer bug, and answering 500 makes it visible immediately. Defaulting an unknown error to 400
would quietly present a bug as the caller's fault and nobody would ever find it.

Adding a domain error, its map entry, and its translation is **one change**. An error class with no
map entry answers 500; one with no translation renders its key to the user.

**Every domain error has an entry, including one that normally never crosses the boundary.** A
shared error a use case answers itself — an idempotency-key conflict it resolves into the stored
result — is still mapped (409). The day a path lets it escape, the mapping is what makes it the
caller's conflict rather than a 500.

## The global filter

A single filter catches everything leaving a controller and answers with a **Problem Details**
document (RFC 9457) under the media type `application/problem+json` — one shape for every failure,
and a media type that lets a client tell a failure from a result before parsing anything. Success
bodies are the `presentation-layer` skill's.

```json
{
  "type": "about:blank",
  "title": "Not Found",
  "status": 404,
  "detail": "User not found",
  "instance": "/api/v1/users/01890a5d-ac96-774b-bcce-b302099a8057",
  "code": "users.user_not_found",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": []
}
```

- **`type` is `about:blank`.** A URI per error promises a document at that address, and nobody
  publishes one; `about:blank` is the standard's way of saying the status is the problem type.
- **`code` is the extension a client branches on** — the domain error's code
  (`users.user_not_found`), not the class name and not the status. It is the stable contract; see
  `domain-modeling` for how codes are namespaced.
- **`title` is the status phrase and `detail` is what went wrong**, both translated (see the `i18n`
  skill). Neither is a contract: a client that branches on the wording breaks the day it improves.
- **`instance` is the path, without the query string.** The query is where search terms travel, and
  the problem is about the resource, not about what was asked of it.
- **`traceId` is on every failure**, equal to the `x-trace-id` header. It is the only thing
  connecting a user's report to a log line.
- **`errors` is always present**, empty unless validation failed — a member that exists only
  sometimes is a member every client has to guard for.
- An unrecognized exception answers 500 with a generic detail. **Never put the raw exception text
  in the response** — it leaks paths, driver internals, and sometimes data.

```typescript
@Catch()
export class HTTPExceptionFilter implements ExceptionFilter {
  public constructor(private readonly _statuses: DomainErrorStatusRegistry) {}

  public catch(exception: unknown, host: ArgumentsHost): void {
    /* resolve the trace id, the status, the code and the detail; send the problem */
  }
}
```

## Validation failures

A validation failure carries every problem at once, not the first one — **including the ones
reported on nested objects.** A validator reports a nested DTO's failures on the child, so a
flattener that reads only the top level answers 400 with an empty list: the caller is told a field
is wrong and not which one. It stays invisible until the first nested DTO exists, which is long
after the code was written.

```json
{
  "type": "about:blank",
  "title": "Bad Request",
  "status": 400,
  "detail": "One or more fields are not valid",
  "instance": "/api/v1/users",
  "code": "common.validation_error",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "errors": [
    { "field": "email", "message": "The email is not valid" },
    { "field": "price.amountMinor", "message": "The amount must be a whole number of minor units" }
  ]
}
```

Each entry names its field by a dotted path, so a nested failure names the child rather than its
parent, and carries a message from the translation layer (see the `i18n` skill). Never the rejected
value: it is the caller's input, and the password is one of the fields that fail.

### The empty-body pitfall

When a request arrives with no body at all, the framework can hand the handler `undefined` rather
than `{}`. A DTO whose fields are **all optional** validates that cleanly — there is nothing to
violate — and the handler then dereferences `undefined` and answers 500.

A global pipe **substitutes `{}` for an absent body**. An all-optional DTO then acts on an empty
payload, and a DTO with a required field fails validation as a 400 naming it. It is the one pipe
that touches the body, and it adds nothing the caller did not send. A handler that binds a single
field (`@Body("field")`) is left alone: that value has its own semantics.

It substitutes rather than rejects because an absent body is legitimate on an all-optional route. A
cookie client refreshing or logging out sends its token in the cookie and has nothing to put in the
body; a pipe that rejected the missing body would refuse exactly the call the route exists for.

## Refusal or fault

Before deciding how loudly a failure is recorded, classify it:

- **A refusal** is the API doing its job: a validation error, a missing resource, a permission
  denied, a conflicting state. It is expected traffic. It is not a fault, and treating it as one
  makes the fault signal useless — if a thousand 404s a day are errors, nobody looks at errors.
- **A fault** is something that should not have happened: an unmapped domain error, a driver
  failure, an unhandled exception, a dependency that did not answer. Somebody has to look at it.

**A 503 is a refusal.** It is the instance saying it is not ready, which is readiness doing its job:
while the instance drains before shutdown nothing is wrong at all, and when a dependency is down the
health check has already recorded which one, with the detail the response leaves out. Logged again
as a fault on every probe, it buries the one line that names the cause.

This classification is what the filter uses. The level names, the structure of the line, and what
gets masked belong to the `observability` skill.

## What a `catch` may end in

Exactly two endings are valid.

**Rethrow, or do not catch at all.** The default. The filter already knows what the error means; a
`catch` that only re-wraps it loses the original and tells the reader nothing new.

**Recover deliberately.** The failure is handled — a fallback is used, the item is recorded as
failed, the loop continues — and the output carries enough to act on: what was being done, the
identifiers needed to find it, and the original error.

```typescript
// ❌ the failure is swallowed, the caller is told nothing, the message names no subject, and the
//    error is under a key the serializer does not recognize — it reaches the log as {}
try {
  /* ... */
} catch (error: unknown) {
  this._logger.error({ message: "Something went wrong", error });
}

// ✅ the case is handled, the output identifies what to go and look at, and the error is under `err`
try {
  /* ... */
} catch (error: unknown) {
  this._logger.error({
    message: "Failed to notify customer after settlement",
    orderId: event.payload.orderId,
    err: error,
  });
}
```

The output goes through the class's `Logger`, never `console.*` — see the `observability`
skill for the logger and the level to give it.

**A `catch` that logs and then continues as though nothing happened is a defect**, whichever of
the two it resembles. The test is whether the code after the `catch` is correct given that the work
inside it did not happen. If it is not, the `catch` is hiding a failure rather than handling one.

Two places are allowed to recover rather than rethrow, and both are named in their own skills: a
batch orchestrator recording a per-item failure (`application-layer`), and an event handler that
cannot be allowed to throw (`event-driven`).

**Never catch a domain error to change it.** Catching `UserNotFoundError` in a use case to throw
something else means the map entry is wrong; fix the map.

## Checklist

- [ ] Every failure is `application/problem+json` with `type`, `title`, `status`, `detail`,
      `instance`, `code`, `traceId` and `errors`, and no member is ever absent.
- [ ] Framework statuses have namespaced codes too, 413, 429 and 503 included, and no framework
      text reaches `detail`, with or without a translator.
- [ ] Validation failures are flattened recursively into `errors[]`, children named by a dotted
      path.
- [ ] Every domain error has an entry in its module's list, keyed by the constructor, added in the
      same change as the class — including a shared error a use case normally answers itself.
- [ ] An absent body reaches validation as `{}`, and a single-field `@Body("field")` is untouched.
- [ ] Every module that owns domain errors provides its list with `provideDomainErrorStatuses`;
      nothing registers errors as a side effect of an import.
- [ ] 409 is used only when the record's state is the obstacle; a bad value is 400, and a
      missing principal is 401.
- [ ] No domain error's status is chosen in a controller or a use case; the only status a
      controller sets itself is the readiness route's 503 from its own shutdown state.
- [ ] The problem's `code` is the domain error's code, and its `traceId` equals the `x-trace-id`
      header.
- [ ] No raw exception text reaches the client.
- [ ] Every `catch` either rethrows or genuinely handles the case.
- [ ] Every recovering `catch` prints the operation, the identifiers, and the original error.
- [ ] No `catch` converts one domain error into another.
