---
name: event-driven
description: "Publishing and handling domain events — the event bus interface, draining an aggregate's event buffer, publishing after the commit and never inside the transaction, registering handlers, what a handler may and may not do, why handlers never throw, the in-process bus versus a durable outbox and when the difference starts to matter, and evolving an event's shape."
when_to_use: "Trigger on — writing an `@OnEvent` handler or a `*.handlers.ts` file, calling `getEvents()` or `_eventBus.publish(...)`, wiring a side effect that changes another aggregate, an event that fires but whose effect never happens, events lost after a retry, an event that fires twice, a handler that throws and takes the request down with it, adding a field to an existing event, a feature that must react to another without depending on it, a deleted record whose id stays behind in another feature."
---

# Event-driven side effects

An aggregate records that something happened; a handler decides what else should follow. This is how
one feature reacts to another without depending on it — which is also the resolution to most
dependency cycles (see the `module-wiring` skill).

```typescript
export const EVENT_BUS_TOKEN: unique symbol = Symbol("EVENT_BUS_TOKEN");

export interface IEventBus {
  publish(events: DomainEvent[]): void;
}
```

The bus is in-process and synchronous to dispatch. The event classes themselves belong to the
`domain-modeling` skill.

## When to publish

**The callback returns the aggregate; the events are drained from it after `run(...)` returns, and
published then.** The load, the guard, the mutation and the save all happen inside the callback:

```typescript
public async execute(command: SettleOrderCommand): Promise<void> {
  const now = this._clock.now();

  const settled = await this._transactionManager.run(async (transaction: Transaction): Promise<Order> => {
    const found = await this._ordersRepository.getById(command.orderId, transaction);

    if (!found) {
      throw new OrderNotFoundError(command.orderId);
    }

    found.settle(command.performedBy, now);

    await this._ordersRepository.save(found, transaction);

    return found;
  });

  this._eventBus.publish(settled.getEvents());
}
```

- **The drain happens exactly once, after the commit, never inside the callback.** The callback runs
  once per attempt, and a retry is the ordinary case under load. The aggregate `run(...)` returns is
  the one from the attempt that committed; events drained inside the callback also belong to the
  attempts that were rolled back.
- **Publishing inside the transaction fires handlers for work that may not commit.** The handler
  sends the email, the transaction then aborts, and the customer has been told about an order that
  does not exist.
- **The aggregate is read inside the callback, not before it.** One loaded outside and saved inside
  is a stale copy written over whatever committed in between. The `transactions-and-consistency`
  skill owns that rule.

## Handlers

```typescript
@Injectable()
export class OrdersEventsHandlers {
  private readonly _logger: Logger = new Logger(OrdersEventsHandlers.name);

  public constructor(private readonly _notifyCustomer: NotifyCustomerUseCase) {}

  @OnEvent(OrderSettledEvent.name)
  public async onOrderSettled(event: OrderSettledEvent): Promise<void> {
    await this._notifyCustomer.execute(
      new NotifyCustomerCommand({ orderId: event.payload.orderId, performedBy: Actor.system() }),
    );
  }
}
```

One `*.handlers.ts` class per feature, holding that feature's reactions. The file lives in the
feature's infrastructure: subscribing is a wiring decision, not a domain rule.

**A handler that changes another aggregate calls that feature's use case.** Reaching into its
repository skips its invariants, its own events, and its audit trail — all three, at once, silently.
Calling a repository directly is only for reading, and only when there is nothing to decide.

**A handler that does simple infrastructure work calls it directly.** Sending an email through a
port does not need a use case wrapped around it; a use case that only forwards one call is a file
with no content.

**The actor is `Actor.system()`.** The request that triggered the original change is over, and
whoever made it did not perform this consequence. See the `application-layer` skill.

### Cleaning up after a deletion

The clearest case for an event is a record that other features hold the id of. Deleting a category
leaves its id on every product filed under it: the listing still filters by it and the product page
resolves it to nothing — and the feature that owns categories cannot fix it, because it does not own
products. It says what happened; the other feature answers.

The handler works **one aggregate per unit of work**, not one bulk update:

```typescript
// ❌ leaves a trail saying nobody touched them, and skips every invariant
await this._productModel.updateMany({ categoryIds: categoryId }, { $pull: { categoryIds: categoryId } });

// ✅ each product records who changed it and why — the platform, not a person
found.removeCategory(categoryId, Actor.system(), now);
```

That rule is for aggregates with an audit trail or a per-item invariant. Records that carry neither
— every session a user holds, revoked when the user is suspended — take one bulk repository write:
there is nothing per item to record or check, so a unit of work each would buy nothing.

The sweep batches the way any long job does — the first page of a filter the fixed records leave,
re-read each time, stopping when a full page changes nothing (see the `background-jobs` skill).

The method the aggregate exposes for this is not the one a person uses. Removing a category from an
archived product has to work — the correction is the system's, not a person's — while filing an
archived product under a new one must not.

## Handlers never throw

The publish is fire-and-forget from the use case's perspective: the write already committed and the
response is on its way. An exception escaping a handler cannot undo anything, and depending on how
the bus dispatches it, it either disappears or takes down a request that had already succeeded.

So a handler handles its own failure:

```typescript
@OnEvent(OrderSettledEvent.name)
public async onOrderSettled(event: OrderSettledEvent): Promise<void> {
  try {
    await this._notifyCustomer.execute(/* ... */);
  } catch (error: unknown) {
    this._logger.error({
      message: "Failed to notify customer after settlement",
      orderId: event.payload.orderId,
      // `err`, not `error`: it is the key the serializer recognizes — see the `observability` skill.
      err: error,
    });
  }
}
```

This is one of the two sanctioned endings for a `catch`; the `error-handling` skill owns the rule
and what the output must contain. It is also the point where you have to be honest: **a handler
whose failure is unacceptable does not rest on the handler alone**. If the consequence must happen,
the table under "The in-process bus and its limit" decides what stands behind it — a reconciliation
sweep or an outbox — not a log line.

## Handlers are idempotent

The in-process bus delivers each event at most once, so it never hands a handler the same event
twice. Redelivery comes from what stands behind the bus: a reconciliation sweep re-running the
consequence, an outbox relay delivering at least once, a replay. Write the handler so running twice
is indistinguishable from running once — either because the work is naturally repeatable or because
the handler records that it ran — and moving it behind a sweep or an outbox changes nothing in it.
The `transactions-and-consistency` skill owns both shapes.

## The in-process bus and its limit

Publishing happens after the commit, so there is a window: the transaction commits, the process
dies, and the events are gone. Nothing retries them, because nothing durable ever knew they existed.

This is a real limitation with a defined boundary, and the boundary is what tells you when the
simple bus stops being enough:

| The consequence is… | Shape |
| --- | --- |
| Recoverable by a later sweep, or merely convenient | the in-process bus, with idempotent handlers |
| Something a person would notice was missing | the in-process bus, plus a reconciliation job |
| Money, a legal obligation, or an irreversible external call | an outbox |

An **outbox** removes the window by making the event part of the write: the handler's input is
inserted into an outbox collection **inside the same transaction** as the aggregate, and a separate
relay reads that collection and publishes. The event is now as durable as the data that produced it,
and delivery becomes at-least-once rather than at-most-once.

The cost is a relay to run, an ordering question to answer, and consumers that must already be
idempotent — which they must be anyway.

## Evolving an event

An event is a contract with handlers that were written against it, including ones in other features.

- **Adding an optional field is safe.** Existing handlers ignore it.
- **Removing or repurposing a field is not.** A handler reading it keeps compiling and starts being
  wrong.
- **A materially different shape is a new event class**, published alongside the old one until every
  handler has moved. Redefining the meaning of an existing event is the change that produces effects
  nobody can trace back to a cause.

Payloads carry identifiers and the values a handler needs to act, never whole entities. An entity
serialized into an event is a snapshot that is already stale by the time it is read, and it couples
every handler to the shape of an aggregate they do not own.

## Don't register a handler with nothing in it

An empty `@OnEvent` method with a placeholder comment reads as a real side effect to the next person
editing the file, and it makes the event look handled in every search for its consumers. If nothing
should happen yet, nothing subscribes.

## Checklist

- [ ] Every `getEvents()` call runs once, after `run(...)` returns, on the aggregate the callback
      returned — never inside the callback.
- [ ] Every `publish(...)` happens after the commit.
- [ ] Every handler that changes another aggregate goes through that feature's use case.
- [ ] Every handler catches its own failures and cannot throw.
- [ ] A deletion other features hold the id of is announced, and the cleanup runs one aggregate
      per unit of work for aggregates with a trail or an invariant.
- [ ] Every handler is idempotent, naturally or by recording that it ran.
- [ ] Every consequence a person would notice missing has a reconciliation sweep behind it, and
      every one involving money, a legal obligation or an irreversible external call has an outbox.
- [ ] Every event payload carries identifiers and values, not entities.
- [ ] No handler body is empty.
