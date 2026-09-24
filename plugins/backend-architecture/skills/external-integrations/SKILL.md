---
name: external-integrations
description: "Talking to systems you do not control — the provider adapter behind a port, timeouts as bounded constants, retrying only what is safe to retry, sending an idempotency key outward, circuit breaking on a hot path, validating a response instead of trusting its type, never calling out inside a transaction, receiving webhooks with signature verification and replay protection, and simulators that stand in for a provider outside production."
when_to_use: "Trigger on — writing an adapter or a client for a third-party API, a request with no timeout, choosing where a timeout lives, deciding whether an adapter needs a circuit breaker, a retry that charged a customer twice, a slow dependency taking the whole service down with it, parsing a provider response, receiving a webhook, verifying a signature, enabling `rawBody`, a webhook delivered twice or out of order, configuring a vendor SDK's credentials, an SDK that authenticated with credentials nobody passed it, replacing a provider with a simulator, a simulator that is never selected, a stub that answers plausibly in production, or a development double for something that runs in a container."
---

# External integrations

Everything outside the process is slow, occasionally wrong, and sometimes lying. The adapter's job
is to keep all three from reaching the domain.

## The adapter sits behind a port

The application layer declares what it needs; infrastructure implements it against one provider (see
the `application-layer` skill). The port speaks the domain's language — `charge(amount, reference)`,
not `postV2ChargesRequest`.

That boundary is what makes the provider replaceable, the simulator possible, and the use case
testable without the network. An adapter that leaks the provider's vocabulary outward has not built
a boundary, only a folder.

The adapter is also where the provider's errors become domain errors. A 402 from a payment provider
becomes `PaymentDeclinedError`; a 500 becomes a transient failure. Nothing above the adapter knows
what a status code is.

An adapter names its target when it boots — the endpoint and bucket, the SMTP host, never a
credential — because the adapter is the one place that knows it; the rule is `observability`'s.

## Outbound calls

- **Every call has a timeout** — a named, bounded constant in the adapter, and configuration only
  when an operator has to tune it per deployment. A client with no timeout inherits the operating
  system's, which is measured in minutes — long enough for every worker to end up waiting on one
  unresponsive dependency. A variable nobody tunes is one more thing a deployment can set wrong.
- **The timeout is shorter than the caller's own budget.** A request with a 30-second deadline
  calling a dependency with a 60-second timeout has a deadline that means nothing.
- **Retry only what is safe to retry.** A read is safe. A write is safe only if the provider treats
  the repeat as the same operation — which means sending an idempotency key.
- **Send an idempotency key on every outbound write.** It is the same mechanism this API offers its
  own callers (see the `transactions-and-consistency` skill), and it is the only thing that makes
  "retry the charge" a safe sentence. The key is derived from the domain operation, so the retry of
  a specific settlement always carries the same one.
- **Back off exponentially with jitter, and cap the attempts** — same rules as any other retry (see
  the `background-jobs` skill).
- **Break the circuit where a dependency sits on a hot path and can fail slowly.** After repeated
  failures, fail fast for a cooldown instead of queueing requests against something that is down.
  Without it, one dead dependency exhausts the connection pool and takes down endpoints that never
  touch it. An adapter called off the request path, or one that fails fast on its own, needs its
  timeout and its retry cap, not a breaker: there is no queue of callers for it to protect.

**Never call out inside a transaction** — the `transactions-and-consistency` skill owns why, and
where the call goes instead.

## Credentials come from configuration, never from the ambient chain

A vendor SDK that finds no credentials usually does not fail. It falls back to a chain — the
machine's profile, instance metadata, well-known environment variables — and signs with whatever it
finds there. An application missing its keys then works perfectly on the developer's laptop, against
that developer's own account, and the first sign anything is wrong is data appearing in somebody
else's environment.

Pass the credentials explicitly from validated configuration, and make them required, so a missing
key is a boot failure naming the variable rather than a silent change of identity.

## Trust nothing about the response

A typed client is a claim, not a check. Validate the payload's shape at the adapter boundary and
fail loudly when it does not match — a provider that adds, renames, or nulls a field ships that
change without telling you, and an unvalidated response turns it into a wrong value flowing into the
domain hours before anyone notices.

Log the provider's correlation identifier, not the whole payload: the payload is somebody else's
data, often personal, and it does not belong in your logs (see the `observability` skill).

## Receiving webhooks

An inbound webhook is an unauthenticated public endpoint until you make it otherwise.

- **Verify the signature against the raw body**, before parsing. Re-serializing the parsed body
  changes the bytes, and the signature stops matching for reasons nobody can debug. The framework
  has to be told to keep the raw body — `NestFactory.create(AppModule, { rawBody: true })`, read as
  `request.rawBody` — and it is told so with the first webhook, not before: the option keeps a
  second copy of every request body in memory, for every route, and only the webhook reads it.
- **Compare in constant time.** A normal string comparison leaks the correct signature one byte at a
  time.
- **Reject anything outside a short timestamp window**, so a captured request cannot be replayed
  later.
- **Treat delivery as at-least-once and out of order.** Record the provider's event id and ignore a
  repeat; carry the event's own timestamp or sequence and ignore one older than the state you
  already have. A provider retrying a delivery you already processed is normal traffic.
- **Answer fast.** Acknowledge, then do the work — a provider that times out retries, and a slow
  handler turns one event into five.
- **Do not trust the payload's contents.** Use it to learn *that* something happened, then read the
  authoritative state back from the provider's API for anything that matters.

The route's URL is not a secret. Anyone who can guess it can post to it, which is why the signature
is the whole of the security.

## Simulators

**First ask whether the environment needs a different implementation at all.** Anything that runs in
a container locally — the database, object storage, an SMTP server, a queue — gets the *real*
adapter in every environment, pointed somewhere else by configuration. The endpoint changes; the
code does not.

That is not a small saving. A second implementation for development is a code path production never
runs: the signature, the constraints and the error handling of the real one are exercised for the
first time in the environment where being wrong costs the most. Running the real adapter against a
local container tests all of it for the price of one endpoint variable.

What is left is what genuinely cannot run here: a payment provider with no sandbox, an SMS gateway
that charges per message, a partner API behind a contract. That one is replaced outside production
by a simulator, chosen in the module's factory (see the `module-wiring` skill).

**A stub is not automatically the safe default.** Ask what it does when it is wrong:

- A stub that **answers plausibly** — a placeholder upload URL, a fake payment reference — reports
  success for work that did not happen. In production that is the worst failure there is: the record
  says the file is stored, the id is handed to a user, and nothing looks wrong until somebody
  follows it.
- A stub that **fails loudly** is the one production gets until a real adapter is bound. Refusing to
  boot is earlier and louder still, but it punishes a project that never uses that port, so the
  failure belongs at the first actual use.

The opposite mistake is as common: a double that never runs. A simulator bound in no environment is
dead code that drifts from the port it claims to implement, and the suite it was written for is
talking to the real thing without anybody noticing.

A simulator that is warranted behaves like the provider:

- **It answers from its inputs, never from state it holds in memory.** A restart or a watch-mode
  reload must not change what an already-issued operation resolves to.
- **An identifier it did not issue is reported as unknown**, not guessed at. The most useful thing a
  simulator does is fail the way the real provider fails.
- **It simulates the failures too** — the decline, the timeout, the malformed response — because
  those are the paths that are never exercised otherwise and are exactly the ones that break in
  production.

## Checklist

- [ ] Every provider is behind a port whose vocabulary is the domain's.
- [ ] Provider errors become domain errors in the adapter; no status code travels upward.
- [ ] Every call has a timeout shorter than the caller's budget — a named constant in the adapter,
      or configuration when operators tune it.
- [ ] Every adapter logs its target at boot, with no credential in the line.
- [ ] Only safe operations are retried, with backoff, jitter, and a cap.
- [ ] Every outbound write carries an idempotency key derived from the domain operation.
- [ ] Every dependency on a hot path that can fail slowly trips a circuit rather than queueing.
- [ ] No outbound call happens inside a transaction.
- [ ] Every response is validated at the boundary; no provider payload is logged whole.
- [ ] Webhooks verify the signature against the raw body in constant time, within a timestamp
      window.
- [ ] Webhook handlers are idempotent, tolerate out-of-order delivery, and acknowledge before
      working.
- [ ] Only a provider that cannot run locally has a simulator; everything with an image runs the
      real adapter against a local container.
- [ ] Every simulator is reachable in some environment, and no stub answers plausibly in
      production.
- [ ] Simulators answer from their inputs and can produce the provider's failures.
