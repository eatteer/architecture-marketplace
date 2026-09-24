---
name: domain-modeling
description: "The domain layer of a feature — entities, aggregate roots, value objects, enum-like value unions, domain events, domain error classes, repository interfaces, the opaque `Transaction` type, and the `?` vs `null` convention across layers."
when_to_use: "Trigger on — writing or editing a `*.entity.ts`, a value object, a `*.events.ts` or `*.errors.ts` file, a repository interface (`I*Repository`), extending `AggregateRoot`, writing `create()` or `reconstitute()`, deciding whether a rule is a getter or a policy, deciding whether a value object belongs in the feature or in `common/`, normalizing a name or an email, a name whose capitalization was changed on save, adding a second enum-like axis to an entity, choosing where an exported constant lives, a PATCH field that must distinguish 'unchanged' from 'cleared', using `FieldUpdate` or `CLEAR_FIELD`, generating an entity id, a conditional repository write, or a state change that updated the row but emitted no event, or a field that cannot be cleared once it has been set."
---

# Domain modeling

Lives in `src/features/<feature>/domain/`. This layer imports nothing from the framework, the
database driver, or any other layer — no decorators, no DTOs, no schemas. If a file here needs an
import from `infrastructure/` or `presentation/`, the rule it holds is in the wrong layer.

```text
domain/
├── entities/            user.entity.ts
├── value-objects/       email.ts, user-status.ts
├── events/              user.events.ts
├── repositories/        users.repository.ts
└── users.errors.ts
```

## Where validation lives

Four tiers, and the question that selects one is *what does the rule need in order to decide*:

| The rule needs… | Lives in | Fails by |
| --- | --- | --- |
| Only the shape of the request (type, presence, format, length) | the request DTO | a 400 from the validation pipe |
| Only one value | a value object's `create()` | throwing an invalid-value error |
| Only state already inside the aggregate | an entity method | throwing a domain error |
| Another aggregate, or a query | a policy called by the use case (see `application-layer`) | returning a verdict the use case acts on |

**Entities receive value objects, never raw primitives.** A method that takes a `string` has to
either trust it or re-validate it, and both answers are wrong: trusting it means the invariant is
enforced nowhere, re-validating it means the same rule now lives in two places. A parameter typed
`Email` cannot be given an unvalidated string, so the invariant is enforced by the type system at
every call site including the ones written later.

The use case is what constructs the value objects, so the failure lands before any state changes.
See the `application-layer` skill for the calling side.

## Entities and aggregate roots

An entity has identity and a lifecycle. An **aggregate root** is the entity that owns a consistency
boundary: it is the only thing a repository loads and saves, and everything inside that boundary
changes together or not at all.

A complete aggregate root is in [examples/user.entity.ts](examples/user.entity.ts): the collection
and entity-type constants, the audit actions, a private constructor, `create()`, `reconstitute()`,
getters, and a business method that guards, mutates, stamps, audits and emits. Read it before
writing or reviewing an entity; the rules below are what it shows.

- **`create()` is the birth of a new instance and emits events. `reconstitute()` rebuilds one that
  already exists and emits nothing.** Reconstitution is not a business action; publishing from it
  would re-fire a creation event on every read.
- **Prefer several named factories over one `create()` with optional parameters.**
  `Order.placedByCustomer(...)` and `Order.importedFromProvider(...)` each state their preconditions
  and emit their own event; one factory branching on which arguments arrived states neither.
- **Getters expose the primitive, not the value object.** Every consumer — mappers, DTOs,
  comparisons — wants the value. When a caller appears to need the value object's behavior, that
  behavior is a method on the entity, not something the caller should be reaching in to perform.
- **No bare setters.** A business method that mutates state **always** updates `_updatedAt` and
  appends an audit entry (see the `audit-log` skill for the entry's shape), both from the one `now`
  the use case read. A method that skips either is a bug, not a lighter-weight variant — it produces
  a row that changed with nothing anywhere recording that it did.
- **It publishes an event when something may react to the change** — another feature, a
  notification, a session that must end, a projection to refresh. That is most changes, and it is
  the default: an event nobody handles yet costs a line, while a consequence with no event to hang
  on means reopening the aggregate. What does not need one is a change nothing outside the aggregate
  has a reason to learn of — a description edited, a label renamed — and publishing it anyway gives
  the next reader a handler-shaped hole to fill. The trail records it either way.
- **A change that is not a business action records nothing.** Re-encoding a stored secret at a new
  cost is the case — nobody performed it and nothing should react to it, so the method updates the
  timestamp, appends no entry and publishes no event (see the `authentication` skill).
- **Not every entity is an aggregate root.** An entity with no events and no audit trail of its own,
  owned entirely by another aggregate, is a plain entity. Reach for that only when it genuinely has
  nothing to emit, never as a shortcut to avoid wiring events up.
- **Collections of children are exposed as `ReadonlyArray<T>`**, so a caller cannot push into the
  aggregate's internals and bypass the method that maintains the invariant. The audit entries are
  such a collection: a private array and a `ReadonlyArray` getter.

### The shared base classes

`common/domain` supplies what every aggregate builds on: `AggregateRoot`, `DomainEvent` with its
`DomainEventMeta`, `DomainError` and `generateId()`. Their code is in
[examples/domain-base-classes.ts](examples/domain-base-classes.ts) — copy it into a project that
does not have them yet, or read it to check an existing copy against the rules below.

- **`publishEvent` buffers; `getEvents()` drains.** It is a method with a verb, not a getter,
  because it changes the buffer — a second call returns nothing (see `code-conventions` on getters).
  Who calls it and when belongs to the `event-driven` skill.
- **Every event gets its own `id`**, so two events with the same payload stay distinguishable — in a
  trace, and as the key an idempotent handler would record.
- **A domain error's `message` is for a log and its `code` is the contract**; both are `readonly`.
- **Ids are UUID v7, minted in the domain.** The aggregate has its id from `create()` onward, so the
  creation event and the audit entry can carry it before anything is saved; v7 is time-ordered, so
  ids sort by creation and inserts land at the end of the index instead of scattering across it.

### A getter answers; a policy decides

A getter is enough when every input lives inside the aggregate (`user.isActive`,
`order.exceedsFreeShippingThreshold`). Prefer it when you can: it needs no wiring and cannot drift
from the state it reads. The moment the decision needs a repository query or another aggregate, it
is a **policy**, which the `application-layer` skill owns.

## Value objects

Immutable, validated on construction, compared by value, no identity.

```typescript
export class Email {
  private constructor(public readonly value: string) {}

  public static create(value: string): Email {
    const normalized = value.trim().toLowerCase();

    if (!EMAIL_PATTERN.test(normalized)) {
      throw new InvalidValueObjectError("Email", value);
    }

    return new Email(normalized);
  }

  public equals(other: Email): boolean {
    return this.value === other.value;
  }
}
```

`create()` throws; it never returns `undefined` on failure. A value object that can exist in an
invalid state is a type that promises nothing. The error names the value object by its class name
(`"Email"`, `"PersonName"`), so every refusal reads the same way in a log.

**Normalizing a value is the value object's job, and only the normalization nobody could object
to.** Surrounding whitespace, a run of spaces inside, the Unicode form so an accented letter typed
two ways is stored one way, the case of an email address. Anything past that is rewriting what
somebody wrote:

```typescript
export class PersonName {
  private constructor(public readonly value: string) {}

  public static create(value: string): PersonName {
    const normalized = value.normalize("NFC").trim().replace(WHITESPACE_RUN, " ");

    if (normalized.length === 0 || normalized.length > PERSON_NAME_MAX_LENGTH) {
      throw new InvalidValueObjectError("PersonName", value);
    }

    return new PersonName(normalized);
  }
}
```

**A name keeps the capitalization it was given.** No rule recases names correctly — "McDonald", "van
der Berg", "O'Brien" and "da Silva" each break a different one — and one that gets them wrong
rewrites somebody's name on every save. The same holds for a name an operator chose: "QA Lead" is
not "Qa Lead". When two spellings that differ only in case must count as one — two roles called
"Support" and "support" — that is a uniqueness rule, and it belongs to the index, which can compare
case-insensitively (see the `persistence-layer` skill); the value object cannot see the other
values.

A password is not a value object that normalizes: it is compared byte for byte, and nothing on the
way in may alter it.

**Do not model something with identity or a lifecycle as a value object.** Two `Email` instances
holding the same string are the same email. Two `User` instances holding the same name are not the
same user.

### Enum-like value objects

An enumerable concept is never a TypeScript `enum` (`code-conventions` forbids it); this section
owns the shape that replaces it. It is declared in the value object's own file as a named constant
per member, one `as const` array of them, and the union **derived** from that array:

```typescript
export const ACTIVE_STATUS_VALUE = "active";
export const SUSPENDED_STATUS_VALUE = "suspended";

export const USER_STATUS_VALUES = [ACTIVE_STATUS_VALUE, SUSPENDED_STATUS_VALUE] as const;

export type UserStatusValue = (typeof USER_STATUS_VALUES)[number];

export function isUserStatusValue(value: string): value is UserStatusValue {
  return (USER_STATUS_VALUES as readonly string[]).includes(value);
}
```

The constants carry no annotation, and must not: each one's type is its own literal, which is what
lets the array and the union be built from them. Annotated as the union, a constant widens to it and
the derivation collapses (see `code-conventions` on types derived from a value). A whitelist whose
members need no names of their own — a `sortBy` list, an entity's audit actions — is the array
literal alone, `as const`.

Members are **snake_case** — `pending_creation`, not `pendingCreation` or `pending-creation`. They
are read by the database, the translation files and every client, none of which share the codebase's
casing, so the value takes a form that survives all three unchanged. See the naming table in
`code-conventions`.

That one array drives the request DTO's validator, the persistence schema's allowed values, the
OpenAPI enum, and the translation group. Redeclaring the members anywhere else creates a second
list that drifts, and nothing fails when it does.

**Adding a member is adding it to the array**, plus its named constant when the rest of the code
refers to it. The union follows by construction, so the type, the validator and the schema cannot
disagree. Written the other way round — the union by hand, and an array annotated with it — the
array is a second list: a member missing from it compiles, lints, and fails at runtime on one
endpoint.

**Two independent axes are two value objects, not one combined status.** A tier that decides price
and a state that decides whether the account can transact are separate concerns; modeling them
together forces each to enumerate the other's values, and every combination has to be hand-checked.
Modelled apart, every combination is valid by construction.

### `common/` is for generic concepts, not for shared ones

The test is what the concept *means*, never how many features import it. A value object that names
something a specific context owns stays in that context's `value-objects/` **however many other
features read it** — moving it to `common/` does not remove the coupling, it only hides who owns the
concept and invites unrelated features to extend it.

Promote a value object to `common/` only when you can state its rules without naming a single
business entity. `Email`, `Money`, `Language` and `TimeZone` pass. Anything whose allowed values are
a list your product decided does not.

### Money

A monetary amount is the `Money` value object — an integer of minor units with its currency, never a
`number`. The rules, from rounding to the wire format, belong to the `money` skill.

## Domain events

```typescript
export class UserEmailChangedEvent extends DomainEvent {
  public constructor(
    public readonly payload: { userId: string; email: string },
    meta: DomainEventMeta,
  ) {
    super(meta);
  }
}
```

An event is named in the past tense, carries only what a handler needs to act, and is immutable. It
records that something happened; it does not instruct anyone to do anything. This skill owns the
event **class**; when and how it is published belongs to the `event-driven` skill.

**An event's `occurredAt` comes from the use case's clock**, like the timestamp and the audit entry
beside it. An event that reads `new Date()` in its own constructor puts milliseconds between three
records of one change, and makes the aggregate untestable against a fixed clock (see the `testing`
skill). Make it a required argument and the mistake stops being possible.

## Domain errors

```typescript
export class UserNotFoundError extends DomainError {
  public constructor(userId: string) {
    super(`User ${userId} was not found`, "users.user_not_found");
  }
}
```

Every error carries a machine-readable `code`, **namespaced by feature** (`users.user_not_found`).
Cross-cutting codes that belong to no feature are namespaced `common.*`. The code is the stable
contract: the message is for a human reading a log, the code is what a client branches on and what
the translation files key off.

One `*.errors.ts` file per feature. The mapping from error to HTTP status belongs to the
`error-handling` skill.

## Repository interfaces

The interface lives in the domain; the implementation lives in infrastructure. The domain never
learns which database is behind it.

```typescript
export const USERS_REPOSITORY_TOKEN: unique symbol = Symbol("USERS_REPOSITORY_TOKEN");

export const USER_SORT_BY_VALUES = ["createdAt", "email", "name"] as const;

export type UserSortBy = (typeof USER_SORT_BY_VALUES)[number];

export type GetUsersQuery = ListQuery & {
  search?: string;
  status?: UserStatusValue;
  sortBy?: UserSortBy;
};

export interface IUserRepository {
  getAll(query: GetUsersQuery, transaction?: Transaction): Promise<Paginated<User>>;
  getById(id: string, transaction?: Transaction): Promise<User | undefined>;
  getByEmail(email: Email, transaction?: Transaction): Promise<User | undefined>;
  save(user: User, transaction?: Transaction): Promise<void>;
}
```

- A repository deals in **aggregates**, not rows. `save(user)` persists the whole aggregate; there
  is no `updateEmail(id, email)`. The exception is a write whose correctness depends on a condition
  or a set that a load-then-save cannot hold — claiming a token only if it is still unrevoked,
  revoking every session in a family. It is a method named in the domain's words
  (`claimRotation(token, transaction)`, `revokeFamily(familyId, revokedAt)`), never a field setter,
  and the condition travels with the write, the one place it cannot be overtaken.
- A lookup that finds nothing returns `undefined`, never `null` and never a thrown error. "No such
  user" is an answer; whether it is an error is the use case's decision, not the repository's.
- **`Transaction` is an opaque interface declared in `common/domain`**, carrying no driver type:

  ```typescript
  export interface Transaction {
    readonly id: string;
  }
  ```

  Every repository method that participates in a unit of work takes it as an optional last
  parameter, and the parameter is **always named `transaction`**. It is **required** —
  `transaction: Transaction` — on a method that is only correct inside a unit of work, such as a
  claim whose answer the caller acts on in the same transaction: the compiler then refuses the call
  that would run it alone. Infrastructure narrows it to the
  driver's handle at its own boundary (see the `persistence-layer` skill); renaming it there to the
  driver's word puts the driver's vocabulary back in a signature the domain declared.

## Where an exported constant lives

**A constant lives in the file that owns the concept it is the vocabulary of.** That one principle
settles the cases that come up:

| Constant | Lives in |
| --- | --- |
| The members of a value union, and its default member | the value object's file |
| Numeric bounds for an entity's field | the entity's file |
| The collection name and entity-type identifier | the entity's file |
| The sortable-field whitelist for a query | the repository interface's file — it is part of the query contract |
| A regex or format the value object validates against | the value object's file |
| A catalog with no value object of its own — a permission catalog | its own file in the feature's `domain/` |

**The collection name and the entity-type identifier live in the entity's file** because the entity
is what they name. The persistence schema, the repository and the audit trail all import them from
there; a layer that spells one itself has invented a second spelling that nothing keeps in step.

## Optional values: `?` vs `null`

| Layer | Form | Why |
| --- | --- | --- |
| Entity, value object | `field?: T` | `null` is a storage artifact; the domain only knows present or absent |
| Create command | `field?: T` | absent means "not provided" |
| Partial-update command | `field?: T \| null` | it carries the request's three states inward |
| Persistence document | `field: T \| null` | the driver distinguishes a missing key from a stored `null` |
| Persistence mapper | converts both directions | the only place both forms legitimately exist |
| Response DTO | `field: T \| null` | JSON has no `undefined`; an omitted key and a null key differ to a client |
| Presentation mapper | converts `?` → `null` | |
| Create request DTO | `field?: T` | absent means "not provided" |
| PATCH request DTO | `field?: T \| null` | three states — see below |
| Repository query | `field?: T` | absent means "do not filter on this" |

**Three-state PATCH.** A partial update has to distinguish three intents, and only three shapes can
carry them:

- **Key absent** — leave the field as it is.
- **Key present with a value** — set it to that value.
- **Key present and `null`** — clear it.

The command mirrors the DTO's three states. **The entity method receives the decision already made,
never the raw tri-state** — an aggregate that takes `T | null` has learned a storage artifact, and
the translation then happens in as many places as there are callers.

These are the semantics of RFC 7396 (JSON Merge Patch): absent leaves the field unchanged, `null`
removes it. The decision needs a name the domain owns, and two shared helpers in `common/domain`
turn one form into the other:

```typescript
export const CLEAR_FIELD: unique symbol = Symbol("CLEAR_FIELD");

export type FieldUpdate<T> = T | typeof CLEAR_FIELD;

// application side: the command's tri-state becomes the decision
export function fieldUpdateFrom<T>(value: T | null | undefined): FieldUpdate<T> | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return CLEAR_FIELD;
  }

  return value;
}

// entity side: the decision applied to the current value
export function resolveFieldUpdate<T>(update: FieldUpdate<T> | undefined, current: T | undefined): T | undefined {
  if (update === undefined) {
    return current;
  }

  if (update === CLEAR_FIELD) {
    return undefined;
  }

  return update;
}
```

```typescript
// use case — the one place the transport's null is read
const now = this._clock.now();

role.update({ description: fieldUpdateFrom(command.description) }, command.performedBy, now);
```

`fieldUpdateFrom` is the one place `null` and `CLEAR_FIELD` meet, the way the persistence mapper is
the one place `null` and `undefined` do. The entity method takes `FieldUpdate<T> | undefined`,
resolves it against what it holds, and compares the result before it records anything.

A **symbol**, not a sentinel string: for a string field, any string sentinel is also a value
somebody may legitimately store. `"clear"` is a description.

Collapsing the three states into two fails in both directions, and both are quiet:

- Treating `null` as "absent" makes the field **impossible to clear** once set — the caller sends
  null, the API answers 200, and nothing changes.
- Treating "absent" as `null` **wipes fields the caller never mentioned**, which is the version that
  loses data.

## Checklist

- [ ] No import in this layer comes from the framework, a driver, or another layer.
- [ ] Every entity method that changes constrained state takes a value object, not a primitive.
- [ ] Every normalization happens in a value object's `create()`, and none of them changes the
      capitalization of a name.
- [ ] `create()` emits events; `reconstitute()` emits none.
- [ ] Every state-changing method updates the timestamp and appends an audit entry, from the `now`
      it was given — or is a change that is not a business action and records nothing.
- [ ] Every change another feature, a notification or a revocation may react to publishes an event.
- [ ] Every enumerable concept has exactly one `as const` array, in the value object's file, and
      its union is derived from it; no `enum` exists.
- [ ] Every value object in `common/` can have its rules stated without naming a business entity.
- [ ] Every domain error carries a feature-namespaced code.
- [ ] Every repository method that participates in a unit of work takes `transaction` as its last
      parameter, under that name — optional, or required when the method is only correct inside a
      unit of work.
- [ ] Every repository method other than a load or `save` is a conditional or set-based write named
      in the domain's words, and none of them sets a field.
- [ ] Every optional field matches its layer's row in the `?` vs `null` table.
- [ ] A partial update distinguishes absent, set and clear, and the entity receives the decision
      rather than the tri-state.
