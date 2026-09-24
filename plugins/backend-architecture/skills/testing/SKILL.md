---
name: testing
description: "What to test and how — the unit, integration and end-to-end boundaries and their suffixes, arrange/act/assert, what each layer is worth testing, typed port doubles, the transaction manager double, builders for private constructors, an injected clock and id generator, the integration suite's in-memory replica set, the end-to-end suite's own database, the coverage floor, and what not to test."
when_to_use: "Trigger on — writing a `*.spec.ts`, `*.integration-spec.ts` or `*.e2e-spec.ts`, a use case with no spec, a suite that stays green when the behavior is deleted, stubbing a repository or a port, writing a `*.builder.ts` or `*.double.ts`, constructing an entity in a test, validation negatives that pass vacuously, a test that needs a database or a replica set, a test that fails intermittently or breaks when an unrelated field is added, an end-to-end run that wrote into the development database or needs the seed, a suite that arranges its own pipes, a coverage threshold failing, or asking what a change still needs covered."
---

# Testing

Three kinds, distinguished by what they are allowed to touch. Getting a test into the right kind is
most of the value: a unit test that reaches a database is slow and flaky, and an end-to-end test
that exercises a branch reachable in a unit test is expensive coverage.

| Kind | Suffix | Touches | Answers |
| --- | --- | --- | --- |
| Unit | `*.spec.ts` | nothing outside the process | does this rule hold |
| Integration | `*.integration-spec.ts` | a real database | does this query do what it says |
| End-to-end | `*.e2e-spec.ts` | the running application over HTTP | does the wiring hold together |

Most tests are unit tests, because most of the interesting logic is in entities, value objects,
policies and use cases — none of which need anything running.

## Shape

Arrange, act, assert, with a blank line between the three — including when a section is a single
line, and including when the act and the assert are fused into one expression. Two assertions about
different things are two steps, not one:

```typescript
// ❌ the rejection and the side effect read as one thought
await expect(useCase.execute(aCommand())).rejects.toThrow();
expect(eventBus.publish).not.toHaveBeenCalled();

// ✅ what was refused, then what did not happen because of it
await expect(useCase.execute(aCommand())).rejects.toThrow();

expect(eventBus.publish).not.toHaveBeenCalled();
```

The test name states the behavior in a sentence, not the method name:

```typescript
const NOW: Date = new Date("2026-01-15T10:30:00.000Z");

it("rejects a settlement when the order is already settled", async () => {
  const order = anOrder().settled().build();

  const act = (): void => order.settle(Actor.system(), NOW);

  expect(act).toThrow(OrderAlreadySettledError);
});
```

One behavior per test. A test that asserts four unrelated things fails without saying which one
broke, and the other three stop being checked as soon as the first one fails.

## What each layer is worth testing

| Layer | Test | Do not test |
| --- | --- | --- |
| Value object | every rule that rejects, and normalization | that a valid value is accepted, beyond once |
| Entity | every invariant, and that a change emits its event and audit entry | getters that return a field |
| Policy | the boundaries — at the limit, one over, zero | the middle of the range repeatedly |
| Use case | orchestration: what it calls, in what order, what it throws | rules the entity already covers |
| Persistence mapper | a round trip, including every optional field | |
| Repository | each query's filter, sort and paging, against a real database | that the driver works |
| Controller | a transport branch it owns, if it has one — a readiness route answering 503 during shutdown | the use case behind it, or a mapping the presentation mapper already covers |

The pattern: a rule is tested where it lives, once. A use case test that re-asserts an entity's
invariant is testing the entity through two layers of indirection, and it breaks when the
orchestration changes for reasons that have nothing to do with the rule.

## Doubling a port

A use case depends on interfaces, so a unit test constructs it with plain objects and `new` — no
test module, no container:

```typescript
describe("CreateUserUseCase", () => {
  let trace: string[];
  let usersRepository: jest.Mocked<IUserRepository>;
  let transactionManager: jest.Mocked<ITransactionManager>;
  let eventBus: jest.Mocked<IEventBus>;
  let clock: jest.Mocked<IClock>;
  let useCase: CreateUserUseCase;

  beforeEach(() => {
    trace = [];

    usersRepository = {
      getAll: jest.fn(),
      getById: jest.fn(),
      getByEmail: jest.fn().mockResolvedValue(undefined),
      save: jest.fn().mockResolvedValue(undefined),
    };

    transactionManager = createTransactionManagerDouble(trace);

    eventBus = { publish: jest.fn() };
    clock = { now: jest.fn().mockReturnValue(NOW) };

    useCase = new CreateUserUseCase(usersRepository, transactionManager, eventBus, clock);
  });
});
```

`jest.Mocked<IUserRepository>` is what makes the double a real test: adding a method to the
interface breaks every double that has not implemented it, so a use case cannot start depending on
something no test knows about.

**The transaction manager double runs the callback.** A double that returns a canned value never
executes the body, and every test passes while the use case does nothing.

**And it records a commit of its own.** This is the whole reason it is a shared helper rather than
four lines of `jest.fn()` in each spec:

```typescript
export const COMMITTED = "commit";
export const A_TRANSACTION: Transaction = { id: "transaction-1" };
export const A_SECOND_TRANSACTION: Transaction = { id: "transaction-2" };

const OPENED_IN_ORDER = [A_TRANSACTION, A_SECOND_TRANSACTION];

export function createTransactionManagerDouble(trace: string[] = []): jest.Mocked<ITransactionManager> {
  let opened = 0;

  return {
    run: jest.fn().mockImplementation(async <T>(work: (transaction: Transaction) => Promise<T>): Promise<T> => {
      opened += 1;

      const result = await work(OPENED_IN_ORDER[opened - 1] ?? { id: `transaction-${opened}` });

      trace.push(COMMITTED);

      return result;
    }),
  };
}
```

The obvious version invokes the callback and resolves, with nothing recorded in between. A test that
asks "does this publish AFTER the transaction?" then passes whether the publish is inside it or
after it, because both produce `["save", "publish"]` — and "publish after the commit" is one of the
most common things a use-case spec claims. `["save", COMMITTED, "publish"]` is the assertion that
can fail.

**A distinct handle per call** is the other half. "This ran in a second, separate unit of work" is a
real requirement — a revocation that must survive the exception thrown right after it — and a double
reusing one object cannot tell that apart from running inside the first. The first two handles are
named so a spec can assert which unit of work a call received; from the third call on the double
mints a fresh one.

Building a test module is for end-to-end tests, where wiring is the thing under test. Reaching for
one to test a use case buys a slower test that also fails when an unrelated module changes.

## Building entities

An aggregate has a private constructor, so tests build it through `reconstitute` behind a builder:

```typescript
export function anOrder(): OrderBuilder {
  return new OrderBuilder({ id: "order-1", status: PENDING_STATUS_VALUE, customerId: "customer-1" });
}

anOrder().settled().withCustomerId("customer-2").build();
```

The builder supplies sensible defaults and each test overrides only what it is about. That is what
keeps a new required field from breaking two hundred tests: it gets a default in one place.

**Builders and doubles live beside what they build or stand in for**: `<entity>.builder.ts` next to
the entity, `<port>.double.ts` next to the port interface. Both are excluded from the build and from
coverage (`project-bootstrap` shows the exclusion).

A builder produces valid aggregates. To test an invalid one, construct it explicitly in the test so
the invalidity is visible in the test rather than hidden in the builder.

## Determinism

Two things make tests intermittently wrong, and both are the same problem: state the code reaches
for instead of receiving.

- **The clock.** An entity calling `new Date()` cannot be asserted against, and any rule involving a
  boundary — an expiry, a day rollover — passes or fails depending on when the suite runs. Inject a
  clock port, or take the instant as a parameter.
- **Generated ids.** An id minted inside a factory makes the result unassertable and couples every
  test to the generator. Inject it the same way.

Both are ports like any other (see the `application-layer` skill). Adding the seam is a small change
and it is what makes time-dependent rules testable at all, rather than tested approximately.

A test that needs `await sleep(...)` to pass is describing a race the code has, not a timing the
test needs.

## Integration and end-to-end

An integration test runs against a **real** database, started for the suite and reset between tests.
Its subject is the query: the filter, the sort, the paging, the index being used. A repository
tested against a fake proves the fake works.

**The server is a one-node replica set started in memory for the run** — `mongodb-memory-server`'s
`MongoMemoryReplSet`, from the test runner's global setup — so the suite needs no container and a
clone runs it with nothing up. A replica set, because the code under test opens transactions and a
standalone server refuses them. The server version is pinned to the one the local stack runs, so a
query that behaves differently between versions fails here first.

- **A database per suite**, on that one server. Suites run in parallel; one database each is what
  keeps them from reading each other's documents. Between tests, empty the collections and keep
  their indexes.
- **Wait for the indexes before the first test.** A unique index still building accepts the
  duplicate the test is about, and the test passes for the wrong reason.
- **Connect with the application's own options** — `useBigInt64` included — so a repository reads
  here what it reads in production.
- **Build the repository with `new`**, handing it its model — and the audit repository, where it
  writes a trail. The real transaction manager is built for the test to open units of work with. The
  subject is the query, not the wiring.

What earns an integration test is what only a server can answer:

| Subject | The test |
| --- | --- |
| A filter | each one alone, including a search whose text contains a regex metacharacter |
| A sort | equal sort values inserted out of order, paged through: no row twice, none missing |
| A unique index | the second write answers the **domain** error, not the driver's |
| Soft delete | a deleted record is gone from every read, and frees what its unique index held |
| A conditional write | a claim, a lock, a rotation, an idempotency key: many callers at once, exactly one wins |
| The unit of work | a write, then a throw inside the transaction: nothing of it remains, audit entries included |
| A migration | against documents in the previous version's shape: `up`, `up` again changing nothing, `down` |

**The end-to-end suite gets a database of its own**, derived from the application's connection
setting and dropped before every run, and each suite creates the accounts it signs in with — through
the application's own repositories, holding exactly the permissions the test is about. A suite that
signs in as the seeded administrator depends on the seed having run against the database it uses,
and one that runs against the development database leaves its records in it and passes because of
what an earlier run left there. With a disposable database there is nothing to clean up afterwards —
and a clean-up that deletes through the API fires handlers that are still running when the
application closes.

**The end-to-end suite calls the application's own bootstrap function**, never its own copy of the
arrangement:

```typescript
// ❌ a second pipeline that drifts from the real one, silently
app.use(cookieParser());
app.useGlobalPipes(new ValidationPipe({ whitelist: true }), new I18nValidationPipe());

// ✅ the same call main.ts makes
configureRequestPipeline(app);
```

A test that arranges its own pipes and middleware is testing an application that does not exist. The
copy is right on the day it is written and wrong on the day the real one changes — and the symptom
is the worst kind: the bug ships while the test written to cover it keeps passing.

**Every runner loads `reflect-metadata` in its `setupFiles`** — unit, integration and end-to-end —
so no spec can forget it. Validation and injection read their rules from decorator metadata, and the
application installs that polyfill through the framework. A spec that imports the validator directly
does not: without the setup file the decorators register nothing, validation finds no errors, and
every negative case passes **vacuously** — the suite is green and asserts nothing. The tell is a
positive case passing alongside negative cases that never throw.

**Assert what the client receives, not only the status.** A rejection has a body, and the body is
where the leaks are:

```typescript
// ❌ green while the problem carries an untranslated key with the submitted password inside it
await request(app.getHttpServer()).post("/api/v1/auth/login").send(bad).expect(400);

// ✅
const response = await request(app.getHttpServer()).post("/api/v1/auth/login").send(bad).expect(400);

expect(response.body.code).toBe("common.validation_error");
expect(response.body.errors).toEqual([{ field: "email", message: expect.any(String) }]);
expect(JSON.stringify(response.body)).not.toContain(submittedPassword);
```

End-to-end tests cover the paths where wiring is the risk:

- The full request pipeline — the versioned routes, guards, pipes, the exception filter, the success
  envelope and the Problem Details body with its media type.
- Authentication over **both transports**: cookie and bearer header. Testing one leaves the other to
  rot silently, and the one that rots is always the one the developers do not use (see the
  `authentication` skill).
- Authorization: a permission missing gives 403, and somebody else's record gives what the
  `authorization` skill says it should.
- Each error class reaching the client with the right status, code and problem body.

## A test that cannot fail

The failure mode with no symptom. It is green, it is counted, it is named after the behavior it
does not check, and the only way to find it is to go looking.

**Break the behavior and watch the test fail.** Once, when writing it. Move the call, delete the
line, invert the condition — if the suite stays green, the test was decoration. This costs a minute
and is the only evidence that the assertion is attached to anything.

Four ways they appear:

- **The double cannot express the failure.** The transaction manager above: no commit boundary, so
  ordering assertions hold either way.
- **The fixture cannot reach the code.** A negative case whose input is rejected before the rule it
  names ever runs — so it throws, the test passes, and it proves a different rule. Assert the
  specific error, never just that something was thrown.
- **The assertion is weaker than the name.** `expect(publish).toHaveBeenCalled()` under a test
  called "publishes after the commit" — true wherever the publish happens.
- **The setup never registered anything.** A spec for decorator-driven validation run by a runner
  that does not load `reflect-metadata`: the decorators register nothing, `validateSync` finds no
  errors, and every negative case passes vacuously. The tell is the same one — positives pass,
  negatives never throw.

**A use case with no spec at all is the same defect, louder.** Coverage of the feature hides it,
because the feature's other use cases are covered — check per file, not per slice. The rule nobody
tests is where the wrong rule lives.

## What not to test

- **That the framework works.** Injection resolving, a built-in validator validating, the driver
  connecting.
- **Private methods.** Reach them through the public one; a private method that needs its own test
  is a collaborator that has not been extracted yet.
- **Implementation detail.** Asserting that a repository was called with a specific object shape
  couples the test to a refactor with no behavior change.
- **Coverage for its own sake.** Coverage finds code nobody exercises; it does not say the exercised
  code is right. A test written to move the number tests nothing and still has to be maintained.

**The floor is a tripwire, not a target.** Measure coverage only where the rules live — `domain/`
and `application/`, without builders, doubles and specs — and fail the unit command below a fixed
floor. What it catches is the use case with no spec at all, which a feature's overall number hides.
Set it under what the code already has, so it trips on a gap rather than on a refactor.

## Checklist

- [ ] Each test is in the right kind, with the matching suffix.
- [ ] Each test has one behavior, named as a sentence, in arrange/act/assert order, with a blank
      line between the sections.
- [ ] Every rule is tested where it lives, once.
- [ ] Doubles are typed against the interface, and the transaction manager double runs its callback.
- [ ] Entities are built through a builder with defaults; builders and doubles sit beside what they
      build or stand in for, outside the build and the coverage.
- [ ] Every test runner lists `reflect-metadata` in its `setupFiles`.
- [ ] No test depends on the real clock, a generated id, or a sleep.
- [ ] Repository tests run against a real replica set, on a database of their own, after its indexes
      exist.
- [ ] The end-to-end suite runs on its own database and creates the accounts it uses.
- [ ] The unit command fails below the coverage floor over `domain/` and `application/`.
- [ ] End-to-end tests cover both authentication transports.
- [ ] The end-to-end suite bootstraps through the application's own function, not a copy.
- [ ] Rejections are asserted on their body, not only their status.
