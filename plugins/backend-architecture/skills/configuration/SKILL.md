---
name: configuration
description: "Environment variables and operator-editable settings — the validated `EnvironmentVariables` class and what stays out of it, required variables with no default or fallback, an optional variable that is absent or valid, credentials required only for the selected provider, coercion, the typed `ConfigService` with `infer`, configuration handed to use cases as a typed value, `.env.example` as the contract, environment or database, the settings aggregate."
when_to_use: "Trigger on — adding or reading an environment variable, a variable only a command or the instrumentation reads, editing the env validation class, `.env` or `.env.example`, injecting `ConfigService`, a `get` that returns `any`, a typed settings value injected into a use case, a number or boolean arriving as a string, a price or quota in the environment, branching on `NODE_ENV`, an app that started with a missing variable, moving a value into the database, a seed that never updates what exists, a variable declared but empty, an optional capability left unconfigured, a placeholder key for a provider that is not selected, two settings each valid and wrong together, or a value written twice for the app and the local stack."
---

# Configuration

## Every variable is validated at startup

One class declares every variable the application reads, and the process refuses to start if any of
them is missing or malformed:

```typescript
export const ENVIRONMENT_VALUES = ["development", "production", "test"] as const;
export type EnvironmentValue = (typeof ENVIRONMENT_VALUES)[number];

const MINIMUM_SECRET_LENGTH = 32;

export class EnvironmentVariables {
  @IsIn(ENVIRONMENT_VALUES)
  public NODE_ENV!: EnvironmentValue;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  public PORT!: number;

  @IsString()
  @IsNotEmpty()
  public MONGO_URI!: string;

  @IsString()
  @MinLength(MINIMUM_SECRET_LENGTH)
  public JWT_SECRET!: string;

  @IsBoolean()
  @ToBoolean()
  public COOKIE_SECURE!: boolean;
}
```

The definite-assignment `!` on every property is the sanctioned form for a class a framework
populates (see `code-conventions`). The environment is an `as const` array like any other enumerable
concept, never a TypeScript `enum`, and a reader compares it inline:
`config.get("NODE_ENV", { infer: true }) === "production"`.

Environment variables arrive as strings, always. `@Type(() => Number)` and a boolean transform —
`ToBoolean` stands for the project's own, mapping `"true"`/`"false"` and leaving anything else for
`@IsBoolean` to reject — are what make `PORT` an actual number rather than `"3000"`. Without them a
comparison silently takes the string path and a validator passes the wrong type through.

**Required is not the same as present.** `@IsString()` accepts `""`, so a variable that was declared
and left blank passes startup and fails later, far from its cause — `JWT_SECRET=""` boots happily
and breaks every login. Every string variable carries `@IsNotEmpty()` too, optional ones included,
and a secret carries a minimum length: the placeholder somebody types to get the process started is
always short.

## Rules about a pair of values

Some configuration is only wrong in combination, and no field-level decorator can see that. Each of
these validates cleanly and then fails somewhere that points nowhere near the cause:

- **Two secrets that are equal.** The refresh secret and the access secret being the same makes a
  refresh token verify as an access token, handing its holder a long-lived session.
- **A refresh family shorter than one refresh token.** The family expires before the token it
  issued, so no refresh ever succeeds, and the failure looks like a broken client.
- **A wildcard CORS origin while sending credentials.** The browser refuses the combination, so the
  API works from curl and from nothing else.
- **An unbounded token lifetime.** An access token cannot be revoked before it expires, so its
  lifetime *is* the revocation delay. Give it a ceiling.

They belong in one cross-validation step that runs after field validation, and it **collects every
problem before throwing**. Reporting the first one turns a misconfigured environment into as many
deploys as it has mistakes.

Anything the validator parses — a duration, a URL, a list — is parsed by the same function the
adapter uses later. A second parser is a second opinion about what `15m` means, and the disagreement
surfaces as a lifetime nobody configured.

## What a tool reads is not the application's

The validation class declares what **the running application** reads, and nothing else. A value only
a command reads — the first administrator's email and password for the seed, the target of a one-off
script — is validated by a class of that command's own, called by the command before it writes
anything:

```typescript
export class SeedVariables {
  @IsEmail()
  public SEED_ADMIN_EMAIL!: string;

  @IsString()
  @IsNotEmpty()
  public SEED_ADMIN_PASSWORD!: string;
}

// in the seed, once the application context has loaded the env file
const seedVariables = validateSeedVariables(process.env);
```

Declared in the application's class instead, the variable becomes a requirement of every boot: the
process refuses to start without it, so every deployment carries it for as long as it runs. For the
seed that means a password sitting in the environment of every instance, only so that a command run
once at the start could find it.

The same rules hold inside the tool's class — required, no default, no fallback. The env file may
list the tool's variables for local use, in a section that says which command reads them; a
deployment sets them for the run of that command and nowhere else.

The tracing instrumentation is the same case: it runs before the application, reads the service name
and the collector's endpoint, and validates them in a class of its own. They are optional together,
in the sense below: absent, tracing is off; present, both are required and validated (see the
`observability` skill). A library that would default them is the reason to validate them, not a
reason to skip it.

**A command that reads a few of the application's own variables validates just those, by the
application's rule.** The migration command needs the connection string and nothing else; requiring
the whole contract would make a migration need the signing secrets, and declaring the variable again
in the command's own class gives it a second rule that drifts from the first. Validate the
application's class and keep only the errors for the names the command reads:

```typescript
const { MONGO_URI } = validateVariables(process.env, ["MONGO_URI"]);
```

## No defaults, and no fallback in the reader

**Every variable is required**, except the optional ones described below, whose absence switches a
capability off. None carries a default value in the validation class, and no reader writes
`?? somethingElse`.

A default is a second place the value can come from, and the reader has no way to tell which one it
got. The failure it produces is the worst kind: the application starts, reports healthy, and runs
against the wrong database or signs tokens with a placeholder secret — and it does so quietly, for
as long as nobody happens to look.

Requiring everything converts that into a boot failure with the variable's name in it, at deploy
time, in the deploy log, before any traffic arrives.

This holds for the ones that feel harmless too. `PORT` with a default means a misconfigured
deployment listens on the wrong port and the load balancer reports the service as down, instead of
the process saying `PORT should not be empty`. `NODE_ENV` with a default is worse: it decides which
providers are real.

```typescript
// ❌ two sources for one value, and no way to know which one is in effect
const drainSeconds = this._config.get("SHUTDOWN_DRAIN_SECONDS", { infer: true }) ?? DEFAULT_DRAIN_SECONDS;

// ✅ one source, guaranteed present by startup validation
const drainSeconds = this._config.get("SHUTDOWN_DRAIN_SECONDS", { infer: true });
```

## The typed reader

`ConfigService` is injected with the validated class and `true` as its type arguments, and **every
`get` passes `{ infer: true }`**:

```typescript
public constructor(private readonly _config: ConfigService<EnvironmentVariables, true>) {}
```

```typescript
const port = this._config.get("PORT", { infer: true });
```

The two work together. The `true` marks the variables as validated, so `get` returns the value
rather than `T | undefined` — which is what removes the temptation to add a fallback in the first
place. `infer` is what makes `get` return the validated type for that name: the overload without it
returns `any`, so the result is unchecked, and an annotation on the receiving variable then hides
the `any` behind a type nothing verified.

## An optional variable is absent, or valid

Required is the rule. A variable is **optional** only when its absence switches a capability off —
the documentation is not published, no traces are exported, the mail relay is reached without
credentials — and a deployment that forgets it fails closed or visibly. Absence never stands for a
value: a variable whose absence would mean "wait ten seconds" or "trust no proxy" is a default under
another name, and it stays required.

An optional variable has two states, and `""` is neither of them:

- **absent** — the capability is off, and the reader gets `undefined`;
- **present** — and then validated in full, like any required variable, emptiness included.

```typescript
// Absent: the documentation is not published. Present: a list of addresses, never "".
@IsOptional()
@IsString()
@IsNotEmpty()
public DOCS_ALLOWED_IPS?: string;
```

`@IsOptional()` skips only `undefined` and `null`, so a variable declared and left blank still
reaches `@IsNotEmpty()` and fails the boot. That is the point: `VAR=""` is a line somebody meant to
fill in, and reading it as "off" switches a capability off without anybody having decided it. No
transform turns `""` into `undefined`.

- The reader treats `undefined` as the off state, in the one place that turns the capability on — a
  factory, a bootstrap line — and substitutes nothing.
- **Variables that only work together are optional together.** A user without a password, or a
  collector's endpoint without a service name, is rejected by the cross-validation step: all of them
  or none.
- `.env.example` lists an optional variable **commented out**, with what its absence means written
  next to it. Uncommented and empty, it would fail the boot of everyone who copies the file.

A **secure-cookie flag** is required, never optional. It exists so local development over plain HTTP
works — a browser drops a `Secure` cookie on `http://localhost` — and its absence would have to mean
one of two values, which is a default. It is never derived from `NODE_ENV` either: validation cannot
tell a local stack from a deployment, so the `true` is each deployment's own statement, and one that
leaves it `false` sends its session cookies over plain HTTP.

## Credentials belong to the selected provider

Where a variable chooses among the adapters of one port (see the `module-wiring` skill), each
adapter's own settings are required **when that adapter is selected**, and not otherwise:

```typescript
@IsIn(PAYMENT_PROVIDER_VALUES)
public PAYMENT_PROVIDER!: PaymentProviderValue;

@ValidateIf((variables: EnvironmentVariables): boolean => variables.PAYMENT_PROVIDER === "gateway")
@IsString()
@IsNotEmpty()
public GATEWAY_API_KEY?: string;
```

Requiring them unconditionally makes an environment that runs the simulator carry a placeholder key
for a service it never calls — a value that describes no environment, and that somebody eventually
copies into one that does. The selected provider's settings keep every other rule: required, no
default, so switching the selector without supplying them is a boot failure naming each one.

The simulator reads none of them. What it needs of its own — the secret it signs its simulated
events with — is a constant beside it, which a test imports, not a borrowed credential of the
provider it stands in for.

The factory that binds the real adapter narrows each setting with an explicit guard that throws
naming the variable. Validation makes the guard unreachable; the guard is what lets the type say what
validation guaranteed, with no `!` and no fallback (see `code-conventions`).

## Configuration reaches the application layer as a value

A use case never names an environment variable and never injects `ConfigService`. When an
application rule depends on configuration — a session's maximum age, a lifetime bound — the feature
declares a typed value and a token for it in its `application/` layer, and the module builds that
value from `ConfigService` in a factory:

```typescript
export const SESSION_SETTINGS_TOKEN: unique symbol = Symbol("SESSION_SETTINGS_TOKEN");

export type SessionSettings = {
  refreshFamilyMaxAgeMs: number;
};
```

```typescript
{
  provide: SESSION_SETTINGS_TOKEN,
  inject: [ConfigService],
  useFactory: (config: ConfigService<EnvironmentVariables, true>): SessionSettings => ({
    refreshFamilyMaxAgeMs:
      parseDurationSeconds(config.get("JWT_REFRESH_FAMILY_MAX_AGE", { infer: true })) * MILLISECONDS_PER_SECOND,
  }),
}
```

The use case injects it with `@Inject(SESSION_SETTINGS_TOKEN)` and receives numbers in the unit it
works in. A use case that read configuration itself would know the name of a variable, and the layer
meant to be testable with plain objects would need a config module to construct; here a test passes
a literal. The parsing and the unit conversion happen once, in the factory, with the same parser the
validation used.

## The environment beats the file

A `.env` loader does **not** overwrite a variable that is already set in the process environment.
Whatever the shell exported wins, silently, and the application starts perfectly against it.

That is how a stale `MONGO_URI` left over from another project sends a seed or a migration at the
wrong database — everything succeeds, and the only clue is data appearing somewhere nobody looked.

- Treat the file as the default and the environment as the override, because that is what it is.
- When a command behaves as if the file were ignored, print what the process actually read before
  suspecting the file.
- In CI and in containers, pass the variables explicitly rather than shipping a `.env`, so there is
  one source and no precedence to reason about.

## The env file holds the application's contract, and nothing else

`.env.example` lists every variable the application reads — a required one with an illustrative
value or an empty placeholder, an optional one commented out — and it is updated in the same change
as the validation class. A variable added to one
and not the other means the next person's environment fails to boot with no indication of what to
add.

The pressure on that list comes from elsewhere: the local development stack needs values too, and
they are never quite the same values. A compose file provisioning a database needs the root user and
password **in pieces**, because a server is created from parts; the application needs a **connection
string**, because a client connects with one. The same fact, in two shapes, and nothing translates
between them on its own.

Writing both into the env file is the obvious move and the wrong one. The two copies drift — the
port changes in one and not the other — and the failure is silent: the container publishes where
nobody is listening, or worse, another project's container answers on the port this one expected.
Neither message names the variable.

**Remove the second copy instead of maintaining it.** Two ways, and which applies is decided by
asking whether a deployment has any use for the value:

- **Derive it.** The value belongs to the application — a database port, a storage endpoint — so the
  application's variable is the only place it is written, and the command that starts the local
  stack parses what it needs out of it at the moment it runs. Compose reads `${VAR}` from the
  environment of whatever launched it, so a small script that sets them before spawning it is the
  whole mechanism. Change the port in the URI and the container follows.
- **Fix it in the compose file.** The value reaches a local container's own interface — a mail
  catcher's web view, an object-storage console — and has no counterpart in a deployment, where that
  console belongs to the provider. It is not configuration; it is a constant in a file that is
  itself local-development-only.

**Guard the shortcut.** Somebody will run `docker compose up` directly and skip the derivation, so
the interpolations declare themselves required: `${MONGODB_ROOT_USER:?run the infra script}`.
Compose then refuses with that message instead of creating a database with no root user.

**`NODE_ENV` does not belong in the file either.** The process states which environment it is — the
package script, the container, the CI job — so a file cannot contradict the environment it was loaded
for. That is not cosmetic: `NODE_ENV` chooses which adapters are bound, so a production deployment
reading a file that says `development` gets the simulators.

Never commit a real secret, including to `.env.example`.

## Environment or data

**The test is who decides the value and how often.** Infrastructure and secrets are environment;
business parameters are data.

| The value is… | Where it lives |
| --- | --- |
| A connection string, a key, a bucket, a host | environment |
| A secret | environment, injected by the platform |
| Something only a deploy can change | environment |
| A price, a fee, a quota, a ceiling, a threshold | the database |
| Something an operator changes without a deploy | the database |
| A developer-only knob nobody outside the repo tunes | a module-level constant |

A business parameter in the environment has to be changed in every deployment that reads it, cannot
be audited, and tends to get duplicated into whatever consumes it — at which point two places hold
the number and one of them is wrong.

## Operator-editable settings

Values an operator changes live in a settings aggregate — a single document, edited through its own
endpoint and its own permission, like any other aggregate.

- **Seed it idempotently**, so running the seed twice is indistinguishable from running it once.
- **Idempotent is not the same as insert-only.** A seed that skips whatever already exists stops
  maintaining it: a permission added to the catalog after an environment was first seeded never
  reaches the role that is supposed to hold every permission, because that role already exists. The
  new capability then works in a fresh environment and silently fails in every deployed one, which
  is the hardest version of this bug to see. Restate the full desired state and let the aggregate
  ignore what has not changed — an update that changes nothing writes nothing (see the `audit-log`
  skill), which is what keeps the second run a no-op.
- **The reader has no fallback here either.** If the settings document is missing, the request fails
  loudly. Falling back to a hardcoded number restores the very problem the move was meant to remove,
  and hides that the seed never ran.
- **Changes are audited**, because "who lowered the limit and when" is exactly the question that
  gets asked afterwards. See the `audit-log` skill.
- **Cache it if the read cost matters**, and invalidate on write. Do not cache it indefinitely: an
  operator who changes a value expects it to take effect.

## Moving a value from the environment to the database

Do it as one deliberate sequence, not a gradual drift:

1. Seed the value into the settings document, explicitly, **before** deploying the code that reads
   it.
2. Deploy the reader, with no fallback to the variable.
3. Remove the variable from the validation class and `.env.example` in the same change.

Leaving the variable behind means two sources again, and the one that wins depends on which line
someone edits next.

## Branching on the environment

`NODE_ENV` decides which implementation of a port is provided, and that decision happens once, in
the module's factory — see the `module-wiring` skill. Code outside a module factory does not ask
what environment it is in; a use case that behaves differently in development is a use case nobody
has actually tested.

## Checklist

- [ ] Every variable the application reads is declared in the validation class, and nothing only a
      tool reads is.
- [ ] No variable accepts `""`; secrets have a minimum length.
- [ ] Combinations that are only wrong together are checked in one step that reports them all.
- [ ] No variable has a default value, and no reader has a fallback.
- [ ] Every optional variable is one whose absence switches a capability off, is validated in full
      when present, rejects `""`, and is listed commented out in `.env.example` with the meaning of
      its absence.
- [ ] Optional variables that only work together are checked as all or none.
- [ ] A provider's settings are required only when that provider is selected, and the simulator
      reads none of them.
- [ ] Numeric and boolean variables carry a transform.
- [ ] `ConfigService` is injected with the validated-variables type argument and `true`, and every
      `get` passes `{ infer: true }`.
- [ ] No use case injects `ConfigService` or names an environment variable; configuration it needs
      arrives as a typed value behind a token, built in the module's factory.
- [ ] `NODE_ENV` is validated with `@IsIn` over an `as const` array, not a TypeScript `enum`.
- [ ] The env file holds what the application reads, and nothing the local stack needs in another
      shape: those values are derived from it or fixed in the compose file.
- [ ] Every interpolation the local stack derives declares itself required, so the shortcut fails
      with a message.
- [ ] `NODE_ENV` is set by the process, never by an env file.
- [ ] `.env.example` lists every variable the file is the source for — which excludes `NODE_ENV`,
      set by the process — is updated with the validation class, and holds no real secret.
- [ ] Every variable in `.env.example` has a reader: one that is documented, validated and consumed
      by nobody is a promise the application does not keep.
- [ ] No variable the application reads is exported by the developer's shell, where it would
      silently override the file.
- [ ] Every business parameter is in the database, not the environment.
- [ ] The settings reader fails loudly when the document is absent.
- [ ] `NODE_ENV` is only read inside a module factory.
