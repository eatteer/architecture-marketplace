---
name: adding-feature
description: "The folder skeleton of a feature and the order to build it in — which artifact comes first, which skill owns each step, and the checklist that catches what gets forgotten. This skill is the index; every step's pattern lives in the skill it names."
when_to_use: "Trigger on — adding a feature or module, adding an endpoint or a resource, building CRUD for something new, scaffolding a feature from scratch, wiring a feature into the application, asking where a file goes inside a feature folder, asking what changes outside the feature folder, or asking what is left to finish a feature."
---

# Adding a feature

A feature is a vertical slice: it owns its four layers, and what changes outside its folder is short
and known — the root module that imports it, the translation file of every locale, a migration when
the feature changes data that already exists, and a decision record when it made a decision the next
person would have to reconstruct.

```text
src/features/<feature>/
├── domain/
│   ├── entities/            <entity>.entity.ts
│   ├── value-objects/       <concept>.ts
│   ├── events/              <entity>.events.ts
│   ├── repositories/        <feature>.repository.ts
│   └── <feature>.errors.ts
├── application/
│   ├── commands/            <action>-<entity>.command.ts
│   ├── policies/            <rule>.policy.ts
│   ├── ports/               <capability>.interface.ts
│   ├── results/             <outcome>.result.ts
│   └── use-cases/           <action>-<entity>.usecase.ts
├── infrastructure/
│   ├── events/              <feature>-events.handlers.ts
│   ├── jobs/                <feature>-jobs.ts
│   ├── notifications/       <technology>-<entity>-notifier.ts, templates/
│   └── persistence/mongodb/
│       ├── schemas/         <entity>.schema.ts
│       ├── mappers/         <entity>.persistence-mapper.ts
│       └── repositories/    <feature>-mongo.repository.ts
├── presentation/
│   ├── controllers/         <feature>.controller.ts
│   ├── dtos/                <action>-<entity>.dto.ts, <entity>.dto.ts
│   ├── mappers/             <entity>.presentation-mapper.ts
│   └── <feature>.errors-map.ts
└── <feature>.module.ts
```

Only what the feature needs. A feature with no policy has no `policies/` folder, and one with
nothing scheduled has no `jobs/`; an empty folder is a promise nobody kept.

## Order

Build inward-out. Each step depends only on the ones above it, so nothing is written twice and
nothing is written against a shape that has not been decided.

| # | Step | Skill |
| --- | --- | --- |
| 1 | Value objects, including the value unions the entity's fields use, and `Money` for any amount | `domain-modeling`, `money` |
| 2 | The entity or aggregate root, its factories, its business methods | `domain-modeling` |
| 3 | The entity's audit actions and the entries its methods append | `audit-log` |
| 4 | Its domain events | `domain-modeling` |
| 5 | Its domain errors | `domain-modeling` |
| 6 | The repository interface, its token, its query type and sort whitelist | `domain-modeling`, `pagination` |
| 7 | Commands, and policies for rules that need more than the aggregate | `application-layer` |
| 8 | Use cases | `application-layer`, `transactions-and-consistency` |
| 9 | The schema and its indexes | `persistence-layer` |
| 10 | The persistence mapper | `persistence-layer` |
| 11 | The repository implementation | `persistence-layer`, `pagination` |
| 12 | A migration, when the feature changes data that already exists | `persistence-layer` |
| 13 | Request, query and response DTOs | `presentation-layer`, `api-documentation` |
| 14 | The presentation mapper | `presentation-layer` |
| 15 | The controller under `/api/v1`, its guards and its permissions | `presentation-layer`, `authorization` |
| 16 | The errors map — each domain error to its status, provided with `provideDomainErrorStatuses` | `error-handling` |
| 17 | Event handlers, if something elsewhere must react | `event-driven` |
| 18 | The module, and its registration in the root module | `module-wiring` |
| 19 | Translations for errors, validators and labels | `i18n` |
| 20 | Tests, alongside each artifact rather than at the end | `testing` |

Steps 1 to 8 need no database and no HTTP. That is the point of the order: the rules are decided,
written and tested before anything makes them hard to change.

## Before starting

- **Is this a feature, or does it belong to an existing one?** A new folder for something that is a
  behavior of an existing aggregate splits one concept across two places. The question to ask is
  whether it has its own identity and its own lifecycle.
- **What does it need from other features?** Reading across the boundary is fine; changing another
  aggregate goes through its use case, and a mutual dependency means a concept is missing (see
  `application-layer` and `module-wiring`).
- **Does anything already exist for this?** Grep before inventing — a value object, an error, a
  policy. A second `Email` is worse than no `Email`.

## Checklist

Verified against the code in front of you, not recalled.

- [ ] Every folder that exists has something in it.
- [ ] Nothing in `domain/` imports the framework, the driver, or another layer.
- [ ] Every entity method that changes state satisfies the `domain-modeling` rule for a state
      change, including its one exception.
- [ ] Every constrained entity parameter is a value object.
- [ ] Every enumerable concept has exactly one `as const` array, and its union is derived from it.
- [ ] The schema has an index for every query the repository runs, and every unique index is partial
      on `deletedAt: null`.
- [ ] Every read filters out soft-deleted records.
- [ ] Every repository method that joins a unit of work takes a `transaction` as its last parameter.
- [ ] Every use case has one public `execute`, and events are drained and published after the
      transaction commits (see `event-driven`).
- [ ] No endpoint returns an entity, every success goes through the shared response builders, and a
      command with no result answers 204.
- [ ] Every endpoint through which a caller acts on their own record checks ownership after loading
      it (see `authorization`).
- [ ] Every route declares its required permissions, or is explicitly public.
- [ ] Every DTO property carries its validator and its documentation decorator.
- [ ] Every domain error has a map entry and a key in every locale, and the module provides its
      list with `provideDomainErrorStatuses`.
- [ ] The module exports only tokens and use cases, and the root module imports it.
- [ ] Value objects, entity invariants, policies, use cases and mappers each have tests, and each
      repository query has an integration test.
- [ ] A decision the feature made that the next person would have to reconstruct has a record (see
      `decision-records`).
