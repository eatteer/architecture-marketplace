---
name: application-layer
description: "The application layer of a feature — use cases, command objects, result objects, policies that return a verdict, infrastructure port interfaces and their environment-switched adapters, the actor that performed the action, batch orchestration with per-item results, and the rules for depending on another feature."
when_to_use: "Trigger on — writing or editing a `*.usecase.ts`, `*.command.ts` or `*.policy.ts`, deciding whether code should throw or return a value, deciding what a use case returns, injecting another feature's repository or use case, adding a port for email/SMS/storage/payments, a feature that emails the people it holds, choosing the actor a use case records when no request started the work, writing an endpoint that processes many rows and must report each one, a use case that grew a second responsibility, or an id stored without checking that it resolves."
---

# Application layer

Lives in `src/features/<feature>/application/`. It orchestrates: it loads aggregates, calls their
methods, and persists the result. It holds no business rules of its own — a condition here that
could be asked of an aggregate belongs on the aggregate.

```text
application/
├── commands/     create-user.command.ts
├── policies/     user-quota.policy.ts
├── ports/        email-sender.interface.ts
├── results/      import-users.result.ts
└── use-cases/    create-user.usecase.ts
```

Depends on the domain. Never on infrastructure or presentation: it declares the interfaces it needs
and infrastructure supplies the implementations.

## Use cases

One use case, one public `execute`. If a class needs a second public method, it is a second use
case.

The canonical use case is in [examples/create-user.usecase.ts](examples/create-user.usecase.ts).
**Read it before writing or reviewing a use case**; the paragraphs below are the rules it follows.

This is the canonical shape and this skill owns it: construct value objects, read the clock, open
the unit of work, load, guard, mutate, save, close, then publish. **The clock is read once, before
the unit of work**, and that one `now` is handed to every aggregate method — so the timestamp, the
audit entry and the event of one change describe the same instant, and a retried callback does not
move it. The rules for the transaction itself — what it
guarantees, why the callback must be safe to re-run, where the atomicity boundary sits — belong to
the `transactions-and-consistency` skill. Where `getEvents()` and `publish()` may be called belongs
to `event-driven`.

**Value objects are constructed before the unit of work opens.** An invalid email should cost
nothing; constructing it inside the transaction pays for a session and a round trip before
discovering the request was malformed.

## Commands

A command is the typed input of one use case: all `readonly`, primitives only, no framework
decorators, no validation logic.

```typescript
export class CreateUserCommand {
  public readonly email: string;
  public readonly name: string;
  public readonly performedBy: Actor;

  public constructor(props: { email: string; name: string; performedBy: Actor }) {
    this.email = props.email;
    this.name = props.name;
    this.performedBy = props.performedBy;
  }
}
```

Primitives, not value objects: the command carries what came off the wire, and the use case is where
that becomes a validated domain value. This keeps the DTO → command mapping a straight copy with no
place for a rule to hide.

A command is what insulates every caller from the transport. When the HTTP shape changes, the DTO
and the controller change; every consumer holding a command is untouched. So every use case with a
request behind it receives a command, even one that carries only an id and the actor.

**Configuration is not a command field.** A use case that needs a configured value receives it as a
typed value behind a token, injected like a port; the `configuration` skill owns that shape.

## Who performed the action

**The use case is the single origin of the actor.** It is the only layer that knows both who is
asking and why the work is happening.

- A request-driven use case receives the actor in its command, built by the controller from the
  authenticated principal.
- A use case with no request behind it — a scheduler, an event handler, a migration — passes
  `Actor.system()` explicitly.

Infrastructure enriches the recorded trail with request metadata (address, agent, trace id) but
**never decides who**: an actor derived down in the repository makes the attribution invisible at
the point the decision was made, and impossible to assert on in a unit test. The `Actor` type and
the trail it feeds belong to the `audit-log` skill.

## Throw or return

One table for the whole codebase. The axis is *whose problem is it*:

| Situation | Shape |
| --- | --- |
| A value object is given an invalid value | throw |
| An entity method's precondition fails | throw a domain error |
| A use case precondition the caller got wrong | throw a domain error |
| A repository lookup finds nothing | return `undefined` — "no such thing" is an answer |
| A question about current state | a getter returning a boolean |
| A rule the read path also needs | a policy returning a verdict; only the write path throws |
| One item inside a batch | collect a per-item result; never throw out of the loop |
| An event handler | never throws — see the `event-driven` skill |

Everything not in the last two rows throws and lets the global filter map it. A use case does not
catch a domain error to re-shape it: the filter already knows the mapping, and a `catch` here hides
which rule actually fired.

## Policies

A policy is a pure function that answers a business question the use case then acts on. It takes
everything it needs as arguments — it never queries — and it **returns a verdict, it does not
throw**.

```typescript
export type QuotaVerdict = {
  allowed: boolean;
  limit: number;
  consumed: number;
  remaining: number;
  rejectionCode?: string;
};

export function evaluateDailyQuota(limit: number, consumed: number, requested: number): QuotaVerdict {
  const remaining = Math.max(limit - consumed, 0);

  if (requested > remaining) {
    return { allowed: false, limit, consumed, remaining, rejectionCode: DAILY_QUOTA_EXCEEDED_CODE };
  }

  return { allowed: true, limit, consumed, remaining };
}
```

Returning data rather than throwing is what lets one implementation serve both paths: a read
endpoint usually needs the same numbers with nothing going wrong — to show a progress bar, to cap a
form's maximum — while only the write path treats a rejection as a failure. It also lets the unit
test assert on values instead of catching errors.

**Resolve anything the caller would otherwise re-derive.** If a rule combines two ceilings, return
the *effective* remainder, not both raw numbers — otherwise every consumer reimplements the rule and
they drift apart.

## Ports and adapters

Anything outside the process — email, SMS, object storage, a payment provider, a clock — is an
interface declared here and implemented in infrastructure.

```typescript
export const EMAIL_SENDER_TOKEN: unique symbol = Symbol("EMAIL_SENDER_TOKEN");

export interface IEmailSender {
  send(message: EmailMessage): Promise<void>;
}
```

The use case depends on `IEmailSender` and never learns which provider answers. Outside production,
a provider with no sandbox is replaced by a simulator selected in the module's `useFactory` — the
wiring belongs to the `module-wiring` skill, and calling the real thing safely belongs to
`external-integrations`.

**How a simulator must behave is the `external-integrations` skill's**, which also owns the prior
question of whether one is warranted at all — a provider that runs in a container is not simulated.

### Telling a person something

A feature that notifies the people it holds declares a port **in its own words** — what it tells
them, not how it is carried:

```typescript
export const USER_NOTIFIER_TOKEN: unique symbol = Symbol("USER_NOTIFIER_TOKEN");

export interface IUserNotifier {
  welcome(recipient: UserNotificationRecipient): Promise<void>;
}
```

Its adapter lives in the feature's infrastructure, with the feature's templates: it resolves the
copy in the recipient's language (see the `i18n` skill), renders the template, and hands the result
to the shared transport. `common/` holds only what has no business in it — the transport port and a
renderer that turns any template into its HTML and text parts, both from the one template, so the
text a client that refuses HTML reads cannot drift from the HTML. A welcome message in `common/` is
a feature's copy in the one place that must not know the feature exists.

## Depending on another feature

- **Read across the boundary, mutate through it.** Injecting another feature's repository to *read*
  is fine. Changing its state goes through its use case, so its invariants, its events and its audit
  trail all still run. A direct write to another feature's storage loses all three. The exception
  is a change that is not a business action (see `domain-modeling`) — re-encoding a stored secret at
  sign-in: it has no event and no trail to skip, so the caller invokes that aggregate's method and
  saves it through its repository.
- **A use case's public surface is already the abstraction boundary.** There is no interface to
  extract for it — `execute(command)` is the contract.
- **Moving a concept to `common/` because a second feature reads it is the wrong reflex.** See the
  `common/` test in the `domain-modeling` skill.
- **Two features that each need the other are a cycle**, and how to break it belongs to the
  `module-wiring` skill.

### Enlisting another feature's use case in your transaction

When the caller guards on state the callee then spends — a balance check followed by the debit — the
two writes must commit together. The callee's `execute` takes the caller's `transaction` and returns
the events it produced, so the caller publishes them after the commit:

```typescript
public async execute(command: DebitAccountCommand, transaction?: Transaction): Promise<DomainEvent[]>
```

Splitting them into two transactions leaves a window where the guard has passed and the debit has
not happened.

## Batch orchestration

An endpoint that processes many rows reports each one. The orchestrator catches per item so one bad
row does not abandon the rest:

```typescript
public async execute(command: ImportUsersCommand): Promise<ImportUsersResult> {
  const outcomes: ImportOutcome[] = [];

  for (const row of command.rows) {
    try {
      const userId = await this._createUser.execute(row.toCommand());

      outcomes.push({ index: row.index, success: true, userId });
    } catch (error: unknown) {
      if (!(error instanceof DomainError)) {
        throw error;
      }

      outcomes.push({ index: row.index, success: false, code: error.code });
    }
  }

  return new ImportUsersResult(outcomes);
}
```

Two rules make this the sanctioned exception to "never catch a domain error" rather than a violation
of it:

- **Only a domain error is caught.** Anything else — a dropped connection, a bug — rethrows. A
  `catch (error: unknown)` that swallows everything turns an outage into five hundred rows of
  "failed" and reports 200.
- **The caught error becomes part of the response.** It is handled, not logged and forgotten. The
  `error-handling` skill owns what a `catch` may end in.

Each item runs in **its own** unit of work. One transaction around the whole file means row 500
rolls back row 1, which is the opposite of what a per-item report promises.

## Result objects

| The use case… | Returns |
| --- | --- |
| Creates something | the new id |
| Mutates something the caller already identified | `void` |
| Reads one thing | the entity; a not-found error when nothing matches — the repository returned `undefined`, and the use case decides it is an error |
| Reads a list | `Paginated<Entity>` |
| Produces an outcome with structure of its own | a dedicated result class |

A result class lives in `results/` and is plain readonly data. It is not a DTO: it carries domain
values, and the presentation layer decides how they appear on the wire.

## References to other aggregates

An id arriving in a command is a claim, not a fact. Before it is written into an aggregate, check
that it resolves — **inside the same unit of work as the write**, so something deleted between the
check and the save cannot slip through:

```typescript
const roles = await this._rolesRepository.getManyByIds(command.roleIds, transaction);
const existing = new Set(roles.map((role: Role): string => role.id));
const missing = command.roleIds.filter((id: string): boolean => !existing.has(id));

if (missing.length > 0) {
  throw new RolesNotFoundError(missing);
}
```

Unchecked, the call answers 200 and stores an id that resolves to nothing. Nothing fails, nothing is
logged, and the consequence — a user with no permissions, an order pointing at no customer —
surfaces later as a bug with no apparent cause.

**The error names every id that failed**, not the first. A caller that sent five should not have to
submit five times to learn which ones were wrong.

Reading another feature's repository for this is allowed — it is a read, and the rule above about
going through the other feature's use case is about mutations. It is a dependency and not a cycle as
long as it runs one way: whether a role exists is a question only the feature that owns roles can
answer. See the `module-wiring` skill for what to do when both directions are needed.

## Checklist

- [ ] Every use case has exactly one public `execute`.
- [ ] Every id referencing another aggregate is checked inside the unit of work that writes it,
      and the error names every id that failed.
- [ ] Value objects are constructed before the unit of work opens.
- [ ] No condition in a use case could have been asked of the aggregate instead.
- [ ] The actor originates in the use case — from the command, or explicitly `Actor.system()`.
- [ ] Every `catch` in this layer is a batch item, catches only domain errors, and rethrows the
      rest.
- [ ] Every policy is pure, takes what it needs as arguments, and returns a verdict.
- [ ] Every port is an interface here with its token, and no use case names a provider.
- [ ] Every cross-feature mutation goes through the other feature's use case, not its repository —
      unless it is a change that is not a business action.
- [ ] The clock is read once, before the unit of work, and that `now` reaches every aggregate call.
- [ ] Each batch item runs in its own unit of work.
