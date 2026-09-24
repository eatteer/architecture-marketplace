---
name: persistence-layer
description: "The persistence side of a feature's infrastructure — Mongoose schemas, indexes, persistence mappers (`toDomain`/`toPersistence`), repository implementations, narrowing the opaque `Transaction` to a driver session, read and write concerns, soft delete, filter building, `lean()`, N+1 reads, retention and pruning, and migrations with `migrate-mongo`."
when_to_use: "Trigger on — writing or editing a `*.schema.ts`, a `*-mongo.repository.ts` or a `*.persistence-mapper.ts`, declaring an index, an index edit that changed nothing or left its predecessor behind, adding a field to a stored document, implementing `save()` or `getById()`, a query that returns deleted records, a unique constraint that must allow repeated nulls or ignore case, a slow query or a collection scan, a loop that queries once per element, two things deleting from one collection, writing a migration or its `down`, a migration applied twice or by two deploys at once, a backfill, or a duplicate key answered with a 500."
---

# Persistence layer

Lives in `src/features/<feature>/infrastructure/persistence/`. It is the only place in the codebase
that knows the database exists.

```text
infrastructure/persistence/mongodb/
├── schemas/       user.schema.ts
├── mappers/       user.persistence-mapper.ts
└── repositories/  users-mongo.repository.ts
```

The repository implements the interface the domain declared (see the `domain-modeling` skill). Every
type in that interface is a domain type; nothing from the driver crosses back out.

## Schemas

A complete schema is in [examples/user.schema.ts](examples/user.schema.ts). **Read it before
writing or reviewing a schema**; the rules below are what it shows.

- **The collection name is snake_case and plural** (`account_movements`), declared as a constant in
  the entity's file. It is a string the database owns rather than an identifier in this codebase,
  which is why it does not follow the file or property conventions around it.
- **`_id: false` with an explicit `_id: string`.** Identity is the domain's to mint, not the
  driver's: an id generated in the entity is known before the write, is the same value in the
  emitted event, and does not drag a driver type into every signature that carries it.
- **`timestamps: false`.** `createdAt` and `updatedAt` are domain state, set by entity methods. Let
  the driver maintain them and a write that bypassed the aggregate still looks legitimate.
- **`versionKey: false`.** Concurrency is handled by the unit of work, not by a document counter;
  see the `transactions-and-consistency` skill.
- **Enumerable fields are typed `string` and constrained by `enum:` from the domain's `const`
  array.** Typing the property as the union would make the schema import a domain union into a shape
  the driver fills from untyped BSON; the array reference keeps the single source without the lie.
- **A property whose TypeScript type is a union declares its `type:` explicitly.** The driver reads
  the field's type from decorator metadata, and a union — `Date | null`, a value union — erases to
  `Object`, so the schema fails to build: `CannotDetermineTypeError` at boot, not at compile time.
  `@Prop({ type: Date, default: null })` for a nullable field; for an enumerable one, type the
  property `string` and constrain it with `enum:` as the example does, rather than typing it as the
  union.
- **A new field on an existing collection carries a `default`**, so documents written before the
  change still read back valid. A new field with no default and no backfill is a migration you have
  not written yet.
- **A monetary field is the shared money subdocument** — an Int64 amount with its currency, never a
  `Number` or a `Decimal128`. See the `money` skill.

## Indexes

Declared on the factory, never as `@Prop({ unique: true })`:

```typescript
UserSchemaFactory.index({ deletedAt: 1, status: 1, createdAt: -1, _id: -1 });
UserSchemaFactory.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
```

- **One index per real query pattern**, taken from the queries the repository actually runs. Every
  index costs write throughput and storage, so a speculative one is a permanent bill for a query
  nobody makes. The exception is the audit trail, whose indexes serve the investigation queries the
  `audit-log` skill sanctions rather than a query a request runs.
- **An index that already exists is never reconciled.** Automatic index creation adds what is
  missing and leaves what is there alone, options and all. Editing a definition — a TTL, a unique
  flag, a partial filter, the keys — changes nothing on any database that ran the previous one, with
  no error and no warning, so the old behavior keeps running while the code says otherwise; an
  edited key list means both indexes exist. Removing a declaration does not drop the index either:
  it is paid for on every write forever, invisible unless somebody lists them. Both are migrations,
  not edits, and the drop is written to tolerate the index already being gone.
- **One mechanism owns a collection's retention.** A TTL index and a scheduled prune are two
  policies, and the shorter one wins in silence: rows are gone before the job's query can match
  them, so the job, its lock, its schedule and its tests exist to delete nothing — and its specs
  pass, because they mock the repository. Pick the database sweeping it or the job doing it, and
  say which in the place the other one would go.
- **A prune deletes a bounded batch in two steps**: select the ids of the next batch with a limit,
  then `deleteMany` by exactly those ids. The driver's delete takes no limit, and an unbounded one
  over a large backlog holds the collection for as long as it takes. An index on the field the
  selection filters on keeps each step cheap.
- **The order is: equality filters, then the sort field, then the tiebreaker.** An index serves them
  in that order; put the sort first and the filters stop being able to use it, and leave the
  tiebreaker out and the sort it breaks ties for still has to be finished in memory.
- **A prefix cannot be skipped.** `{ deletedAt, customerId, status, createdAt }` does not serve a
  query that omits `status`: the sort key sits behind a field the query does not constrain. An
  endpoint with an optional filter therefore needs the index with it and the index without it — this
  is where the count of indexes comes from, and it is worth knowing before adding the third optional
  filter.
- **Direction is not duplicated.** A b-tree is walked from either end, so
  `{ createdAt: -1, _id: -1 }` serves ascending too — provided the tiebreaker turns with the key it
  breaks ties for. One index per sort field, not two.
- **A regex filter uses an index only when it is anchored AND case-sensitive.** `/foo/i` scans the
  collection, and so does `/^foo/i`. Substring search that stays fast needs a decision, not an
  index: anchor it and drop the flag, give the collection a case-insensitive collation, or store a
  normalized lowercase copy and match a prefix on that. All three change what the search finds, so
  it is a product decision — but leaving it undecided means a scan on every keystroke. Keeping the
  unanchored case-insensitive scan is a legitimate answer when the project records it as a decision
  (see the `decision-records` skill), with the collection size at which it stops being acceptable.
- **Do not index a low-cardinality field on its own.** An index over a three-value status points at
  a third of the collection and the planner will ignore it; it earns its place only as the leading
  field of a compound index.
- **A unique constraint that must tolerate repeated absences uses a partial index**, not a sparse
  one. Sparse skips documents missing the key entirely, which still collides on documents that store
  an explicit `null`; a partial index states the exact condition and is the only form that also
  matches soft-deleted rows correctly.

**A uniqueness that ignores case is a collation, not a lowercased copy.** Declare the collation on
the unique index and ask for the same one on every lookup meant to use it:

```typescript
export const ROLE_NAME_COLLATION: mongo.CollationOptions = { locale: "en", strength: 2 };

RoleSchemaFactory.index(
  { name: 1 },
  {
    name: "name_unique_case_insensitive",
    unique: true,
    partialFilterExpression: { deletedAt: null },
    collation: ROLE_NAME_COLLATION,
  },
);

// the lookup the use case runs before the write
await this._roleModel.findOne({ name, deletedAt: null }).collation(ROLE_NAME_COLLATION).exec();
```

Strength 2 compares without case and with accents, so "Support" and "support" collide while "Resume"
and "Résumé" do not. The stored value keeps the capitalization it was given — the rule is about
comparison, not storage (see the `domain-modeling` skill). A query that does not name the collation
compares case-sensitively and cannot use the index, so the lookup and the index disagree about what
a duplicate is, and the index is the one that wins — as a duplicate-key error on the write.

**Name an index that replaces another on the same keys.** Both default to the name the keys produce
(`name_1`), and building the new one on a database that has the old one fails instead of sitting
beside it until the migration drops the old one.

A unique index is the **only** real uniqueness guarantee. A read-then-write check in a use case
cannot provide one; see the `transactions-and-consistency` skill for why. Its violation is
translated in the repository's `save()` — see "Translating a duplicate key" below.

## Persistence mappers

**A stored enum-like value is validated, not cast.** Documents outlive the code: a value retired
from a union is still sitting in every record that was written with it, and a cast asserts the
opposite of what is true.

A value object's `create()` takes the raw string and narrows it with its own predicate, so a field
behind a value object needs no cast at all. The temptation is the field with no value object in
between, where the value goes straight into the aggregate — and there a cast proves nothing:

```typescript
// ❌ asserts that every stored string is still in the catalog
permissions: document.permissions as PermissionValue[],

// ✅ the catalog decides, and a retired value stops here
permissions: document.permissions.filter(isPermissionValue),
```

Cast, a permission nobody recognizes travels into a token and is compared against by a guard that no
longer knows what it means. Whether the right answer is to filter it out, fall back to a default, or
refuse to load the record is a per-field decision — but it is a decision, and a cast makes it
silently.

```typescript
export class UserPersistenceMapper {
  public static toDomain(document: UserSchema): User {
    return User.reconstitute({
      id: document._id,
      email: Email.create(document.email),
      name: PersonName.create(document.name),
      status: UserStatus.create(document.status),
      createdAt: document.createdAt,
      updatedAt: document.updatedAt,
      deletedAt: document.deletedAt ?? undefined,
    });
  }

  public static toPersistence(user: User): UserSchema {
    return {
      _id: user.id,
      email: user.email,
      name: user.name,
      status: user.status,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt ?? null,
    };
  }
}
```

- **This is the one place the `null` ↔ `undefined` conversion happens.** The driver's `null` stops
  here; a `null` that reaches a use case or an entity is the defect the convention exists to prevent
  (see the `?` vs `null` table in `domain-modeling`).
- **`create()` takes the raw string and narrows it with its predicate; nothing casts.** The database
  is the untyped side, and a stored value that has fallen out of the union throws here rather than
  traveling as a lie.
- **The mapper is static and pure.** No repository, no service, no `await`. A mapper that can fail
  in ways other than invalid data is no longer a projection.
- **Audit entries are not part of the document.** They live in their own collection; the entity's
  pending entries are written by the repository, not embedded by the mapper (see the `audit-log`
  skill).

## Repository implementations

A complete repository implementation — a load, and a `save()` that translates its duplicate key and
writes the audit trail in the same unit of work — is in
[examples/users-mongo.repository.ts](examples/users-mongo.repository.ts). **Read it before writing
or reviewing one**; the rules below are what it shows.

**`save()` is an upsert of the whole aggregate.** The domain has no "insert" and "update" — it has
an aggregate whose current state is the truth. One method means a caller can never persist half of
a change by reaching for the wrong one. It also means the copy handed to `save()` must be one read
in the same unit of work; the `transactions-and-consistency` skill owns that rule.

### Translating a duplicate key

**The repository translates the violation.** It is the last place that knows both the driver's error
and the domain's, and it is where the translation belongs — one layer out and the application starts
recognizing error codes from a database it is not supposed to know about.

The helper in the example's `catch` reads code `11000` and the `keyPattern` the driver reports, so
one index is told from another and an unrelated write failure is rethrown untouched. Narrow the
error with a type predicate rather than a cast — `as` would assert a shape nobody checked.

Untranslated, the concurrent loser receives a 500 for a conflict the API already has a 409 for. It
is invisible in testing, because it takes two simultaneous writes to see it.

A unique index on a value the system generates — a random storage key, a minted token — needs no
translation. No request can cause that collision, so it is a fault, and it surfaces as one.

### Narrowing the transaction

The domain declares `Transaction` as an opaque interface. Infrastructure supplies the one
implementation that carries the driver's handle, and one helper converts it — with no cast:

```typescript
export class MongoTransaction implements Transaction {
  public constructor(
    public readonly id: string,
    public readonly session: ClientSession,
  ) {}
}

export function sessionOf(transaction?: Transaction): ClientSession | null {
  if (transaction === undefined) {
    return null;
  }

  if (!(transaction instanceof MongoTransaction)) {
    throw new Error("A transaction from another persistence adapter reached the Mongo repository");
  }

  return transaction.session;
}
```

Narrowing in one helper is what keeps the parameter honest. A repository that declares the driver's
session type directly in its signature claims a contract the interface never made, and the mismatch
compiles silently.

### The unit of work states its guarantees

The transaction manager's implementation names its read and write concerns instead of inheriting
them:

```typescript
const TRANSACTION_OPTIONS: mongo.TransactionOptions = {
  readConcern: { level: "snapshot" },
  writeConcern: { w: "majority" },
};

return await session.withTransaction(
  async (): Promise<T> => await work(new MongoTransaction(generateId(), session)),
  TRANSACTION_OPTIONS,
);
```

Left out, a transaction takes whatever the connection string, the client or the server defaults to,
and those differ between a local replica set and a managed cluster — so what a unit of work
guarantees would depend on where it runs. `snapshot` makes every read in the unit of work see one
point in time, the one conflicts are detected against; `majority` acknowledges a commit only once a
failover cannot roll it back. What a transaction does and does not buy is the
`transactions-and-consistency` skill's.

## Soft delete

A soft-deleted document is invisible to the feature, not absent from the database.

- The domain marks it, through the entity's own method, like any other state change (see the
  `domain-modeling` skill). Persistence keeps the mark honest:
- **Every read filters on `deletedAt: null`** — every finder, every count, every aggregation stage.
  One query that forgets it resurrects deleted records in exactly one screen, which is the hardest
  version of this bug to notice.
- **Every unique index carries `partialFilterExpression: { deletedAt: null }`**, or a deleted record
  keeps holding its email hostage forever.

Hard deletion is a separate, deliberate operation — an erasure request, a retention policy — and it
is the only thing that removes the row.

## Building filters

```typescript
const filter: Record<string, unknown> = { deletedAt: null };

if (status !== undefined) { filter.status = status; }
if (createdAtFrom !== undefined) { filter.createdAt = { $gte: createdAtFrom }; }
```

A plain record rather than a driver-provided filter type: the names change between major versions of
the driver, and the object is handed straight to the query anyway.

- **Start from the soft-delete condition**, then add. Starting from an empty object and appending it
  last is one early `return` away from a query that sees everything.
- **A search term is escaped before it becomes a regular expression** — the `security` skill owns
  that rule.
- **An absent filter value means "do not filter"**, which is why the guard tests `!== undefined`
  rather than truthiness — `0` and `false` are values someone meant to filter on.

## Reading efficiently

- **`lean()` for every read that feeds a mapper.** A hydrated document carries change tracking and
  instance methods the mapper never uses; the mapper wants plain data.
- **Project what you read** when a document is large and the mapper needs a few fields — but a
  projection that omits a field the mapper reads produces a partially-built aggregate, so project
  only where the read has its own narrow result type.
- **Never query inside a loop that assembles one result.** Collect the ids, issue one `$in` query,
  index the results by id, and resolve from that map. A loop that queries per element is the single
  most common reason a list endpoint that was fast with ten rows times out with a thousand. A batch
  that works one aggregate per unit of work is not this case: it re-reads each aggregate inside its
  own transaction by design (see the `transactions-and-consistency` skill).
- **Do not run queries together on one session.** Independent queries look like a `Promise.all`, but
  a repository method that accepts a transaction passes its session to both, and a driver session
  does not support concurrent operations. It works until the first caller runs inside a unit of
  work. Sequential awaits cost a round trip and remove the trap.

## Migrations

A schema change and the script that makes existing documents satisfy it are one change, in one
commit. A document store has no schema to alter, which moves the work rather than removing it: the
documents already written keep the old shape, and the code that reads them is what changed.

They run with `migrate-mongo`, driven by a command of the project's own rather than by the package's
CLI and its config file — the command validates the connection string by the application's rule and
names the target before it changes anything (see the `observability` skill):

```text
src/migrations/
├── 20260301090000-drop-case-sensitive-name-index.ts
└── 20260302090000-backfill-order-status.ts
```

A complete migration, with its header, its `up` and its `down`, is in
[examples/20260301090000-drop-case-sensitive-name-index.ts](examples/20260301090000-drop-case-sensitive-name-index.ts).
Read it before writing one; the rules below are what it follows.

- **A migration restates collection names and literal values** instead of importing the domain's
  constants. It is frozen at the moment it was written; the code it would import keeps changing, and
  a renamed constant or a retired union member would silently change what an applied migration does
  on the next database it runs against.
- **The file name is the order and the identity.** A timestamp prefix sorts them; the ledger
  collection records each applied file by name, and a file already recorded is never run again.
- **Every migration has a `down`.** It returns the documents to the shape the previous version reads
  — not necessarily byte for byte: a field the previous version does not know can stay. When `up`
  loses the information `down` would need, `up` keeps it in a field the application does not read.
  A migration that truly cannot be reversed says so in its `down`, by throwing with the reason.
- **They live in the source tree and run compiled** — locally too. The ledger records the file name
  *with its extension*, so a migration applied from the TypeScript source is recorded as `.ts`, and
  the image, which only has the `.js`, finds it unapplied and applies it a second time. Building
  before running is what makes both environments name the same file.
- **The command takes a lock** before `up` or `down` — the same single-write lock the scheduled jobs
  use (see the `background-jobs` skill), with an expiry, so two deploys starting at once cannot both
  apply the same migration, and a run killed halfway blocks the next one for the expiry and no
  longer. The package's own lock checks and then inserts in two steps, which two runs can both pass.
- **The ledger entry is not in the migration's transaction.** It is written after `up` returns, so a
  crash between the two re-runs a migration that already happened — which is why:
- **Migrations are idempotent.** Running one twice must be indistinguishable from running it once —
  they get retried, re-run against the wrong environment, and interrupted halfway. A filter that
  matches only what has not been converted yet is the usual shape.
- **Several writes that must agree run in one transaction** inside `up`, on a session from the
  client the command passes in — a user deleted with their sessions still alive is a state no
  request could have produced, and a migration should not produce it either.
- **Expand, then contract.** To change a field's shape: add the new field and write both, backfill,
  switch reads to the new field, then remove the old one. Each step is deployable on its own, which
  is what makes a rollback possible at any point.
- **A backfill over a large collection runs in batches**, not as one statement that holds a cursor
  open for an hour.
- **Say when it runs relative to the deploy**, in the file's header. A migration that adds something
  runs before; one that removes something runs after. Getting this backwards takes the running
  version down. Running it is a deploy step — see the `deployment` skill.
- **Seeding is not a migration.** Inserting a document only when it is absent belongs with the
  feature that owns it; see the `configuration` skill.

## Checklist

- [ ] The schema sets `_id: false` with an explicit `_id: string`, `timestamps: false`, and
      `versionKey: false`.
- [ ] Every enumerable field is typed `string` and constrained by the domain's `const` array.
- [ ] Every property whose type is a union declares `type:` on its `@Prop`.
- [ ] Every new field on an existing collection has a default or a backfill.
- [ ] Every index matches a query the repository actually runs, in the order equality filters,
      sort field, tiebreaker.
- [ ] Every unique index is partial on `deletedAt: null`.
- [ ] Every case-insensitive unique index declares its collation, and every lookup against it asks
      for the same one.
- [ ] Every value in a listing's sort whitelist has an index behind it, tiebreaker included.
- [ ] Every replaced index definition has a migration dropping the one it replaced.
- [ ] Every unique index's violation is translated into its domain error inside the repository.
- [ ] The persistence mapper is the only place `null` ↔ `undefined` and `string` → union happen, and
      the narrowing is a value object's `create()` or a predicate — no `as`.
- [ ] The repository implements the domain interface with domain types only; no driver type leaves
      this folder.
- [ ] Every read filters on `deletedAt: null`.
- [ ] No loop that assembles one result issues a query per element.
- [ ] The transaction manager passes an explicit read and write concern.
- [ ] Every migration has an `up` and a `down`, is idempotent, and states when it runs relative to
      the deploy.
- [ ] No migration imports a domain constant; its collection names and values are literals.
- [ ] The migration command runs the compiled migrations, under a lock.
