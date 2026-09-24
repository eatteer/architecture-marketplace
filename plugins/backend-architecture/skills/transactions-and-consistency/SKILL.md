---
name: transactions-and-consistency
description: "Units of work and their guarantees — the transaction manager, why a transaction is not a lock, write conflicts and reading an aggregate inside the unit of work that saves it, retries and what must be hoisted above `run(...)`, the one-aggregate atomicity boundary, unique indexes as the real uniqueness guarantee, serializing a rule with a guard document, idempotency keys and request fingerprints, at-least-once delivery, eventual consistency, compensations and reconciliation."
when_to_use: "Trigger on — wrapping work in `_transactionManager.run(...)`, loading an aggregate before the unit of work opens, a concurrent change silently overwritten, a quota/balance/uniqueness check that fails only under two simultaneous requests, a duplicate record from a double click or a retried request, a transaction that commits partially, work that must span two aggregates, an external call inside a transaction, a state change that must happen once happening twice, an idempotency key reused with a different body."
---

# Transactions and consistency

```typescript
export const TRANSACTION_MANAGER_TOKEN: unique symbol = Symbol("TRANSACTION_MANAGER_TOKEN");

export interface ITransactionManager {
  run<T>(work: (transaction: Transaction) => Promise<T>): Promise<T>;
}
```

The use case opens a unit of work and passes the `transaction` down to every repository call inside
it (see the `application-layer` skill for the canonical shape). Everything below is about what that
buys you, and what it does not. The read and write concerns the implementation states are the
`persistence-layer` skill's.

## A transaction is not a lock

This is the single most expensive misunderstanding in this area, so it goes first.

A transaction guarantees that the writes inside it all land or none do, and that its reads see a
consistent snapshot. It does **not** stop another transaction from doing the same work at the same
time. Conflicts are detected only between transactions that **write the same document**.

So a transaction that *reads* a total and then *inserts* a new document never touches what a
concurrent transaction writes. Both read the same total, both pass the check, both commit, and the
rule they were both enforcing is now broken.

```typescript
// ❌ two simultaneous requests both see 4 and both insert — the account ends with 6
const count = await this._ordersRepository.countOpenFor(accountId, transaction);

if (count >= MAX_OPEN_ORDERS) {
  throw new TooManyOpenOrdersError(accountId);
}

await this._ordersRepository.save(order, transaction);
```

**The symptom is a quota, balance, or uniqueness rule that holds under manual testing and fails
under two simultaneous requests** — which means it holds in every test you write by hand and breaks
in production the first time two people click at once.

There are exactly two things that actually enforce such a rule: a unique index, and making both
transactions write the same document.

## Retries are the normal case

When two transactions do conflict, one of them aborts and is retried. Under load this is not an
exceptional path, it is the ordinary one — which means **everything inside the callback must be safe
to run more than once**.

Anything that cannot be re-derived on a second attempt is hoisted above `run(...)`:

```typescript
public async execute(command: SettleOrderCommand): Promise<Order> {
  // ✅ the clock read once, before the callback that may run twice
  const settledAt = this._clock.now();

  return await this._transactionManager.run(async (transaction: Transaction): Promise<Order> => {
    const found = await this._ordersRepository.getById(command.orderId, transaction);

    if (!found) {
      throw new OrderNotFoundError(command.orderId);
    }

    found.settle(command.performedBy, settledAt);

    await this._ordersRepository.save(found, transaction);

    return found;
  });
}
```

The cases that bite:

- **Draining an event buffer.** Inside the callback it happens once per attempt, rolled-back ones
  included; the drain belongs after `run(...)` returns, on the aggregate it returned. See the
  `event-driven` skill.
- **`new Date()` or a random value feeding a stored calculation.** The retry computes a different
  number than the one the guard above it checked. A repository is no exception: a record's timestamp
  is the use case's clock read, passed down as an argument, not a `new Date()` inside the write.
- **A read that does not take the transaction.** It sees a different snapshot each attempt.
- **Appending to something outside the transaction** — a local array, a cache, a counter. It
  accumulates once per attempt.

**Never call an external system inside the callback.** It cannot be rolled back, it will be called
again on the retry, and it holds the transaction open for the duration of somebody else's outage.
Call it before, or after, and design for the failure mode that creates.

## An aggregate written in a unit of work is read inside it

`save()` writes the whole aggregate (see the `persistence-layer` skill), so it writes back every
field of the copy it was handed — including the ones this request never touched. A copy read before
the callback opened is a snapshot of some earlier moment: whatever another request committed since
is overwritten in silence. No conflict is raised when that commit landed before the callback opened,
because the stale read was never part of the transaction; and when one is raised, the retry saves
the same stale copy again.

So the load, the guard, the mutation and the save all happen inside the callback, and the callback
returns the aggregate (the snippet above). **An instance read outside — a page of a batch, a lookup
made before an external call — is read again inside, by id, before it is saved.** The outside read
only decides what to work on; the inside read is the state the write builds on.

## The atomicity boundary is one aggregate

A transaction covers **one aggregate**. That is what an aggregate is for: it is the set of state
that changes together.

When work touches a second aggregate, the honest options are two:

- **The second change genuinely must be atomic with the first** — a balance check followed by the
  debit, where a window between them is a bug. Then the second feature's use case is enlisted in the
  caller's transaction (see the `application-layer` skill), and you have accepted a wider
  transaction with more conflict surface.
- **The second change may happen shortly after** — the common case. Then it happens through an
  event, after the commit, and the system is eventually consistent by design.

**Prefer the second.** Widening a transaction to cover more aggregates increases the number of
documents it writes, which increases conflicts, which increases retries, which increases the cost of
everything inside it. It converts a design question into a throughput problem.

## Enforcing uniqueness

A unique index is the only real guarantee. A read-then-write check in a use case is a **user
experience improvement**, not a constraint: it turns the common case into a clean domain error
instead of a driver error, and it does nothing about the concurrent case.

So do both:

```typescript
const existing = await this._usersRepository.getByEmail(email, transaction);

if (existing) {
  throw new EmailAlreadyRegisteredError(email.value);
}
```

…and declare the unique index, and translate its violation into the same domain error at the
repository boundary, so the concurrent loser gets the same response as the sequential one. Index
declaration belongs to the `persistence-layer` skill.

## Claiming a state change instead of saving it

A rule of the form "this may only happen once" — redeeming a voucher, accepting an invitation,
closing a period — cannot be enforced by reading the state and then writing the new one. Both
callers read the same usable state and both write.

The condition goes **into** the write, and the answer is what the use case branches on:

```typescript
public async claimRedemption(voucher: Voucher, transaction: Transaction): Promise<boolean> {
  const result = await this._voucherModel
    .updateOne({ _id: voucher.id, redeemedAt: null }, { $set: { redeemedAt: voucher.redeemedAt } })
    .session(sessionOf(transaction))
    .exec();

  return result.matchedCount === 1;
}
```

The aggregate still decides what the new state is; the filter only decides who is allowed to write
it. That keeps the rule in the domain and the exclusivity where it can actually be enforced.

This is not the same tool as the guard document below. A claim protects a transition of one
document that already exists; a guard document manufactures a collision for a rule that owns no
document at all.

## Returning the outcome instead of throwing inside

When the reaction to a failed rule is itself a **write** — void the rest of the campaign, record the
attempt, flag the account — it cannot be done inside the unit of work that discovered it. A voucher
redeemed a second time means its code leaked, so every voucher of its campaign is voided:

```typescript
// ❌ the voiding is rolled back by the throw that reports it
const now = this._clock.now();

await this._transactionManager.run(async (transaction: Transaction): Promise<void> => {
  const voucher = await this._vouchersRepository.getById(command.voucherId, transaction);

  if (voucher?.isRedeemed) {
    await this._vouchersRepository.voidCampaign(voucher.campaignId, now, transaction);

    throw new VoucherAlreadyRedeemedError(command.voucherId);
  }

  /* ... */
});
```

```typescript
// ✅ the transaction reports what it found; the caller reacts afterwards
const now = this._clock.now();

const outcome = await this._transactionManager.run(
  async (transaction: Transaction): Promise<RedemptionOutcome> =>
    await this._redeem(command.voucherId, now, transaction),
);

if (outcome.kind === "already_redeemed") {
  await this._transactionManager.run(async (transaction: Transaction): Promise<void> => {
    await this._vouchersRepository.voidCampaign(outcome.campaignId, now, transaction);
  });

  throw new VoucherAlreadyRedeemedError(command.voucherId);
}
```

A throw is the right way to report a rule that changed nothing. The moment the reaction has to
survive, the outcome becomes a value — a small discriminated union — and the transaction's only job
is to decide it. Refresh-token rotation with reuse detection is this shape; the `authentication`
skill owns it.

## Serializing a rule with no unique key

Some rules have nothing to make unique — "at most five open orders per account", "the balance may
not go below zero". Make the concurrent transactions collide on purpose by having both write one
document that stands for the thing being protected:

```typescript
const now = this._clock.now();

await this._transactionManager.run(async (transaction: Transaction): Promise<void> => {
  await this._concurrencyGuardRepository.touch(OPEN_ORDERS_SCOPE, accountId, now, transaction);

  const count = await this._ordersRepository.countOpenFor(accountId, transaction);

  if (count >= MAX_OPEN_ORDERS) {
    throw new TooManyOpenOrdersError(accountId);
  }

  await this._ordersRepository.save(order, transaction);
});
```

`touch` writes a single document keyed by the account — a counter, a timestamp, anything. Two
requests for the same account now write the same document, so one of them conflicts and retries, and
on the retry it reads the count *after* the winner's insert. Two requests for different accounts
touch different documents and never contend.

Two things to hold onto: the guard write goes **first**, so the conflict is detected before the work
rather than after it; and this serializes per key, which is the point — a single global guard
document would serialize the entire endpoint.

**The guard is written with the first rule that needs it**, not shipped ahead of one. It is a port
in the shared domain, one small collection keyed `<scope>:<key>`, and an upsert of that one
document; the scope names the rule (`open-orders`), the key the thing it protects (the account id),
and the timestamp is the one the use case hoisted above the callback. **Read
[references/concurrency-guard.md](references/concurrency-guard.md) when writing it** — the port, the
schema and the repository method are there.

## Idempotency

A retry is not a duplicate the user made. The duplicate that actually happens in production comes
from a request that **did** reach the server and whose response was lost — a dropped connection, a
timeout, a proxy giving up. The client cannot tell that apart from a request that never arrived, so
it retries, and only the server can recognize the retry as the same intent.

Any endpoint that creates something irreversible needs this.

### A client-supplied key, when you control the client

The caller sends an `Idempotency-Key` header holding a value it generates once per intent and reuses
across its own retries.

**The header is validated where it is read**, by the parameter decorator that extracts it, because a
header never passes the request pipeline — that sees the body, the query and the route parameters.
Trim it, refuse a blank one with a 400, and bound its length. Absent stays absent: the key is
optional, and only its presence turns the behavior on. A blank one is not absent — left as `""`,
every such request from one caller collapses onto a single record, and the second create silently
answers with the first one's id.

**The default is transactional: the key and the work commit together.** When everything the request
does is a database write, recording the key in the same transaction as the work makes the two one
fact — either both happened or neither did — and a repeat is answered from the resource itself:

- Store the key with a **unique index**, written in the same transaction as the work, alongside the
  id of the resource the work produced. That is what makes the check race-safe — not the lookup
  that precedes it. Its timestamp is the use case's clock read, passed in like every other value a
  retried callback must not re-derive.
- **Insert it, never upsert it.** The write has to fail when the key is already there; an upsert
  overwrites the winner's record with the loser's resource id, and the retry that arrived second
  becomes the answer everybody gets from then on.
- The violation is translated at the repository boundary into a domain error, and the use case
  answers it by **reading what the winner wrote** and returning that resource id. The application
  layer never recognizes a driver error code — that is infrastructure knowledge in the one place
  that must not have it.
- **The repeat gets the same answer as the first**, rebuilt from the stored resource id — a create
  answers 201 with the id again. Answering 409 to a client that never received the first response
  leaves it with no way to learn the id of the thing it created.
- A repeat that arrives while the first is still in flight collides on the index, and the collision
  is answered like any other repeat: from the record the winner committed.

The port is a shared one, keyed by the route's scope, the principal and the key:

```typescript
export type IdempotencyRecord = { key: string; resourceId: string; fingerprint: string };

export interface IIdempotencyRepository {
  find(scope: string, principalId: string, key: string, transaction?: Transaction): Promise<IdempotencyRecord | undefined>;

  save(
    scope: string,
    principalId: string,
    key: string,
    resourceId: string,
    fingerprint: string,
    now: Date,
    transaction: Transaction,
  ): Promise<void>;
}
```

It raises two domain errors, and the caller has to be able to tell them apart. The **key conflict**
(`IdempotencyKeyConflictError`) is `save` losing the race on the unique index; it never reaches the
client — the use case catches it and answers from the winner's record. The **key reused**
(`IdempotencyKeyReusedError`) is a stored fingerprint that differs from this request's; it is the
409 described under "Either way" below.

The integration suite, against a real replica set, is where the transactional variant is proven: two
inserts with one key — the second refused, the first kept — and nothing recorded after a rollback. A
test double can prove neither (see the `testing` skill).

**Storing and replaying the response is the variant for work that leaves the database** — a charge
at a payment provider, a message sent. There is no single commit to make the key and the effect
atomic, so the key is recorded first as in progress, the effect is performed, and the status and
body are stored beside the key when it completes:

- A repeat of a completed key **replays the stored response**, status included.
- A repeat arriving while the first is still in progress gets 409 with a `Retry-After`: it has not
  finished, so there is nothing to replay yet.
- A key left in progress past a timeout is the reconciliation sweep's to settle, not the next
  request's to overwrite — the effect may have happened.

Either way:

- Scope the key to the principal and the route. A key is meaningful within one caller's namespace;
  treating it as global lets one caller collide with another's.
- **Store a fingerprint of the content alongside the key.** A key identifies an intent, so the same
  key with a different body is not a retry — it is a second intent wearing the first one's name.
  Answering it with the first request's resource is worse than an error: the caller is handed
  something it never asked for, and the response looks exactly like a success. Answer 409, with a
  code distinct from the concurrent-attempt one. The fingerprint is a hash of a canonical
  serialization in the spirit of RFC 8785 — keys sorted, one encoding per value, a `bigint` written
  as a string kept distinct from the number — so two bodies that differ only in field order are the
  same request.
- Expire stored keys on a schedule that comfortably exceeds any client's retry window.

### A server-derived fingerprint, when you do not

Hash the principal, the route and the normalized body, and treat that as the key within a short
window.

This is strictly weaker, so state it out loud: two requests that are legitimately identical and
intentional — the same user buying the same thing twice in a minute — collapse into one. Use it only
when the client cannot be changed, keep the window short, and write the limitation into the
endpoint's documentation.

## At-least-once, and the fiction of exactly-once

Anything that crosses a process boundary — a queue consumer, an outbox relay, a webhook — is
delivered **at least once**. A consumer that acknowledges after doing the work can crash between the
two; one that acknowledges before can crash before doing it. There is no third arrangement, and
"exactly once" describes an outcome you build, not a delivery guarantee you receive. The in-process
event bus sits on the other side of that trade: it delivers at most once, and the `event-driven`
skill's table decides what stands behind it.

So a consumer of an at-least-once delivery is idempotent. The two shapes that work:

- **The work is naturally repeatable** — setting a field to a value, upserting a projection. Running
  it twice changes nothing the second time.
- **The work records that it ran**, keyed by the event or message id with a unique index, and the
  record is written in the same transaction as the effect. A second delivery sees the record and
  stops.

A handler that increments a counter, sends an email, or moves money is in neither category until you
put it in the second one.

## Eventual consistency

When a second aggregate changes after the commit, there is a window in which the two disagree. That
window is a fact of the design, not a bug — but it has to be designed for rather than discovered.

- **Do not promise both in one response.** Return what the request actually changed. A response that
  also reports the derived state is asserting something that is not true yet.
- **A failed second step needs a compensation, and the compensation is a domain action.** It goes
  through the aggregate's own method, emits its own event, and appears in the audit trail. A quiet
  reversal that leaves no record is indistinguishable from data corruption to whoever investigates
  it later.
- **Add a reconciliation sweep where the `event-driven` table asks for one** — a consequence a
  person would notice was missing. A periodic job that finds records left in an intermediate state
  past a threshold and either completes or compensates them is what turns "the handler might not
  have run" from a permanent inconsistency into a delay. The `background-jobs` skill owns running
  it: lock, batches, idempotent items.
- **Make the window observable.** The count of items awaiting their second step — the count a sweep
  finds — is the number that tells you whether the system is eventually consistent or just
  inconsistent. A sweep that suddenly has thousands to fix is telling you something upstream broke.

## Checklist

- [ ] No rule relies on a read-then-write check inside a transaction to enforce it.
- [ ] Every uniqueness rule has a unique index behind it, and its violation maps to the domain
      error.
- [ ] A "may only happen once" transition is a conditional write whose result is checked, not a
      read followed by a save.
- [ ] A reaction that writes is performed outside the transaction that discovered it, on a
      returned outcome rather than a throw.
- [ ] The idempotency record is inserted, not upserted, and its conflict returns the winner's
      resource.
- [ ] Every rule with no unique key that must hold under concurrency writes a guard document first.
- [ ] Nothing inside the callback breaks when it runs twice — events drained after it returns,
      timestamps hoisted, every read takes the transaction.
- [ ] Every aggregate saved inside a callback was read inside that callback; an instance read
      outside is read again by id before it is saved.
- [ ] No repository stamps a record with `new Date()`; the timestamp arrives as an argument.
- [ ] No external call happens inside a transaction.
- [ ] Each transaction covers one aggregate, unless a window between two writes would be a bug.
- [ ] Every endpoint that creates something irreversible accepts an idempotency key — recorded in
      the same transaction as the work and answered with the winner's resource, or, when the effect
      leaves the database, recorded first and answered by replaying the stored response — unless a
      unique index on the caller's own value already makes the repeat impossible, which is the same
      guarantee without the key.
- [ ] An idempotency key arriving in a header is validated: a header does not pass the request
      pipeline, and one sent but blank is not absent.
- [ ] Every consumer of an at-least-once delivery (a queue, an outbox relay, a webhook) is
      idempotent, either naturally or by recording that it ran.
- [ ] Every cross-aggregate step the `event-driven` table places on a reconciliation sweep has one,
      and every compensation it performs goes through the aggregate's own method.
- [ ] The idempotency record's conflict and rollback behavior is covered by an integration test.
