# frontend-architecture

**Architecture, patterns and code conventions for the React + TypeScript single-page application
stack**, built against a backend that speaks RFC 9457 Problem Details, cookie sessions and paginated
lists.

This is the **core** frontend plugin. It depends only on `engineering-workflow` (see "Requires"), and
everything it documents must produce correct code with nothing else installed.

## What it ships

| Component | How it runs | What it is |
| --- | --- | --- |
| 23 skills | Load themselves when the work matches their triggers | The rules, one owner per concept — the table below |
| `adopt-template` | You run it once: `/frontend-architecture:adopt-template [project-name] "[description]"` | Turns a fresh clone of [`frontend-template`](https://github.com/eatteer/frontend-template) into your project: summarizes what the clone contains, asks for the name and description, rewrites every generic name — package, page title, the application's name in every language, documentation — and verifies the result. It never runs on its own |
| `convention-reviewer` agent | Ask for a review against the conventions, or `@agent-frontend-architecture:convention-reviewer` | A read-only reviewer that loads every skill governing a diff and checks it rule by rule, reporting each violation with file, line, rule and owning skill |

## How it works

The 23 skills auto-invoke off their `description` and `when_to_use` frontmatter — nothing to copy or
wire up. Each one owns a set of rules, and any rule that comes up elsewhere is a pointer rather than
a second copy, so there is never a question of which statement is current.

| Skill | Scope |
| --- | --- |
| `code-conventions` | Universal TypeScript and React rules — forbidden constructs, annotations, absence via `undefined`, effects, blank lines between statements, JSX siblings and hook calls, naming and abbreviations. Applies to every file |
| `project-bootstrap` | Source tree, aliases, compiler strictness, the Vite config, the lint config and the project's own lint rules, scripts, `main.tsx` and the order of its providers |
| `adding-feature` | The folder skeleton and the ordered steps, delegating each one to the skill that owns it |
| `api-client` | Types generated from the OpenAPI document, the one client and its middlewares, `ApiError` from Problem Details, unwrapping the envelope, mappers |
| `server-state` | The query client's defaults, query options factories and their keys, mutations and invalidation, optimistic updates |
| `data-fetching-states` | Pending, error, empty and ready, resolved in order; the altitude a state resolves at; loaders against skeletons in place; skeletons that keep the ready UI's height |
| `error-handling` | Expected failures against bugs, where each surfaces, the error toast and the copyable report, error screens, the fullscreen loader for writes, what a `catch` may end in |
| `forms` | The form as the boundary of controlled values, the schema file, edit forms that mount filled, the backend's field errors on fields, the submit latch, confirmation |
| `routing` | File routes, the router's defaults, `beforeLoad` and loaders in a route's lifecycle, search params validated and reset, route parameter names, code splitting and a chunk that fails to load |
| `pagination` | The backend's list query from the browser, `Paginated<T>`, the sort whitelist, the data table, pagination controls, select and debounced text filters |
| `shadcn` | shadcn's own skill, shipped as shadcn publishes it: the CLI, Base UI's props against Radix's, composing the catalog, semantic colors, variants, `cn`, icons, adding a token |
| `ui-components` | What this architecture decides on top of shadcn's catalog: Base UI only, the whole catalog in `common/ui/` as lint-clean library code, the checks after an update and the local changes it carries forward, where it differs from shadcn's examples, the theme, the Content-Security-Policy |
| `accessibility` | Accessible names, native elements, landmarks, `aria-busy` and `aria-sort`, live regions, focus, the accessibility lint |
| `i18n` | Bundled namespaces, snake_case keys typed from the reference locale, the parity test, plurals per locale, the starting language, the account's language, `x-lang`, `<html lang>` |
| `formatting` | Dates, numbers and money through `Intl`, bound to the language on screen; amounts in minor units without a float |
| `ux-writing` | What the words on screen say: buttons as a verb and its object, sentence case, periods, labels and placeholders, confirmation dialogs, toasts, errors, empty states, progress, one word per concept, the rules each language adds, and what a project decides for itself |
| `authentication` | The cookie session read from the API, the refresh once across tabs, session events, the one place a session ends, sign-in and sign-out, redirect-back |
| `authorization` | The permission catalog, the route, the component and the API as the three places a permission is checked, the forbidden screen |
| `configuration` | Build-time variables, validated once and never secret, the tests' own values, same-site origins |
| `security` | What React escapes and the ways around it, URLs from data, the Content-Security-Policy, dependencies |
| `observability` | The trace every request starts, the error-reporter port and its sources, the Web Vitals port |
| `testing` | Which layer tests what, the shape of a test, the console guard, the network mock, builders, determinism seams, the coverage floor |
| `deployment` | The static image on unprivileged nginx, the API's address as a build argument, the SPA fallback, cache headers, where headers are sent from, checking the image before a release |

## Requires

The **`engineering-workflow`** plugin. It owns the rules every stack shares, and these skills point
at them rather than keeping a copy: `code-conventions` and the `convention-reviewer` agent at
`git-workflow` (the commit format, the integration branch a review diffs against), and
`adding-feature` at `decision-records` (when a choice earns a record).

It is declared in this plugin's `dependencies`, so installing this plugin pulls it in, and it cannot
be disabled while this one is enabled.

## Assumed stack

Node with pnpm, React 19 with the React Compiler, TypeScript in strict mode, Vite, TanStack Router
with file-based routes and TanStack Query, `openapi-fetch` over types generated by
`openapi-typescript`, React Hook Form with Zod, shadcn's components on Base UI with Tailwind,
i18next. Tests with Vitest, Testing Library and MSW.

The backend it assumes answers every failure with Problem Details, keeps the session in HttpOnly
cookies with a refresh that rotates, and wraps a resource in `{ data }` and a list in
`{ data, pagination }`.

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
    "frontend-architecture@architecture-marketplace": true,
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

Patterns and conventions live in the `frontend-architecture` plugin's skills. Each skill's
`description` and `when_to_use` carry its own triggers, so there is no index to maintain here.
Invoke every matching skill before implementing: a change that spans the API client, a screen and
its tests — the common case — needs all of them, not the first one that matched.
```

## No runtime code

This plugin ships no library to depend on. Every artifact the skills describe — the client and its
middlewares, `ApiError`, the query options type, the error toast, the field-error helper — is written
in the project that installs it. The skills say what shape those take and why.

Beside its `SKILL.md`, a skill may carry files it points at, and each says what it is for:

| Kind | What it is | Where |
| --- | --- | --- |
| Examples | A complete create form and its schema file, read before writing a form | `forms` |
| References | The naming and file-suffix tables, read before naming something | `code-conventions` |
| Assets | Files copied into a project — the project's own lint rules, for the hook calls that open a component and for one-line statements of different kinds, with their type declarations; the `Dockerfile`, `nginx.conf` and `.dockerignore` | `project-bootstrap`, `deployment` |

## What this plugin leaves open

Deliberate non-decisions, because they vary per project and the skills give the criteria rather than
the answer:

- **The backend's framework.** Only its contract is assumed — the envelope, Problem Details, the
  cookie session — not what serves it.
- **The design.** The skills fix how the component catalog is used, not what the product looks like.
- **Continuous integration.** The scripts a pipeline needs exist under stable names; the pipeline is
  the project's.

## Quality checks

Every change to this plugin passes Claude Code's own manifest validator and a lint of every
TypeScript and TSX snippet and example against the conventions the skills teach — with the same
local lint rules the project copies from `project-bootstrap`. Its [`evals/`](evals/) suite, run
with `claude plugin eval`, checks that each skill loads for a realistic request that does not name
it, that unrelated requests load none, that `adopt-template` never runs on its own, and that the
reviewer finds planted violations. How to run them is in the marketplace's contributing notes.

## License

[MIT](LICENSE). The `shadcn` skill is shadcn's, under its own MIT license, which ships beside it.
