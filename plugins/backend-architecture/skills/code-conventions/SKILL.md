---
name: code-conventions
description: "Universal TypeScript/NestJS conventions for every file in any layer — forbidden constructs (`any`, non-null `!`, `console.*`, `enum`, `as` outside sanctioned cases), type annotations, `interface` vs `type`, absence via `undefined`, no magic values, constructor injection, pure functions, no mutation of data you do not own, type-only imports, floating promises, named exports, comments and JSDoc, blank lines, braces, the naming and file-suffix tables."
when_to_use: "Trigger on — writing or editing ANY `.ts` file, declaring a class/type/interface or an `enum`, injecting a dependency, casting with `as`, inlining a literal, binding a `const`, mutating an array or object, calling an async function, naming a file/class/constant/token, choosing a file suffix, a guard without braces, an `import type` in a decorated signature, a request body that skips validation silently because its DTO was imported as a type, a default export, adding a comment or JSDoc, a lint rule that contradicts a documented convention, or reviewing code for convention compliance."
---

# Universal code conventions

These apply to **every file** regardless of feature or layer. Layer-specific patterns live in the
other skills (`domain-modeling`, `application-layer`, `persistence-layer`, …); this skill is the
always-relevant baseline.

## Formatting belongs to the linter

Whitespace, indentation, quote style, semicolon placement, import order and everything of that kind
are the project's linter to decide and its `--fix` to apply. This skill names no lint rule and
prescribes none of them: the config differs from project to project, so a rule spelled out here
would be wrong somewhere while reading as authoritative.

What this skill does prescribe are the shapes a reader has to recognize — where a blank line falls,
when a guard takes braces, what a name says. Those are either not machine-checkable at all, or not
configured everywhere, and without them the same construct ends up written three ways in one repo.

**When the linter and this skill disagree, the linter wins.** Follow it, then report the
disagreement so this skill gets corrected: a rule here that fails `lint` sends every reader who
trusts it into a red build.

## TypeScript

- **`any` is forbidden.** Use `unknown` and narrow it with a type guard. `any` does not describe a
  value the compiler cannot type — it switches the compiler off for every expression that value
  touches, including the ones you did not intend.
- **The non-null assertion operator (`!`) is forbidden.** Use an explicit guard, `??`, or
  extract-then-check. `!` is a claim the compiler cannot verify and the next refactor cannot
  invalidate, so it fails silently at runtime rather than loudly at build time.

  The one sanctioned form is the **definite-assignment `!` on a property of a class a framework
  populates** — the validated environment class, a persistence schema, a request or response DTO.
  Those are schema descriptions rather than objects anyone constructs, so `strict` reports every
  property as uninitialized. Here the assertion *is* verified: the validator throws at startup or
  at the request boundary when a value is missing. Reach for it only where something else does that
  checking, never to quiet a property your own code assigns.

  ```typescript
  export class EnvironmentVariables {
    @IsString()
    @IsNotEmpty()
    public MONGO_URI!: string;
  }
  ```
- **Annotate what other code reads, and where inference is wrong.** Parameters, return types and
  class properties are the surface somebody else depends on, so they always carry a type. A local
  binding does not: `const user = User.create({ email })` says `User` twice, and the second one is
  noise that has to be kept in step with the first.

  The exception is a local whose inferred type is not the one intended, and it is worth knowing the
  shapes:

  ```typescript
  // a filter built up field by field — the empty literal is not its type
  const filter: Record<string, unknown> = { deletedAt: null };

  // the generic arguments are what make every `get` return the validated value
  const config: ConfigService<EnvironmentVariables, true> = app.get(ConfigService);

  // `unique symbol` is a DI token; `symbol` is not
  export const CLOCK_TOKEN: unique symbol = Symbol("CLOCK_TOKEN");

  // and where a type is derived FROM the value, an annotation is actively wrong
  export const ORDER_STATUS_VALUES = ["pending", "settled"] as const;
  export type OrderStatusValue = (typeof ORDER_STATUS_VALUES)[number];
  ```

  Do not enforce this with a linter. A rule that demands an annotation on every declaration cannot
  tell the informative ones from the redundant ones, and it forbids the derived-type idiom outright.

  A callback is a function like any other: every arrow parameter and its return type are annotated
  (`.map((user: User): UserDTO => ...)`), except where nobody reads the signature — a decorator's
  thunk (`@Type(() => Number)`), a test runner's callbacks (`describe`, `it`) and the thunks a test
  hands the runner's helpers (`expect(() => …)`, `mockImplementation`). A test's own helpers are not.

- **No TypeScript `enum`.** An enumerable concept is a `const` array with its union type derived
  from it (`domain-modeling` owns the shape), validated at the boundary with `@IsIn` over the same
  array. An `enum` adds a second set of names beside the values — the member in code and the string
  that is stored drift apart — a numeric one reverse-maps its keys into the same object, and neither
  hands `@IsIn` or a catalog check the plain list of values they need. The environment is one more
  such concept: a `["development", "production", "test"] as const` array, compared inline
  (`config.get("NODE_ENV", { infer: true }) === "production"`).

- **`interface` for contracts, `type` for data.** An `interface` is what something *implements* — a
  repository, a port, a bus — and carries an `I` prefix. A `type` is a shape that flows through the
  system: a DTO, a command, a union, a utility type. The split is not stylistic:
  `implements IUserRepository` is the sentence that makes the dependency inversion visible at the
  class declaration, and a union cannot be an interface.

  The one contract without the prefix is the opaque **`Transaction`** handle: nothing implements it
  in the domain's eyes — the domain names it as a value it receives and passes along, so it reads as
  a value type, and only the infrastructure boundary that declares it knows what is inside.

- **`readonly` on anything that must not change after construction** — command fields, value-object
  internals, injected dependencies. It is the cheapest way to say a value is an input, not a slot.
- **Constructor injection only, and every PORT through its token.** A port — a repository, a clock,
  a hasher, a provider adapter — is injected with `@Inject(TOKEN)` and typed as its interface.
  Injecting the implementation instead compiles and works, and silently deletes the seam the
  interface exists to create: the one the tests and the environment switch both depend on.

  These are injected concretely because they have no port and need none:

  - what the framework supplies (`ConfigService`, `Reflector`, a model, the connection);
  - the ambient request context service — framework-level infrastructure in the same sense as
    `ConfigService`, with one implementation and nothing to swap;
  - a use case injected into a thin caller — a controller, an event handler, a scheduled job — whose
    public surface is already the boundary (see `application-layer`);
  - another use case injected into one.

  Never property injection, in any of those cases.
- **The `as` cast is forbidden** except three cases, and all three share one shape: the value has
  already been checked, and the cast only tells the compiler what something else proved at runtime.

  1. `as const`.
  2. A `string` or `string[]` to a value union **in a controller**, narrowing a request DTO field
     onto the command it builds. The DTO holds what arrived, so its enumerable fields are typed
     `string`; `@IsIn` over the same `const` array has already rejected anything outside the union
     by the time the handler runs (see `presentation-layer`). The cast is sanctioned **there and
     nowhere deeper** — further in, nothing has validated the value and the cast would be a guess.
  3. Narrowing an opaque transaction handle at the infrastructure boundary that declares it.

  A value object validating a string against its own catalog is **not** one of them, and does not
  need to be — which is also why a persistence mapper needs no cast: it hands the stored string to
  the value object's `create()`, which narrows it (see `persistence-layer`).
  `VALUES.includes(value as Union)` asserts the answer to the question it is asking. A type
  predicate says it once instead, and the narrowing comes from the check rather than from a claim:

  ```typescript
  export function isOrderStatusValue(value: string): value is OrderStatusValue {
    return (ORDER_STATUS_VALUES as readonly string[]).includes(value);
  }
  ```

  The cast inside it widens the tuple to compare against, which proves nothing and hides nothing.

  To narrow `unknown` — a `catch` binding, an untyped payload — use a type guard, never `as`. An
  `as` that forces an otherwise-incompatible shape hides the real mismatch; fix the type instead.
- **A type-only import says so**: `import type { X } from "..."`, as its own statement rather than
  mixed into a value import. This is not cosmetic — it tells the compiler the import can be erased,
  which is what keeps a type reference from creating a runtime dependency. On a backend with a DI
  container that is the difference between a clean module graph and a circular import that only
  fails at boot.

  The exception is **a class in a decorated signature** — a constructor parameter of a decorated
  class, a parameter of a decorated method (`@Body() dto: CreateUserDTO`), a decorated property.
  With decorator metadata on, the framework reads that class at runtime, so it is a value use even
  though it appears only in a type position. `import type` there hands the reader `Object`: the
  injector fails to resolve the provider at boot, and — worse, because nothing fails — the
  validation pipe reads `Object` as the body's metatype and skips validation silently. It stays a
  value import. A type alias or an interface in the same position has no runtime value to read — the
  metadata is `Object` either way — so it is an `import type` like anywhere else
  (`@CurrentUser() principal: Principal`).

  The linter's type-import rule skips any file that has decorators for exactly this reason, so in
  those files the rule is kept by hand: a type used only outside a decorated signature is still an
  `import type`.
- **`console.*` is forbidden.** Output goes through the class's injected or instantiated logger;
  see the `observability` skill for which and why. The single exception is the top-level `catch` of
  each process entry point — the application, each command, the instrumentation, a local script —
  which runs before a logger exists and writes one `console.error` before exiting non-zero.
- **No floating promises.** Every promise is awaited, returned, or explicitly handled. An unawaited
  call inside a request loses its errors to an unhandled rejection and completes after the response
  has already been sent, so the failure surfaces detached from the request that caused it. Run
  genuinely independent work with `Promise.all`, not by dropping the awaits.

### Absence is `undefined`, never a sentinel

`""`, `0`, `-1` and `"none"` are legitimate domain values. Reusing one to mean "not set" conflates
absence with data and forces a matching decode somewhere else — a `!== ""` guard, a `?? ""`
round-trip whose only job is to be undone. A pure helper takes a real value; do not widen it to
accept `undefined` and return `""`.

The sanctioned exceptions are all **frontier** cases, where a library — not the domain — refuses
`undefined`, and the foreign shape stops at that library's boundary:

- A database driver that distinguishes "field absent" from "field null", where the persistence
  mapper decodes `null` back to `undefined` on the way in and the reverse on the way out (see
  `domain-modeling` for the full `?` vs `null` table).
- A driver API that takes `null` rather than an optional argument, where the `?? null` sits in the
  one call that needs it.

The test for any new one: the foreign shape exists on exactly one side of a boundary and is decoded
*at* that boundary. A `null` that travels further — into a use case, an entity, a policy — is
precisely the defect this rule is about.

### No magic values

A numeric or string literal that carries domain meaning is a named `SCREAMING_SNAKE_CASE` constant,
not an inline literal. Exempt: trivial structural literals (`0`/`1`/`-1` for index, length or step;
`length === 0`) and values from a universal published vocabulary every reader already knows — an
HTTP status, a well-known MIME type. Naming those adds a lookup instead of removing one.

The exemption means you need not *invent* a constant, not that the literal is preferred. **When the
framework already publishes the vocabulary, use it**: `HttpStatus.CONFLICT`, not `409`. The giveaway
is a file that does both — `@HttpCode(HttpStatus.OK)` on the handler and `status: 200` in the
decorator above it — which is how the same value ends up written two ways on one route.

**Where this bites hardest on a backend is the string nothing type-checks**: a collection name, a
queue or topic name, an error code, a header name, a cache-key prefix, a feature-flag key, an
external system's magic string.

```typescript
// ❌ rename the code upstream and this branch goes silently dead — no compile error
if (error.code === "orders.order_already_settled") { /* ... */ }

// ✅ one definition, and the rename is a compile error at every reader
if (error.code === ORDER_ALREADY_SETTLED_CODE) { /* ... */ }
```

**Value-union members are the exception.** Comparing against a member, or passing one as an argument
to a parameter typed as that union, stays a plain inline literal (`order.status === "settled"`) —
the closed union already makes a typo a compile error there. A member used as a **stored or default
value** comes from its named constant (`SETTLED_STATUS_VALUE`), never a re-typed literal: the
literal compiles, so nothing points at it when the member is renamed.

### A `const` earns its place by adding a name

A local binding is justified two ways: it **names something the expression doesn't** — a compound
condition, a real transformation — or it **unifies several readers**, replacing repeated reads of
the same access with one word. A binding that does neither is noise, and the giveaway is an alias
read exactly once.

```typescript
// ❌ restates the access it wraps — `command.email` already reads as "the email"
const email = command.email;

return this._usersRepository.getByEmail(email);

// ✅ names a condition the expression doesn't
const isReactivation = user.isInactive && command.status === ACTIVE_STATUS_VALUE;
```

This is the comments rule below in variable form: a name that describes *what* the next line already
says adds a hop, not information.

### Pure functions stay pure

A helper, a formatter, a mapper, a domain policy: output depends only on its arguments, with no I/O,
no mutation of those arguments, and no read or write of module-level mutable state. Side effects
belong in use cases, repositories, and handlers — never hidden inside a function that looks like a
transform.

This is also what makes the rest of the architecture testable: a mapper you can call with a literal
and assert on needs no test module, no container, and no database.

### No in-place mutation of data you don't own

Derive new values with `map`/`filter`/`reduce`/spread. Never mutate an array or object argument, an
entity another aggregate owns, or a shared constant. Prefer `const`; reach for `let` only when
reassignment is intrinsic to the algorithm, not to avoid thinking about the immutable form.

**A mutable object a library hands you to mutate is not "data you don't own".** An HTTP client's
request-config interceptor and a framework's `request` object in middleware are the standard cases:
the contract is *receive it, modify it, return it*, and cloning instead would drop what the
framework set on it. The rule is about values that flow **through** your code, not about a slot
whose whole purpose is to be written.

## Comments and JSDoc

Default is **no comments, no JSDoc**. Add a comment only when the *why* is non-obvious — a hidden
constraint, a workaround, surprising third-party behavior, a business rule encoded as a number — and
cannot be expressed through naming. Never describe *what* the code does.

JSDoc follows the same test, not a stricter one. It earns its place when the *why* belongs to the
whole class rather than to a line inside it — why this adapter has no simulator, why this double
records a commit, what an unfamiliar reader would otherwise have to reconstruct from the call sites.
What it must never be is a restatement of the signature: no `@param` and no `@returns` that repeat
the types, and no class description that says the class's name in a sentence.

One form is required rather than merely allowed: **a use case class lists every domain error
`execute()` can throw**, because that set is the caller's contract and nothing else states it.

```typescript
/**
 * @throws {UserNotFoundError} If no active user matches the id
 * @throws {EmailAlreadyRegisteredError} If another user already holds the new email
 */
@Injectable()
export class UpdateUserUseCase { /* ... */ }
```

A `try`/`catch` and a transaction block are where the rule slips most: both feel like they deserve a
caption, so they get one that restates the body.

```typescript
// ❌ restates the code — the call already says this
// Wrap the save in a transaction so both writes commit together
await this._transactionManager.run(async (transaction: Transaction): Promise<void> => {
  /* ... */
});

// ✅ nothing non-obvious to say, so nothing is said
await this._transactionManager.run(async (transaction: Transaction): Promise<void> => {
  /* ... */
});
```

## Blank lines and spacing

The goal is code a person can scan — neither crammed together nor pulled apart. A blank line marks a
**change of concept** or gives a tall block room to breathe; it is not a separator dropped between
every statement. Over-spacing is a defect too: when everything is separated, nothing is grouped.

One thing decides it: **how tall the declaration is.**

- **A run of single-line declarations of the same shape and purpose stays together** — no blank
  lines, however many there are. They read as one list, which is what they are: the members of a
  value union, a run of `if (x !== undefined) { filter.x = x; }` filter guards, the properties of a
  bare type, the `let` declarations at the top of a suite.

  ```typescript
  export const PENDING_STATUS_VALUE = "pending";
  export const SETTLED_STATUS_VALUE = "settled";
  export const CANCELLED_STATUS_VALUE = "cancelled";
  ```

- **Anything spanning more than one line gets a blank line on each side**, even from code it is
  closely related to — a decorated property, a multi-line object or array, a braced guard, a method,
  a call whose arguments wrap. Height is what makes a block hard to find the edges of, and the blank
  line is what gives them back. Relatedness never overrides it: a one-line statement butted against
  a multi-line one reads as a single lump. Between statements the linter enforces it (see the
  `project-bootstrap` lint table); between class members it is kept by hand.

  <!-- snippet-check: skip -->
  ```typescript
  // ❌ the wrapped call starts wherever the eye happens to land
  app.use(cookieParser());
  app.useGlobalPipes(
    new EmptyBodyPipe(),
    new I18nValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  ```

  ```typescript
  // ✅ two statements, and it is obvious which is which
  app.use(cookieParser());

  app.useGlobalPipes(
    new EmptyBodyPipe(),
    new I18nValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  ```

  ```typescript
  export class UserDTO {
    @ApiProperty({ example: "01890a5d-ac96-774b-bcce-b302099a8057" })
    public id!: string;

    @ApiProperty({ example: "jane@example.com", format: "email" })
    public email!: string;
  }
  ```

  A decorator belongs to the member below it: the two are one declaration two lines tall, which is
  why a decorated member list is spaced and the same type written without decorators stays packed.

- **Separate distinct concepts** with one blank line even when both are single-line: the dependency
  reads from the work that uses them, one derivation from an unrelated one, and before an
  `if`/`return` that follows unrelated work.

  The test is whether the statements do the same kind of work, not whether they mention the same
  subject: three declarations illustrating three different rules are three concepts.

- **No blank line at the very start or end** of a class, method, function or callback body.

Two things are outside all of this, because the linter already owns their layout:

- **Parameter and argument lists** — their separator is the comma. A constructor's injected
  dependencies stay unspaced however many there are.
- **The import block** — the linter's import-ordering rule decides the groups and the blank lines
  between them. A wrapped import sitting against a single-line one is the linter's arrangement, not
  a lump to break up, and spacing inside a group would fight it on every save.

**Every guard takes braces**, whatever its body — a `throw`, a constructed return, a statement, and
equally a bare `return;` / `continue` / `break`:

```typescript
if (!user) { return; }

if (!user) { throw new UserNotFoundError(userId); }
```

One form for every guard means the body can grow a second statement without the `if` changing shape,
and nobody has to decide which exits are "dead-end enough" to go bare. Never split one `if` across
two lines without braces.

## Exports

Named exports everywhere. No default exports — they let each importer invent its own name for the
same symbol, which breaks every grep for a usage.

The one exception is a file a **tool** loads by convention and requires a default export from: a
test runner's global setup or teardown, a `*.config.mjs`. There the export's name is the tool's, not
the code's, and nothing imports it by name.

## Naming conventions

Both naming tables — names by context (files, classes, interfaces, constants, DI tokens,
collections, enumerable values, error codes, routes, query parameters) and file suffixes by artifact
— are in [references/naming-tables.md](references/naming-tables.md). **Read it before naming a file,
class, constant, token or route, or choosing a suffix**; the rules below explain the tables and
settle what they cannot.

**The accessor rule is about reads and writes of a value.** A method that *does* something is a
method and keeps its verb, even when the verb is `get` or `set`: `getEvents()` drains the
aggregate's event buffer — calling it twice returns two different answers — and `setPrincipal()`
writes the request context. A getter that emptied a buffer would be a read with a side effect hidden
behind property syntax.

**Type suffix by artifact.** The suffix says what a file holds before it is opened, and it is what a
glob keys on — the build and coverage exclusions, a test runner's pattern. Every suffix a file may
take is in the suffix table; the test files' own suffixes belong to `testing`.

Two kinds of file take **no suffix**, and the rule for each has no exceptions:

- **What its folder already names.** Value objects in `value-objects/`, helpers in any `utils/`
  folder — `fingerprint.ts`, `holds-exactly.ts`. A `.util` suffix inside `utils/` says the same
  thing twice.
- **A port's implementation**, named for its technology and the port it implements, as the
  kebab-case of its class: `bcrypt-password-hasher.ts`, `system-clock.ts`, `s3-file-storage.ts`,
  `nodemailer-email-service.ts`, `mongo-transaction-manager.ts`. The technology is the one thing
  that tells it from the next implementation of the same port; a suffix such as `.adapter` or
  `.service` on some of them and not others is how a glob or a grep misses half.

Mappers take the **layer** in the suffix because a feature has two of them, and a bare
`user.mapper.ts` in two folders gives two different classes the same name.

**Plural vs singular.** Artifacts that serve the whole feature take the **feature name (plural)**:
module, repository, controller, errors file, errors map, event handlers. Artifacts that describe or
convert one thing take the **entity name (singular)**: entity, schema, DTO, value object, command,
and both mappers (`user.persistence-mapper.ts`).

**Names carry domain meaning.** Prefer the domain word over `data`, `result`, `item`, `info`,
`payload`: `.map((user: User): UserDTO => …)`, not `.map((item: User): UserDTO => …)`. Grep a
sibling file before inventing a name for an entity the codebase already names. Sanctioned generic
names: `document`/`documents` inside a persistence mapper, `dto` inside a presentation mapper, and a
generic helper over `unknown`.

**No single-letter parameters.** `(error: unknown) =>`, not `(e: unknown) =>`. The exception is an
index or mathematical convention where the letter *is* the term (`i` in a hand-written loop).

**snake_case is for values that cross a boundary, camelCase for the keys around them.** A value
union's member, an audit action and an error code are read by a database, a translation file and a
client — none of which follow the codebase's casing — so they take a form that survives all three
unchanged. An error code also carries its feature as a prefix, because it is a key in a translation
file shared by every feature, and two features' `not_found` must not collide there. The field
holding one is still camelCase (`status: "pending_creation"`), and so is the constant's own name in
code (`PENDING_CREATION_STATUS_VALUE`). A collection name is snake_case for the same reason: it is a
string the database owns, not an identifier.

The exception is a union whose members **name something that already has a casing** — a `sortBy`
whitelist, whose values are field names, stays camelCase (`"createdAt"`), because renaming them to
match this rule would break the API for a field the client can already see.

**Sentence case for docs, comments and messages**: "User created successfully", not "User Created
Successfully". Proper nouns, acronyms and products keep their casing (`NestJS`, `API`, `JWT`). A
commit description follows `engineering-workflow:git-workflow`.

## Two rules the linter cannot check

The type-import rule in a file with decorators and the rule against annotating an inferred local
each have a script beside this skill. **Run them, do not read them** — after converting a codebase,
or when a review finds either rule broken in more than a file or two — from the project root, with
its `typescript` installed. Without `--write` each only reports; the second recompiles for every
edit it verifies, so it takes minutes. After either writes, run the linter and the typecheck.

```text
node ${CLAUDE_SKILL_DIR}/scripts/type-imports.cjs [--write]
node ${CLAUDE_SKILL_DIR}/scripts/redundant-local-annotations.cjs [--write]
```

## Checklist

- [ ] No `any`, no `!`, and every `as` is one of the three sanctioned cases — each one a value
      something else already validated.
- [ ] No TypeScript `enum`; every enumerable concept is an `as const` array with its derived union.
- [ ] Every parameter, return type and class property carries an explicit type, callbacks included
      — all but a decorator's thunk and what a test hands its runner and the runner's helpers.
      A local carries one only where inference would give the wrong type.
- [ ] Every injected port is an interface behind `@Inject(TOKEN)`; every concrete injection is one
      of the listed cases.
- [ ] Every promise is awaited, returned, or explicitly handled.
- [ ] Every literal that carries domain meaning and is not a value-union member is a named constant.
- [ ] Every `const` either names a concept or unifies several readers.
- [ ] No statement that wraps onto a second line touches the statement above or below it.
- [ ] Every `if` body is in braces, a bare `return;` included.
- [ ] Every type-only import uses `import type` and stands as its own statement — except a class in
      a decorated signature, which stays a value import.
- [ ] Every `console.*` call is the top-level `catch` of a process entry point.
- [ ] Every default export is one a tool requires.
- [ ] Every comment and JSDoc states a *why* the signature cannot; every use case lists its
      `@throws`.
- [ ] Every file, class, token and route follows the naming tables, and each mapper file names its
      layer and its entity.
