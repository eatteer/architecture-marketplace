---
name: audit-log
description: "The audit trail — the `AuditLog` entry, the `Actor` value object and its project-defined type catalog, recording who changed what and why, the `changes` before/after convention, keeping entries in their own collection rather than inside the entity's document, writing the trail alongside the aggregate, enriching entries with request metadata in infrastructure, and reconciling an append-only trail with an erasure request."
when_to_use: "Trigger on — adding audit tracking to an entity, calling `AuditLog.create(...)` or appending to an entity's entries, declaring an entity's audit actions, adding an actor type, recording a change made by a scheduler or an event handler, writing the audit repository, deciding what belongs in the description versus the metadata, a state change with no record of who made it, a data-deletion request against records that must be kept, an audit entry written for an update that changed nothing, a trail missing after a retried transaction, or a duplicate-key error on the audit collection."
---

# Audit log

An audit entry answers four questions about a state change: who, what, when, and why. Anything an
operator or an investigator would ask afterwards has to be answerable from the trail alone.

## Where entries live

Entries live in **their own collection**, not inside the entity's document.

The trail grows without bound while the entity does not, so embedding it makes every read of the
entity progressively more expensive, for data almost no read wants. A separate collection is also
what lets the trail be queried across entities ("everything this actor did"), indexed for that
question, and retained on its own schedule.

The entity schema therefore has **no** field for its entries. The entity holds them in memory
between a business method and the save, and the repository writes them in the same unit of work.

**Saving does not drain them.** The transaction callback is re-run on a write conflict, and a drain
on the first attempt would leave the second one writing the change without its trail. The entries
stay on the instance, each with the id it was given at creation — so saving the same instance twice
inside one unit of work (outside a retry) inserts the same ids again and fails on a duplicate key
rather than writing a duplicated row. Save an aggregate instance once per unit of work.

## Appending an entry

The entity declares the actions its trail can record — the derived form from `domain-modeling`, an
array literal alone — holds its entries in a private array, and exposes them read-only:

```typescript
export const ORDER_AUDIT_ACTION_VALUES = ["placed", "status_changed"] as const;

export type OrderAuditAction = (typeof ORDER_AUDIT_ACTION_VALUES)[number];

export class Order extends AggregateRoot {
  private readonly _auditLogs: AuditLog<OrderAuditAction>[] = [];

  /* constructor, factories, other getters */

  public get auditLogs(): ReadonlyArray<AuditLog<OrderAuditAction>> {
    return this._auditLogs;
  }

  public changeStatus(status: OrderStatus, performedBy: Actor, now: Date, reason?: string): void {
    if (this._status.equals(status)) {
      return;
    }

    const previous = this._status.value;

    this._status = status;
    this._updatedAt = now;

    this._auditLogs.push(
      AuditLog.create<OrderAuditAction>({
        action: "status_changed",
        performedBy,
        performedAt: now,
        description: reason,
        metadata: { changes: { status: { before: previous, after: status.value } } },
      }),
    );

    this.publishEvent(
      new OrderStatusChangedEvent({ orderId: this._id, status: status.value }, { occurredAt: now, performedBy: performedBy.id }),
    );
  }
}
```

The entry takes the same `now` as the timestamp and the event. That every state-changing method
updates the timestamp and appends an entry — when it also publishes an event, and the one exception,
a change that is not a business action — is the `domain-modeling` skill's rule.

## The `changes` convention

Field-level changes go under a `changes` key in the metadata, each as a `before`/`after` pair:

```typescript
// ✅ machine-readable, and one shape for every entity in the system
metadata: {
  changes: {
    status: { before: "pending", after: "settled" },
    assigneeId: { before: "user-1", after: "user-2" },
  },
},

// ❌ a sentence nothing can query, filter, or diff
description: "Status changed from pending to settled and reassigned from user-1 to user-2",
```

The split is: **`description` is for a human and holds the reason**, the free text somebody typed
about *why*. **`metadata` is for a machine** and holds what changed. A reason belongs in
`description` because no query will ever group by it; a changed value belongs in `metadata` because
every investigation starts there.

**The absent side of a pair is `null`**: `{ before: null, after: "2026-01-01T00:00:00.000Z" }` for a
field that was set for the first time, `{ before: "...", after: null }` for one that was cleared.
This is the one place the domain writes `null` itself, and it is not a domain field: `changes` is a
JSON document read by a machine, and JSON has no `undefined` — an absent key would drop the side
entirely and make "was empty" indistinguishable from "was not recorded".

**A field that did not change produces no entry.** An update method compares before it records, and
records nothing — no entry, no new `updatedAt` — when the submitted value equals the stored one:

```typescript
// ❌ every resend of the same list writes an entry saying nothing happened
if (permissions !== undefined) {
  changes.permissions = { before: [...this._permissions], after: permissions };
  this._permissions = permissions;
}

// ✅ order carries no meaning in a set, so a reordered list is not a change either
if (permissions !== undefined && !holdsExactly(this._permissions, permissions)) {
  changes.permissions = { before: [...this._permissions], after: permissions };
  this._permissions = permissions;
}
```

`holdsExactly(current, next)` is a shared helper in the common domain utilities: it answers whether
two lists hold the same members, ignoring order and repeats. Every set-valued field compares through
it, so "the same set" means one thing across the codebase.

Clients resend whole objects, and reconciliation jobs resend the same desired state on every run. A
trail that records those is a trail nobody can read: the entries that matter are buried under
entries that describe nothing. It is also what makes a reconciliation safe to run on every deploy —
see the seeding note in the `configuration` skill.

### The trace id belongs on the row

The trail says who changed what; the logs say what else happened while it was being changed. Without
the trace id on the audit row neither question can be answered from the other side, and the request
context already carries it — this is the infrastructure layer's job, alongside the address and the
agent.

## The actor

```typescript
export const USER_ACTOR_TYPE_VALUE = "user";
export const SYSTEM_ACTOR_TYPE_VALUE = "system";

export const ACTOR_TYPE_VALUES = [USER_ACTOR_TYPE_VALUE, SYSTEM_ACTOR_TYPE_VALUE] as const;

export type ActorTypeValue = (typeof ACTOR_TYPE_VALUES)[number];

export class Actor {
  private readonly _type: ActorTypeValue;
  private readonly _id?: string;

  private constructor(type: ActorTypeValue, id?: string) {
    this._type = type;
    this._id = id;
  }

  public get type(): ActorTypeValue {
    return this._type;
  }

  public get id(): string | undefined {
    return this._id;
  }

  public static create(type: string, id?: string): Actor {
    if (!isActorTypeValue(type)) {
      throw new InvalidValueObjectError("Actor", type);
    }

    const isSystem = type === SYSTEM_ACTOR_TYPE_VALUE;

    if (isSystem && id !== undefined) {
      throw new InvalidValueObjectError("Actor", `${type}:${id}`);
    }

    if (!isSystem && (id === undefined || id === "")) {
      throw new InvalidValueObjectError("Actor", type);
    }

    return new Actor(type, id);
  }

  public static user(id: string): Actor {
    return Actor.create(USER_ACTOR_TYPE_VALUE, id);
  }

  public static system(): Actor {
    return new Actor(SYSTEM_ACTOR_TYPE_VALUE);
  }
}
```

`create()` holds the one invariant: **`system` carries no id, and every other type requires one.**
An entry attributed to "a user" with no id answers nothing, and a `system` entry with an id claims
a person was involved when none was.

**The actor type catalog is defined per project**, and two members earn their place in every one:
`user`, a person acting through the API, and `system`, the platform acting on its own. Add a type
only for a caller that authenticates through a different door — a separate identity store, a
machine-to-machine integration. Splitting people who sign in the same way is a permissions question
(see the `authorization` skill).

`system` is **written to the entry, not left blank**. It is what keeps "nobody did it" and "nobody
recorded it" distinguishable, and the second one is a bug you want to be able to find.

Where the actor comes from — the use case, and nowhere else — is the `application-layer` skill's
rule.

## Writing the trail

The repository persists the aggregate and then its pending entries, in the same unit of work:

```typescript
public async save(order: Order, transaction?: Transaction): Promise<void> {
  /* upsert the aggregate document */

  if (order.auditLogs.length > 0) {
    await this._auditLogRepository.save(
      ORDER_ENTITY_COLLECTION,
      ORDER_ENTITY_TYPE,
      order.id,
      order.auditLogs,
      transaction,
    );
  }
}
```

Same transaction, always. A trail written outside the unit of work records changes that were rolled
back, or misses changes that committed — and an audit trail that is sometimes wrong is worse than
none, because it is still believed.

The collection and entity-type constants are imported from the entity's file; where they live is the
`domain-modeling` skill's rule.

## Request metadata stays in infrastructure

Address, user agent, trace id and similar belong on the entry, and they are added by the audit
repository from the ambient request context — never threaded through a command, a use case, or an
entity field. The trace id is a column of its own, so it can be indexed and searched; the request
agent (address and user agent) is merged into the entry's `metadata` beside the `changes` the domain
wrote. When there is no request context, neither is written.

The domain has no opinion about HTTP. A device fingerprint on a domain method is a transport concern
that has escaped its layer, and it has to be passed by every caller including the ones with no
request behind them. The context itself belongs to the `observability` skill.

## Append-only, and what that means for erasure

The trail is append-only. Entries are never updated and never deleted in the ordinary course of
business — an entry that can be edited proves nothing.

This collides with a request to erase a person's data, and the resolution is to separate the *record
of the action* from the *personal data in it*:

- The entry stays: something happened, at a time, and that fact is usually the thing a legal
  obligation requires you to keep.
- Personal values inside it are anonymized in place — the actor id is replaced with a stable opaque
  reference, and personal values in `changes` are redacted.
- The anonymization is itself an audited action, performed by a known actor.

Decide the retention window for entries separately from the entities they describe, and put the
decision where a reader finds it: an expiry on the collection when the window is fixed, or a stated
decision to keep them indefinitely when the trail outliving the data is the point. What must not
exist is a window somebody assumed and nothing applies — and never two mechanisms, because the
shorter wins in silence and the other one runs to delete nothing.

## Checklist

- [ ] Audit entries live in their own collection, and the entity schema has no field for them.
- [ ] Every entity with a trail declares its audit actions as a derived union, holds its entries in
      a private array, and exposes them as a `ReadonlyArray`.
- [ ] Nothing drains the entries on save, and no unit of work saves the same instance twice.
- [ ] An update that changes nothing appends no entry and does not move `updatedAt`; set-valued
      fields compare with `holdsExactly`.
- [ ] Field changes are under `metadata.changes` as before/after pairs, with `null` for the absent
      side; `description` holds only the human reason.
- [ ] Every entry has an actor, and a systemic action records `system` rather than nothing.
- [ ] Every `system` actor has no id, and every other actor has one.
- [ ] The trail is written in the same transaction as the aggregate.
- [ ] No request metadata reaches a command, a use case, or an entity.
- [ ] Nothing updates or deletes an entry except a deliberate, audited anonymization.
