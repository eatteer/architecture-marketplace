---
name: observability
description: "Knowing what the running process is doing — the framework `Logger` instead of `console.*`, structured log lines, the level policy, the W3C trace id on every line and as the `x-trace-id` header, OpenTelemetry tracing and metrics, the ambient request context, work that outlives the request, what a request leaves in the log, masking, liveness and readiness with Terminus, and graceful shutdown with a drain window."
when_to_use: "Trigger on — adding a log line, reaching for `console.log`, choosing a log level, a log that prints `[object Object]`, a trace id missing or different between two lines of one request, an incoming `traceparent`, adding OpenTelemetry or an instrumentation, a reported trace id that finds no trace, a job whose logs cannot be tied to anything, adding a health endpoint or a probe, a deploy that drops in-flight requests, a password, token, email or search term in a log, a field hidden in logs that is not secret, an error logged as an empty object, or not knowing which database the process connected to."
---

# Observability

Everything the process has to say goes to stdout as structured lines. The platform collects them;
the application does not know or care where they end up.

## Never `console.*`

Every line goes through the framework's `Logger`, held as a private field carrying the class as its
context:

```typescript
@Injectable()
export class SettleOrderUseCase {
  private readonly _logger: Logger = new Logger(SettleOrderUseCase.name);
}
```

`console.log` writes to stdout on its own terms. It cannot be levelled, it cannot be silenced in a
test run, it carries no context saying which class produced it, and it bypasses the formatting and
the redaction every other line goes through. One `console.log` in a service is a line that looks
unlike every other line in the same request — which is exactly the line you will be grepping for at
the wrong moment.

Instantiating the logger rather than injecting it is not an exception to the constructor-injection
rule in `code-conventions`: no implementation is being chosen here. The implementation is installed
once at bootstrap with `app.useLogger(...)` and every instance follows it, so swapping it is a
one-line change in `src/main.ts` and touches no call site.

The one sanctioned `console.error` is the top-level catch of each entry point, before a logger
exists — the `code-conventions` skill owns the rule.

## A log line is an object, not a sentence

```typescript
// ❌ unsearchable, and the object stringifies to nothing useful
this._logger.log("Settling order " + orderId + " " + JSON.stringify(context));

// ✅ one message, and fields anything can filter on
this._logger.log({ message: "Order settled", orderId, durationMs });
```

The trace id is not one of the fields a call site passes: the logger adds it to every line.

A constant `message` plus varying fields is what makes a line findable. A message with values
interpolated into it produces a distinct string per occurrence, so there is nothing to group by and
nothing to count.

Fields carry identifiers, not whole objects. An entity serialized into a log line is a copy of your
data in a system with different retention and different access control.

## An error goes under `err`

```typescript
// ❌ logs "error":{} — no message, no stack
this._logger.error({ message: "Exception occurred", error: exception });

// ✅
this._logger.error({ message: "Exception occurred", err: exception });
```

`err` is the key the serializer recognizes as an Error. Under any other name the object is passed
through ordinary JSON serialization, and an Error has no enumerable own properties — `message` and
`stack` live on the prototype — so it serializes to `{}`.

Nothing warns about this. The line appears, at the right level, with every other field intact; only
the part explaining what happened is missing. It survives review easily, because `error:` is the
obvious name for the field and the code reads correctly.

The same applies to a caught error being logged by hand: `{ message: "...", err: error }`.

## Say what you connected to

At startup, each external dependency is named in one line — host and database, queue, bucket — with
the credentials left out:

```typescript
// Connecting to MongoDB { hosts: "localhost:27017", database: "orders" }
```

A connection string is assembled from configuration, and configuration is exactly what differs
between the machine where it works and the one where it does not. When the target is not stated, the
failure reads "Authentication failed" and names nothing — the URI is not in the logs, because it
carries a password.

The worse case is the one that does not fail: pointed at a database that accepts the credentials —
another project's, on a shared port — the application starts, reports healthy, and reads and writes
somebody else's data. A single line at boot is what makes that visible immediately.

Never log the URI itself, and never log the fallback of last resort — a connection string with the
password only partly masked is still a leaked password.

## Levels

| Level | For |
| --- | --- |
| `error` | A fault: something nobody could have prevented from the outside, that somebody must look at |
| `warn` | Something degraded but handled — a retry, a fallback taken, a dependency slow |
| `info` | The narrative: a job started, a batch size, a feature disabled by configuration |
| `debug` | Detail useful while investigating, off in production |

**A refusal is not an error.** A validation failure, a 404, a denied permission — the API doing its
job. Logging those at `error` is what makes the error level useless: once a thousand 404s a day are
errors, nobody reads errors. The `error-handling` skill owns the refusal-versus-fault
classification; this skill owns what each one is worth.

The level a line gets is a claim about whether somebody should act on it. Make that claim honestly
and the level stays worth alerting on.

## The trace id

One id per request, in the **W3C Trace Context** format — 16 bytes as 32 lowercase hex characters,
never all zeros — continued from the caller's `traceparent` header when they sent a valid one, and
started at the edge when they did not. One format for the id this service mints, the one it accepts
and the one a tracing backend stores, so a log line, a response header and a trace are joined by the
same string.

- It goes in **every log line** produced while handling that request.
- It goes in **every response** as the `x-trace-id` header — success or failure, a 204 included —
  and in the body of a failure as the problem's `traceId` (see the `error-handling` skill). A header
  is the one place every response has; a browser reads only the headers CORS exposes, so it is on
  that list.
- It goes in **every outbound call** the request makes, as a `traceparent`, so a downstream
  service's logs join up with yours. The tracing instrumentation below does this for every HTTP
  client it patches.

This is what turns a user's screenshot into a query. Without it, investigating a report means
guessing at timestamps.

Resolve it through one shared helper. Two places that each generate an id when none is present
produce two different ids for one request, and nothing joins. The helper takes, in order: the trace
id of the span the instrumentation opened for the request, when it is loaded; the trace id of an
incoming `traceparent`, when it is not; a new one. With the instrumentation loaded the first is the
only right answer — it already continues the caller's header, and it is the id the trace is exported
under, so an id taken from anywhere else is one a user reports and nobody finds.

### An id the caller sent

A client may propagate its own trace id so one request can be followed across services, and
accepting it is the point. It then goes into every log line and the response header, which makes it
the one piece of caller-controlled text that ends up everywhere:

- **Validate its shape** against the exact W3C form — version `00`, lowercase hex, neither id all
  zeros — and read no version you do not know. Unvalidated it is whatever arrived — a megabyte of
  text, newlines that forge extra log lines, markup a log viewer renders.
- **Replace a bad one, do not refuse the request.** The caller gets a working request and an id that
  leads somewhere, instead of a 400 about a header they may not know they sent.
- **Background work mints the same shape.** A scheduled run's id is a W3C trace id too, so a tool
  that joins on it does not need a second format.

## Tracing and metrics

OpenTelemetry, exported over OTLP to a collector. Where the collector sends the data — which backend
stores traces, which one draws the dashboards — is the deployment's decision, not the application's.

**The instrumentation is loaded before the application, by the start command, always:**
`node --import ./dist/instrumentation.js dist/main`. An instrumentation patches a library when the
library is first loaded; imported from the application's own entry point it arrives after http, the
web framework and the driver already are, and patches nothing — silently. The application's code has
no branch for tracing either way.

- **Its own variables are the switch** — the service name and the collector's endpoint, optional
  together (see the `configuration` skill). Neither set: it registers nothing and the process runs
  untraced, which is what an environment with no collector yet is. Both set: it traces. One of them,
  or either one empty: it refuses to start. The SDK would otherwise fill the missing one in, a
  collector on localhost or a service called `unknown_service`, and the process would report healthy
  while its telemetry went nowhere under a name nobody searches for. The application does not read
  them, so they are not in its contract.
- **It says which it did**, in one line at startup — tracing to which collector under which name, or
  off — so an environment that expected traces and has none finds out from its first log line.
- **Instrumentations are listed, not discovered.** One per library the service actually uses — HTTP,
  the web framework, the framework's own layer, the database driver. A meta-package that enables
  everything it can find is a few dozen instrumentations for libraries the process never loads, and
  a decision about what gets traced taken by default.
- **The database instrumentation keeps its statements' values replaced**, which is its default: a
  filter is where an email or a name travels (see *What a request leaves in the log* below — the
  same rule, for spans).
- **Health probes are not traced.** They run every few seconds and say nothing; a trace per probe
  buries every other trace.
- **The metrics point exists from the start** — a meter provider with a periodic OTLP exporter —
  even if nothing but the HTTP instrumentation records into it yet. Adding a measurement later is
  then a counter, not an infrastructure change.
- **Flush on shutdown.** Spans are exported in batches, and a batch still in memory at exit is lost
  — the one covering the moments before the shutdown. The instrumentation registers how to flush,
  and the application's shutdown hook calls it after the server has stopped, when the last requests'
  spans are complete.

## The request context

Code deep in the call stack sometimes needs the trace id or the current principal — the audit
repository is the standard case. Injecting the request would make every provider above it
request-scoped and spread that up the whole graph (see the `module-wiring` skill).

Use an ambient context backed by async local storage, established by middleware at the edge and read
where needed. It survives `await` boundaries within the request, which is what makes it work at all.

**It does not survive work that starts outside the request.** A scheduled job, or anything started
and not awaited, runs outside it, and reading the context there yields nothing. Those establish
their own context with their own id:

- A scheduled run gets one id for the run, on every line it produces.
- An event handled by the in-process bus needs nothing: the bus emits synchronously inside the
  request's async context, so the handler's lines carry the request's id already.
- An event that crosses a process boundary — a queue, an outbox relay — carries the id in its
  metadata, and the consumer establishes its context from it, so the consequence can be traced back
  to its cause.

A log line from background work with no id is a line that can never be connected to anything.

## What a request leaves in the log

**What happened to the request, never what it carried.** A body, a query string and the route
parameters are where the fields a person typed travel — an email, a name, a search for somebody —
and a log has a different retention and a different audience from the database those values were
meant for. Masking does not fix it: personal data has no fixed key to mask by.

- The request line carries the method, the path **without its query string**, the headers (with the
  credentials redacted) and the address — shaped once, in the logger's request serializer, not
  filtered call by call.
- A refused request logs the method, the path, the status, the error code, the trace id and, for a
  validation failure, the **names** of the rejected fields — `price.amountMinor`, a dotted path for
  a nested one. The names are what make a 400 diagnosable; the values are the caller's.
- A refusal carries no `err`. A validation exception holds the whole submitted body on each of its
  errors, so serializing it puts back exactly what the line leaves out. A fault keeps `err`, because
  its stack is what somebody has to read.

## Masking

Sensitive values are masked centrally, as a formatter every line passes through rather than a call
somebody remembers — request headers carrying credentials, password fields, tokens, and whatever the
personal-data classification marks (see the `security` skill). The walk descends only into arrays
and plain objects: an `Error` iterated as an object loses its message and stack, which are not
enumerable, and a request object iterated as one is followed in circles.

**Redaction covers both directions.** A list that names only request headers misses the response,
and the response is where newly issued credentials are: `set-cookie` carries the session tokens of
every sign-in and every refresh, in plain text, at `info` level, for anybody with log access. The
request side catches the credential the caller presented; the response side catches the one just
handed out.

Masking is the safety net. The first defense is not putting the value in a log line, and a mask
configured for a field name does nothing for the same value under a different name or nested inside
a serialized object.

**A masked secret keeps none of itself.** Showing the last four characters is a habit borrowed from
card numbers, where the rest is unrecoverable and the tail identifies the card to its owner. A token
has neither property: the tail identifies nothing to anybody, and it shortens the search space for
whoever has the log.

There is one exception — an authorization header is `<scheme> <credential>`, the scheme is not a
secret, and keeping it says which authentication a request used. **It belongs to the key, never to
the shape of the value.** Deciding it by looking for a space in the value instead means every
passphrase is read as a scheme followed by a credential: `"correct horse battery staple"` is written
to the log as `"correct horse battery [REDACTED]"`, on every failed login, and on a mistyped
password change it is the account's CURRENT password that leaks. The passwords current guidance
recommends become the ones that leak, and the single-word password — the weaker one — is the only
kind fully hidden.

A rule built for one field and applied to every field it matches is worth re-reading whenever the
list of matched names grows.

**Keys are matched whole, from a list — never as a substring.** A pattern that finds `pin` anywhere
in a key also hides `shippingAddress` and `opinion`; one that finds `code` hides `currencyCode` and
`postalCode`; `pass` takes `compass` with it. The log then loses exactly the fields an investigation
starts from, and every new field is a guess about whether it survives. Compare the key after
lowercasing it and dropping `_` and `-`, so `apiKey`, `api_key` and `x-api-key` are one entry, and a
miss is fixed by adding one line.

**The list is wider than the obvious four.** `pin`, `otpCode`, `resetCode`, `credential`,
`passphrase`, `session`, `signature`, `salt`, `hash`, `cvv` — each is what some real payload calls
something that must not be readable. A bare `code` is not on it: it is what an error code is called,
and the log needs it.

The health endpoints are excluded from request logging: they run constantly, they say nothing, and
they bury everything else.

## Health checks

Two endpoints, because they answer different questions and a platform does different things with the
answers. Both are built on `@nestjs/terminus`, which runs the checks, bounds them and shapes the
answer:

- **Liveness, `/health/live`** — is the process alive. It checks nothing external and it is fast. A
  liveness check that queries the database restarts the application every time the database
  hiccups, which takes a recoverable problem and makes it an outage. It is what a container's own
  healthcheck points at.
- **Readiness, `/health/ready`** — can it serve traffic right now. It pings the dependencies it
  cannot work without, each with a timeout well under the probe's own, and answering 503 takes the
  instance out of rotation without killing it. A ping with no timeout hangs with the database, and
  the platform then reads its own timeout instead of the answer.

```typescript
@Controller({ path: "health", version: VERSION_NEUTRAL })
export class HealthController {
  @Get("ready")
  @HealthCheck()
  public async ready(): Promise<HealthCheckResult> {
    if (this._shutdown.isShuttingDown) {
      throw new ServiceUnavailableException();
    }

    return await this._health.check([
      async (): Promise<HealthIndicatorResult<"database">> =>
        await this._mongoose.pingCheck("database", { timeout: DATABASE_PING_TIMEOUT_MS }),
    ]);
  }
}
```

- **Outside the versioned API and its prefix.** They are a contract with the platform, not with the
  clients, and a probe configured against a version breaks the day the next one ships (see the
  `presentation-layer` skill).
- **Readiness answers 503 from the termination signal on**, before and instead of the checks:
  nothing is wrong, so there is no failed check to report — see graceful shutdown below.
- Both are public routes (see the `authentication` skill) and skip the rate limit, and neither
  returns detail an anonymous caller should not have: a failing readiness check answers with a
  problem body, not with the connection error. The check itself logs which dependency failed, which
  is why the filter records the 503 as a refusal (see the `error-handling` skill).

## Graceful shutdown

Shutdown hooks are enabled explicitly on the application, or none of them run.

On the termination signal: **fail readiness, keep serving for a drain window, then stop accepting
connections**, let in-flight requests finish within a bounded window, close the database
connections and stop the schedulers, then exit. Without this, every deploy drops whatever was in
flight — which looks to users like random failures correlated with nothing they can see.

**The drain window exists because the signal and the load balancer run on different clocks.** Close
the server the moment the signal arrives and every request the balancer sends before its next
readiness poll hits a closed port. So a `beforeApplicationShutdown` hook marks the instance as
stopping — readiness answers 503 from then on — and waits the configured window while the server
still serves; only then does shutdown carry on.

- The window is configuration, because only the deployment knows the balancer's probe interval and
  how many failures it waits for. It has to fit inside the platform's own grace period, or the
  platform kills the process mid-drain. Zero is a legitimate value where nothing balances in front.
- **Only a signal waits.** A close requested in code — a test, a script — has no balancer in front
  of it, and waiting there only slows every test suite down.

Anything buffered is flushed before exit. A buffer that is discarded on shutdown loses exactly the
lines explaining why the process was shutting down.

## Checklist

- [ ] No `console.*` outside the top-level catch of an entry point; every other line goes through a
      `Logger` field carrying its class as context.
- [ ] Every log line is an object with a constant message and variable fields.
- [ ] Every logged error is under the `err` key.
- [ ] Every external dependency is named at startup — host and database, never the credentials.
- [ ] No entity or payload is serialized into a log line.
- [ ] Nothing the API refused on purpose is logged at `error`.
- [ ] Every line carries a trace id in the W3C format, and every response carries it as the
      `x-trace-id` header — exposed through CORS — resolved through one helper that prefers the
      active span's id and continues a valid incoming `traceparent`.
- [ ] Every outbound call forwards the trace id as a `traceparent`.
- [ ] The tracing instrumentation is always loaded by the start command, before the application; its
      own variables switch it on, all or none, never empty; it lists its instrumentations, states at
      startup whether it traces, and is flushed at shutdown.
- [ ] Deep code reads the ambient context; nothing injects the request.
- [ ] Background work establishes its own context and id, and an event that leaves the process
      carries the trace id in its metadata.
- [ ] Redaction covers request headers AND response `set-cookie`; health endpoints are excluded.
- [ ] No log line carries a request body, a query string or route parameters; a refusal names the
      rejected fields and nothing they held.
- [ ] Masking matches whole keys from a list, and runs on every line.
- [ ] Liveness checks nothing external; readiness pings what the process cannot work without, each
      ping with a timeout, and both sit outside the versioned API.
- [ ] Readiness answers 503 from the termination signal on, and shutdown waits the configured drain
      window before the server stops accepting connections.
- [ ] Shutdown hooks are enabled, in-flight work is drained, and buffers are flushed.
