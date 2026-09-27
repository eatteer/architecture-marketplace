# backend-architecture

**Architecture, patterns and code conventions for the NestJS + TypeScript + MongoDB backend stack**,
following Clean Architecture and Domain-Driven Design.

This is the **core** backend plugin. It depends only on `engineering-workflow` (see "Requires"), and
everything it documents must produce correct code with nothing else installed.

## What it ships

| Component | How it runs | What it is |
| --- | --- | --- |
| 25 skills | Load themselves when the work matches their triggers | The rules, one owner per concept — the table below |
| `adopt-template` | You run it once: `/backend-architecture:adopt-template [project-name] "[description]"` | Turns a fresh clone of [`backend-template`](https://github.com/eatteer/backend-template) into your project: summarizes what the clone contains, asks for the name and description, rewrites every generic name — package, database, bucket, containers, documentation title — and verifies the result. It never runs on its own |
| `convention-reviewer` agent | Ask for a review against the conventions, or `@agent-backend-architecture:convention-reviewer` | A read-only reviewer that loads every skill governing a diff and checks it rule by rule, reporting each violation with file, line, rule and owning skill |

## How it works

The 25 skills auto-invoke off their `description` and `when_to_use` frontmatter — nothing to copy or
wire up. Each one owns a set of rules, and any rule that comes up elsewhere is a pointer rather than
a second copy, so there is never a question of which statement is current.

| Skill | Scope |
| --- | --- |
| `code-conventions` | Universal TypeScript/NestJS rules — forbidden constructs, explicit annotations, absence via `undefined`, naming. Applies to every file |
| `project-bootstrap` | Source tree, `@/` alias, compiler strictness, scripts, `main.ts` and the order its steps must run in |
| `module-wiring` | Modules, DI tokens, exports discipline, `@Global()` policy, per-environment providers, breaking cycles |
| `adding-feature` | The folder skeleton and the ordered steps, delegating each one to the skill that owns it |
| `domain-modeling` | Entities, aggregates, value objects, events, errors, repository interfaces, `?` vs `null` |
| `money` | `Money` as integer minor units with its currency, explicit rounding, allocation, Int64 storage, string on the wire |
| `application-layer` | Use cases, commands, policies, ports, throw-or-return, batch orchestration |
| `persistence-layer` | Schemas, indexes, mappers, repository implementations, soft delete, transaction concerns, migrations with `migrate-mongo` |
| `presentation-layer` | Controllers, DTOs, the success envelope, URI versioning, status codes, dates on the wire, guard composition, `?include=` |
| `api-documentation` | The generated OpenAPI document — every `@Api*` decorator lives here |
| `pagination` | `ListQuery`, `Paginated<T>`, sorting and tiebreakers, offset vs cursor, denormalizing for a filter |
| `transactions-and-consistency` | Why a transaction is not a lock, retry-safe callbacks, idempotency, eventual consistency |
| `event-driven` | Publish timing, handlers, the in-process bus and when it stops being enough |
| `background-jobs` | Schedulers across replicas, locks, retries, dead letters, reconciliation sweeps |
| `external-integrations` | Provider adapters, timeouts, circuit breaking, inbound webhooks, simulators |
| `audit-log` | The trail, the actor, the `changes` convention, and erasure against an append-only record |
| `i18n` | Translation layout, request language, recipient language, validator messages |
| `error-handling` | Domain error → HTTP mapping provided per module, the Problem Details filter, what a `catch` may end in |
| `observability` | Structured logs, level policy, W3C trace id, OpenTelemetry, request context, health checks, shutdown |
| `deployment` | The multi-stage image, the signal, one image for every deploy command, migrations as a gated step |
| `authentication` | Password hashing, tokens, cookie and bearer transports, refresh rotation, revocation |
| `authorization` | Permission catalog, roles, guards, and resource-level access |
| `security` | Input hardening, uploads, rate limiting, CSRF, CORS, secrets, personal data |
| `configuration` | Validated environment variables with no defaults, and operator-editable settings |
| `testing` | Test boundaries, doubling ports, builders, determinism seams, the in-memory replica set, the e2e database, the coverage floor |

## Requires

The **`engineering-workflow`** plugin. It owns the rules every stack shares, and these skills point
at them rather than keeping a copy: `code-conventions` and the `convention-reviewer` agent at
`git-workflow` (the commit format, the integration branch a review diffs against), and
`adding-feature` and `persistence-layer` at `decision-records` (when a choice earns a record).

It is declared in this plugin's `dependencies`, so installing this plugin pulls it in, and it cannot
be disabled while this one is enabled.

## Assumed stack

NestJS, TypeScript, MongoDB with Mongoose, class-validator and class-transformer, `@nestjs/config`,
`@nestjs/swagger`, `@nestjs/throttler`, `@nestjs/terminus`, a translation library, `migrate-mongo`
for migrations, and OpenTelemetry for tracing and metrics. Tests with Jest, the integration suite
against `mongodb-memory-server`.

Transactions assume MongoDB running as a replica set — a standalone instance rejects them, which the
`project-bootstrap` skill covers for local development.

Two things are project decisions the skills name rather than make: the actor-type catalog the audit
trail uses, and whether a revoked permission takes effect immediately or at the next token.

## Add this to the consuming project

**So every contributor gets the plugin**, commit this as `.claude/settings.json`. Claude Code offers
the marketplace and enables the plugin when someone trusts the folder, with nothing to install by
hand. `engineering-workflow` is listed too: a plugin enabled from settings does not enable the plugin
it depends on, and without it this one fails to load and no skill reaches the session:

```json
{
  "skillListingBudgetFraction": 0.04,
  "extraKnownMarketplaces": {
    "architecture-marketplace": {
      "source": { "source": "github", "repo": "eatteer/architecture-marketplace" },
      "autoUpdate": true
    }
  },
  "enabledPlugins": {
    "backend-architecture@architecture-marketplace": true,
    "engineering-workflow@architecture-marketplace": true
  }
}
```

`autoUpdate` refreshes the marketplace when Claude Code starts, so a new release of the plugin
reaches every contributor without anyone running an update.

`skillListingBudgetFraction` is the share of the context window, in characters, that the list of
skills Claude reads every turn may take. The default, 1%, is 8,000 characters in a 200k window, and
this plugin's skills and their triggers alone take about 28,000: past the budget a skill is listed
by its name only, and a name is a much weaker trigger than its description. 4% fits them in a 200k
window, at about 8,000 tokens a turn.

**The plugin ships skills, not a `CLAUDE.md`.** Put this in the project's own so nothing has to be
remembered:

```markdown
## Source of truth

Patterns and conventions live in the `backend-architecture` plugin's skills. Each skill's
`description` and `when_to_use` carry its own triggers, so there is no index to maintain here.
Invoke every matching skill before implementing: a change that spans layers — the common case —
needs all of them, not the first one that matched.
```

## No runtime code

This plugin ships no library to depend on. Every artifact the skills describe — `AggregateRoot`,
`Paginated<T>`, the response builder, the transaction manager, the guards — is written in the
project that installs it. The skills say what shape those take and why.

Beside its `SKILL.md`, a skill may carry files it points at, and each says what it is for:

| Kind | What it is | Where |
| --- | --- | --- |
| Examples | Complete `.ts` files for the canonical shapes — an entity and the shared base classes, a use case, a schema, a repository, a migration, a controller — read when writing one | `domain-modeling`, `application-layer`, `persistence-layer`, `presentation-layer` |
| References | Lookup tables and recipes read on demand — the naming and suffix tables, the concurrency guard | `code-conventions`, `transactions-and-consistency` |
| Scripts | Two programs run against a project, on its own `typescript`, that report and only write with `--write`: convert type-only imports in decorated files, and remove local annotations the compiler would infer | `code-conventions` |
| Assets | Files copied into a project — the `Dockerfile` and `.dockerignore`, the database service of the local compose file | `deployment`, `project-bootstrap` |

## What this plugin leaves open

Deliberate non-decisions, because they vary per project and the skills give the criteria rather than
the answer:

- **The persistence engine beyond MongoDB.** The layering holds for any store, but the schema, index
  and transaction rules are written against MongoDB's semantics.
- **The message transport.** `event-driven` covers the in-process bus and states exactly when an
  outbox is needed; which broker implements it is not decided here.
- **The reporting and metrics destination.** `observability` defines structured output on stdout,
  what each level means, and traces and metrics exported over OTLP to a collector; where the lines
  are collected, and which backend the collector feeds, is the platform's concern.
- **The deployment platform.** `deployment` states what the image must be for any platform to run it
  correctly; which orchestrator runs it, and how its probes and grace period are set, is the
  project's.
- **Continuous integration and the supply chain.** No skill prescribes a pipeline, a dependency bot
  or secret scanning. `deployment` covers installing production dependencies without lifecycle
  scripts; the rest is the project's to decide.

## Quality checks

Every change to this plugin passes Claude Code's own manifest validator and a lint of every
TypeScript snippet and example against the conventions the skills teach. Its [`evals/`](evals/)
suite, run with `claude plugin eval`, checks that each skill loads for a realistic request that does
not name it, that unrelated requests load none, that `adopt-template` never runs on its own, and
that the reviewer finds planted violations. How to run them is in the marketplace's contributing
notes.

## License

[MIT](LICENSE).
