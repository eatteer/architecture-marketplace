---
name: adding-feature
description: "The folder skeleton of a front-end feature and the order to build it in — which file comes first, which skill owns each step, what a feature may import from another, what changes outside its folder, and the checklist that catches what gets forgotten. This skill is the index; every step's pattern lives in the skill it names."
when_to_use: "Trigger on — adding a feature or a screen, building a list, detail, create or edit flow for a new resource, scaffolding a feature from scratch, building the screens for a resource the backend added, asking where a file goes inside a feature folder, a feature importing another feature's components, two features importing each other, asking what changes outside the feature folder, or asking what is left to finish a feature."
---

# Adding a feature

A feature is a vertical slice of the application: it owns its reads and writes, its model, its
screens and its forms, and what changes outside its folder is short and known — its route files, a
translation file per locale, the navigation entry that leads to it, and its end-to-end spec.

```text
src/features/<feature>/
├── api/          <entity>-queries.ts, <entity>-mutations.ts, <entity>.mapper.ts,
│                 hooks and route guards over the feature's own reads
├── model/        <entity>.ts — the model, its catalogs, pure functions over it
├── schemas/      <form>.schema.ts, <list>-search.schema.ts
├── components/   the pieces, each with its skeleton beside it; the forms
└── pages/        <screen>-page.tsx — what a route renders
src/routes/       the feature's route files
src/locales/<language>/<feature>.json
```

Only what the feature needs. A feature with no form has no `schemas/` for it, and one that reads
nothing has no `api/`; an empty folder is a promise nobody kept. Tests sit beside what they test, and
a test of the feature's screens through its routes at the feature's root (see `testing`).

## Order

Build from the contract outward. Each step depends only on the ones above it, so nothing is written
against a shape that has not been decided.

| # | Step | Skill |
| --- | --- | --- |
| 1 | Regenerate the API's types, if the backend changed | `api-client` |
| 2 | The model: its type, the catalogs taken from the generated types, pure functions over it | `api-client`, `code-conventions` |
| 3 | The mapper from each DTO to the model | `api-client` |
| 4 | The query options factory | `server-state`, `pagination` |
| 5 | The mutation hooks, and what each invalidates | `server-state` |
| 6 | The search-params schema of each list | `routing`, `pagination` |
| 7 | The components, each with its skeleton, and the table of a list | `data-fetching-states`, `ui-components`, `pagination`, `accessibility` |
| 8 | The forms and their schema files | `forms` |
| 9 | The pages, resolving each read's states | `data-fetching-states`, `error-handling` |
| 10 | The route files: guards, loaders, search validation | `routing`, `authorization` |
| 11 | The navigation entry, shown only to who may open it | `authorization` |
| 12 | Its namespace, in every locale, registered with the translation types | `i18n` |
| 13 | Component tests with the network mocked, beside each artifact; an end-to-end spec for the flow that crosses the backend | `testing` |

Steps 2 to 5 render nothing. That is the point of the order: the model and the cache are decided and
tested before a screen makes them expensive to change.

## Before starting

- **Is this a feature, or a screen of an existing one?** A new folder for what is really another view
  of an existing resource splits one concept across two places. A feature has its own resource or
  its own flow.
- **Does the backend already serve it?** The generated types say what exists; a screen written
  against an endpoint that does not exist yet is written against a guess.
- **What does it need from other features?** A feature may read another's `api/` and `model/` — its
  queries, its session hooks, its types. It never imports another's `components/` or `pages/`: a
  route composes them, passing one feature's component to another's layout as a prop. Two features
  that import each other mean a concept is in the wrong one.
- **Does anything already exist for this?** Grep before inventing — a formatter, a shared component,
  a hook in `common/`. A second date formatter is worse than none.

## Checklist

Verified against the code in front of you, not recalled.

- [ ] Every folder that exists has something in it.
- [ ] No component imports the generated schema; the mapper returns the model.
- [ ] Every catalog the backend owns comes from the generated types, as one array and its union.
- [ ] Every read goes through the feature's options factory, and every write invalidates what it
      changed.
- [ ] Every read resolves its states, and every component that loads has a skeleton beside it.
- [ ] Every form declares all its fields, converts in its schema, and places the backend's field
      errors.
- [ ] Every route validates its search params and requires its permissions before it loads anything.
- [ ] Every button, link and navigation entry that needs a permission is hidden without it.
- [ ] The feature's namespace exists in every locale, with the same keys, and is registered.
- [ ] Nothing in the feature imports another feature's components or pages, and nothing in `common/`
      imports the feature.
- [ ] Every screen has component tests, and the flow that crosses the backend has an end-to-end spec.
- [ ] A decision the feature made that the next person would have to reconstruct has a record (see
      `engineering-workflow:decision-records`).
