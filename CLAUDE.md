# architecture-marketplace

A Claude Code plugin marketplace. See [README.md](README.md) for what each plugin covers and how
projects install them.

This file holds the rules for **maintaining the marketplace itself** — not the conventions it
distributes, which live in the skills.

## What ships and what does not

A plugin distributes its whole directory: every skill with its supporting files, its `agents/`, its
`evals/` suite, its README and its LICENSE. Only skills and agents reach a session's context; the
rest is carried along. It does **not** distribute this file: a `CLAUDE.md` here is loaded only when
someone is working inside this repository, which is exactly what it is for.

New components are skills. `commands/` is Claude Code's legacy format for the same thing: a skill in
its own folder takes supporting files and the full frontmatter, a command file takes neither.

So nothing a consuming project needs to know may live here. The four layers, the dependency
direction, the folder skeleton — all of it belongs in a skill, or the projects that install the
plugin never see it. The test before writing a paragraph here: *is this instruction for whoever
edits the marketplace, or for whoever uses it?* Only the first kind stays.

A consuming project still wants a short `CLAUDE.md` of its own pointing at the skills. The plugin's
README carries it as a snippet to copy.

Everything outside `plugins/` — this file, the root `package.json`, `tools/`, `.githooks/` — is
maintenance tooling for this repository and never reaches a project.

## Supporting files inside a skill

A skill's folder ships whole, so anything beside `SKILL.md` reaches every project. Four folders,
each with one job:

| Folder | Holds | The `SKILL.md` says |
| --- | --- | --- |
| `references/` | Markdown consulted now and then: a lookup table, a recipe written only when a rule first needs it | when to read it |
| `examples/` | Real `.ts` or `.tsx` files for the long canonical snippets: a complete entity, use case, repository, controller, schema, form | when to read it |
| `scripts/` | A program the model **runs**, never reads — only its output costs context | that it is run, the command with `${CLAUDE_SKILL_DIR}`, and what to do after |
| `assets/` | A file a project **copies** as its starting point: a template, a `Dockerfile` | that it is copied, and where to |

- **`SKILL.md` stays in context for the rest of the session once loaded, and every line is a cost
  that repeats.** Keep it under 500 lines. Past that, move detail out — never a rule. The rules stay
  in `SKILL.md`; what moves is the long illustration, the lookup table, the recipe.
- **A snippet that illustrates one rule stays inline**, next to the rule. Moving it costs a read to
  save a few lines; only the long, canonical shape earns an `examples/` file.
- **Every supporting file is linked directly from `SKILL.md`**, with a sentence saying when to read,
  run or copy it. One level deep: a reference never sends the reader to another reference, because
  a model following nested links may read the second one only in part. A reference over 100 lines
  opens with an index of its sections.
- **Every rule in this file applies to them too.** One owner per concept: a reference is part of its
  skill, not a second copy of another skill's rule. No inventories, no project paths in prose, no
  business vocabulary, current state only. The conventions bind an example exactly as they bind a
  snippet.
- **A script is one of the skill's own files, not a dependency.** It resolves the project's own
  packages from the directory it runs in, writes nothing without an explicit flag, and says so in
  its header. Name it `.cjs` when it uses `require`, so a project whose `package.json` declares ESM
  still runs it.
- File names are descriptive (`naming-tables.md`, `users-mongo.repository.ts`) and paths use `/`.

## Bump `version` on every change

Whenever you change anything inside `plugins/<name>/` — a skill, the README, the manifest — bump
that plugin's `version` in `plugins/<name>/.claude-plugin/plugin.json`, in the same commit.

This is not bookkeeping. Claude Code resolves a plugin's identity as `plugin.json` version →
marketplace entry version → git commit SHA, and this repo sets the first, so it always wins. A
project only picks up new content when the resolved version **differs** from what it cached: push a
changed skill without a bump and every project that already installed the plugin keeps serving the
old copy, silently and indefinitely.

- Bump only the plugin(s) that actually changed.
- Patch for wording that does not change the documented pattern; minor for a new or materially
  changed pattern; major when a change invalidates something a project built against.
- Never set `version` in `.claude-plugin/marketplace.json` — `plugin.json` wins silently, so a value
  there is dead weight that misleads the next reader.

## Naming

Plugin names carry a stack prefix (`backend-*`, `frontend-*`). One marketplace hosts every stack,
and the bump rule is per plugin, so a backend release is already invisible to frontend projects.

A plugin that serves every stack carries **no** prefix (`engineering-workflow`). A prefix would claim
a stack it does not belong to, and the stack plugins that depend on it would read as depending on
each other.

Skill `name`s carry **no** prefix. Claude Code addresses them as `plugin:skill`
(`backend-architecture:code-conventions`), so they are already namespaced. A skill's `name` matches
its directory name.

## Dependencies between plugins

A rule every stack shares lives in a plugin without a stack, and each stack plugin declares it for
real, in its `plugin.json`:

```json
"dependencies": ["engineering-workflow"]
```

Installing the stack plugin with `claude plugin install` then pulls the shared one in, and disabling
the shared one is refused while a plugin that depends on it is enabled — which is what makes a
pointer into it safe. Enabling it from a project's `enabledPlugins` does not pull anything in: the
stack plugin fails to load (`Dependency … is not installed`) and no skill reaches the session, so
the settings snippet in a stack plugin's README lists the shared plugin beside it. The entry is a
**bare name on purpose**: a version range resolves against git tags (`engineering-workflow--v1.0.0`),
so adding one without tagging every release fails the dependent plugin with `no-matching-tag`.

- **References point along the dependency, never against it.** A stack plugin names the shared
  plugin's skills as much as it needs; the shared plugin never names a skill, file or concept that
  exists only in one stack. Two stack plugins never reference each other.
- **A pointer into another plugin carries its namespace**: `engineering-workflow:git-workflow`, not
  `git-workflow`. The bare name is a skill of the plugin the reader is in.
- **The prose agrees with the manifest**: the plugin's entry `description` in `marketplace.json`,
  the `description` in its `plugin.json`, and a `## Requires` section in its README — which names
  what the plugin points at, or says "Nothing" for a plugin with no dependencies.

## One concept, one owner

Every rule is developed in exactly one skill. Anywhere else it comes up, it is a single sentence
with a pointer (see the `persistence-layer` skill), never a restatement.

Two copies of a rule means one of them is stale, and nothing at read time says which. The reader has
no way to tell — so a rule restated elsewhere is a defect in both files, not redundancy.

Before adding a rule, find its owner in the map below. If no row fits, that is the map telling you
it needs a new row — not that the rule may go wherever you happen to be editing.

### Ownership map — `backend-architecture`

| Concept | Owner |
| --- | --- |
| Universal code style, naming and file suffixes, forbidden constructs | `code-conventions` |
| Repo layout, `main.ts`, the shared request pipeline, build output, tooling config, the package manager and its install settings, the local stack | `project-bootstrap` |
| Module graph, DI tokens, `providers`/`exports`, cycles, binding a different implementation per environment | `module-wiring` |
| Ordered steps to build a feature, and its checklist | `adding-feature` |
| Entities, value objects, domain events, domain errors, repository interfaces, `?` vs `null` | `domain-modeling` |
| Monetary amounts: minor units, currency, rounding, allocation, storage, wire format, display | `money` |
| Use cases, commands, results, policies, ports, batch orchestration | `application-layer` |
| Schemas, indexes, persistence mappers, repository implementations, soft delete, the transaction manager's concerns, migrations | `persistence-layer` |
| Controllers, DTOs, presentation mappers, the success envelope, API versioning, dates on the wire | `presentation-layer` |
| `@Api*` decorators, tag groups, security schemes in the spec | `api-documentation` |
| `ListQuery`, `Paginated<T>`, filters, sorting, denormalization for querying | `pagination` |
| Transactions, write conflicts, idempotency, atomicity boundary, eventual consistency | `transactions-and-consistency` |
| Event bus, handlers, publish timing, event versioning | `event-driven` |
| Schedulers, locks across replicas, queues, retries, dead letters | `background-jobs` |
| Outbound HTTP, provider adapters, inbound webhooks | `external-integrations` |
| Simulators: when one is warranted at all, and how it must behave | `external-integrations` |
| The audit trail entity, `Actor`, the `changes` convention | `audit-log` |
| Translation files, language resolution, recipient language | `i18n` |
| Domain error → HTTP mapping, the global filter and the Problem Details body, `catch` discipline | `error-handling` |
| Log levels and shape, the W3C trace id, OpenTelemetry tracing and metrics, health checks, graceful shutdown, masking, naming a dependency at boot | `observability` |
| The deployable image, the process that receives the signal, the commands a deploy runs and their order | `deployment` |
| Login, password hashing, token issuance, token transport, refresh, revocation | `authentication` |
| Permission catalog, roles, permission guards, resource-level access, operator endpoints behind a key | `authorization` |
| Input hardening, regex escaping, uploads, CSRF, CORS, rate limiting, the proxy hop count, secrets, PII | `security` |
| Environment variables, startup validation, typed settings values for the application layer, operator-editable settings | `configuration` |
| Test boundaries, the shape of a test, test doubles, builders, determinism seams | `testing` |
| Turning a fresh clone of the reference project into a project: the rename it needs | `adopt-template` |

### Ownership map — `engineering-workflow`

| Concept | Owner |
| --- | --- |
| Branch naming, branch flow, commit messages | `git-workflow` |
| Architecture decision records: which decisions earn one, format, numbering, superseding | `decision-records` |

### Ownership map — `frontend-architecture`

| Concept | Owner |
| --- | --- |
| Universal TypeScript and TSX style, naming and file suffixes, forbidden constructs, blank lines between statements, JSX siblings and hook calls, props typing, memoization under the compiler, effects | `code-conventions` |
| Repo layout, `main.tsx` and the order of its providers, the aliases, compiler strictness, the package manager and its install settings, the bundler and test runner config, the lint config and the project's own lint rules, scripts, the hook | `project-bootstrap` |
| Ordered steps to build a feature, its folder skeleton, and its checklist | `adding-feature` |
| The API's generated types, the one HTTP client and the headers its middlewares attach, unwrapping the envelope and a page, `ApiError` built from Problem Details | `api-client` |
| Query options factories, hierarchical keys, mutations and what they invalidate, cache policy, retry, the registered error type and `meta`, optimistic updates | `server-state` |
| The four states of a read, skeletons, the altitude a state resolves at, a route loader with a suspense query as the alternative to a skeleton in place, disabled queries, the page on screen while the next one loads | `data-fetching-states` |
| Classifying a failure, which failures toast and how the toast behaves, the copyable error report, error screens and a route's error component, the fullscreen loader for writes, what a `catch` may end in | `error-handling` |
| Form libraries and schemas, the form as the boundary of controlled values, the backend's field errors placed on fields, the submit latch, confirmation before an irreversible write, wiring a field's label, description and error | `forms` |
| File routes, `beforeLoad` and loaders in the route lifecycle, validated search params, resetting the page on a filter change, route parameter names, not-found, code splitting and a chunk that fails to load, page transitions and the type every view transition declares | `routing` |
| The backend's list query from the browser, `Paginated<T>`, the sort whitelist, the data table, text filters debounced into the URL | `pagination` |
| Using shadcn's catalog: the CLI, Base UI's props against Radix's, composition, semantic colors, variants, class merging, icons, adding a token | `shadcn` |
| Base UI as the only headless library, the whole catalog as lint-clean library code, the checks after an update and the local changes it carries forward, where the architecture differs from shadcn's examples, an overlay closing, the dialog's scrolling frame, the theme, the scrollbar's gutter | `ui-components` |
| Accessible names, focus, live regions, keyboard support, `aria-busy`, the accessibility lint | `accessibility` |
| Translation namespaces and files, typed keys, key casing, locale parity, plurals per locale, the language the backend is asked for, the document's `lang` | `i18n` |
| Dates, numbers and money on screen | `formatting` |
| The wording of what is on screen: button labels, casing, punctuation, labels and placeholders, the words of dialogs, toasts, errors, empty states and progress, one word per concept, per-language writing rules | `ux-writing` |
| The cookie session, reading it from the API, refresh once across tabs, session events between tabs, sign-in and sign-out, clearing the cache, redirect-back and which targets it follows | `authentication` |
| Permissions from the session, gating a route, a query and a component, forbidden against not found | `authorization` |
| Build-time variables, their validation, nothing secret in the bundle | `configuration` |
| Cross-site scripting, raw HTML, untrusted URLs rendered as links, the Content-Security-Policy, dependencies | `security` |
| The W3C trace context the browser starts and where its id ends up, the error-reporter port, Web Vitals | `observability` |
| Test boundaries, the shape of a test, the console guard, the network mock, builders, the coverage floor | `testing` |
| The static image, the SPA fallback, cache headers, where the security headers are sent from, checking the served image before a release | `deployment` |
| Turning a fresh clone of the reference project into a project: the rename it needs | `adopt-template` |

## A skill shipped as its publisher wrote it

`frontend-architecture`'s `shadcn` skill is shadcn's, copied from `shadcn-ui/ui` by
`npm run sync:shadcn` and never edited here. Every edit would be undone by the next sync, so the rest
of this file binds it only through the skills around it:

- **It owns what its body covers**, and a skill of ours points at it rather than restating it.
  What this architecture decides differently lives in `ui-components`, which says it wins.
- **Its trigger is shadcn's.** Ours stay disjoint from it, so the trigger that moves is ours.
- **The snippet check leaves it out.** Its snippets follow shadcn's conventions; the project's lint
  and the reviewer hold the code a model writes from them.
- **A sync is a change like any other**: review the diff against what `ui-components` overrides,
  bump the version, run the `shadcn` and `ui-components` eval cases, and name the upstream commit the
  script printed in the message.

## A skill's `description` and `when_to_use` are its trigger

Skills auto-invoke off two frontmatter fields, so both are functional text, not a summary. When a
pattern moves or changes, update the skill body **and** its trigger keywords in the same commit — a
body-only edit leaves the skill correct but unreachable.

```yaml
description: "<what it covers, em-dash-separated noun phrases>."
when_to_use: "Trigger on — <concrete actions, filenames, symbols, and symptoms>."
```

Claude Code lists the two together and **truncates the pair at 1,536 characters**; a truncated
trigger is a skill that never loads for whatever was cut. Keep `description` under 1,024 on its own
— the limit of the open skill format — and put the key use case first in each.

A skill a person runs on purpose, whose effects nobody should get by surprise — rewriting names
across a repository — sets `disable-model-invocation: true`, and its `description` says what running
it does rather than when to load it.

**Include symptoms, not just actions.** A trigger list of filenames only reaches the skill while
someone is authoring. Symptoms — "a duplicate row under concurrent requests", "a transaction that
commits partially", "events lost on a retry" — are what make it reachable while someone is
debugging, which is when it is needed most.

**Triggers must be disjoint.** Before a description is done, check it against the others: if one
action is claimed by two skills, the model picks by coin flip and the loser's rules never load.
Either the action belongs to one of them, or the concept itself is split in the wrong place.

**The eval suite is how a trigger is proven, not argued.** `plugins/<name>/evals/` holds one case
per skill — a realistic request that does not name it, graded on whether that skill loaded — plus
requests that must load nothing, and one per skill that must never run on its own. Adding a skill
adds its case; changing a trigger re-runs the suite before the commit. See "Running the evals"
below.

## Agents apply skills, they never own a rule

An agent in `agents/` is a procedure — what to read, which skills to load, how to report. Every rule
it enforces is loaded from the skill that owns it, never written into the agent, so the agent cannot
drift from the skills. It lists the tools it needs and nothing more: a reviewer's `tools` has no
`Write` or `Edit`, and the `Bash` it keeps for `git` is bounded by its instructions — `tools` is an
allowlist, so a `disallowedTools` beside it would only repeat it. A skill it preloads through
`skills:` is named with the plugin's namespace (`backend-architecture:code-conventions`); the bare
name loads nothing, silently. Preload only what binds every task the agent does — each preloaded
skill is its full text in the agent's context.

## Running the evals

```bash
cd plugins/<name>
claude plugin eval . --ablation none --trust-plugin -j 4 --allow-tools Agent
```

Each plugin's suite runs from its own folder. A skill moved to another plugin takes its case with it,
and the grader's `input_match` changes to the new namespace.

`--ablation none` skips the no-plugin comparison: a trigger case asks whether the plugin's skill
loaded, which a run without the plugin cannot answer, so the second arm would double the cost for
nothing. `--case '<glob>'` runs a subset — the cases of the skills a change touched. Every run is a
real model call on the account running it, and the command prints its list-price estimate; the whole
suite is a few dollars' worth. Results land in `evals/results/`, which git ignores.

Run it after changing any `description` or `when_to_use`, after adding or renaming a skill or an
agent, and when a new model becomes the default. A case that fails is a finding about the trigger,
not the case: rephrase the trigger until a realistic request reaches it, never the request until it
reaches the trigger.

### A plugin with `dependencies`

`claude plugin eval <path>` cannot resolve a dependency: the sandbox has no marketplace to fetch it
from, so the plugin under test is left out of the session **without an error**, and every trigger
case scores 0 for a reason that has nothing to do with the trigger. The run's trace shows it — the
`init` event lists no plugin but the built-in ones.

Until the command can load a dependency, run the suite with the entry removed and put the manifest
back straight after:

```bash
cd plugins/<name>
cp .claude-plugin/plugin.json .claude-plugin/plugin.json.bak
node -e "const f='.claude-plugin/plugin.json',m=require('./'+f);delete m.dependencies;require('fs').writeFileSync(f,JSON.stringify(m,null,2)+'\n')"
claude plugin eval . --ablation none --trust-plugin -j 4 --allow-tools Agent
mv .claude-plugin/plugin.json.bak .claude-plugin/plugin.json
```

Restore it even when the run fails: a manifest committed without its `dependencies` installs the
plugin without the one it points into. `git diff .claude-plugin/plugin.json` before the commit
confirms it; git ignores the backup, so a forgotten one is never committed in its place.

A trigger case is unaffected — it asks only whether this plugin's skill loaded. A case whose answer
needs a skill of the dependency cannot pass this way, and is run against the installed plugin
instead, after a push.

## Skills describe patterns, not a codebase

Skills are the starting point for the next project, so anything that inventories one particular
project goes stale the moment that project changes.

- **No concrete project paths in prose.** The test: is the path dictated by the framework, or did a
  project choose it? `src/main.ts` (Nest's entry point) stays. A specific feature's file becomes
  descriptive language — "the feature's repository implementation", "the shared response builder".
  An `import` line **inside a code snippet** is exempt: it needs some path, so it uses the
  conventional one.
- **No inventories.** Never list which features, permissions, endpoints, collections or environment
  variables a project has. An inventory falls behind and then tells the agent to build a duplicate
  of something that already exists. Document the *procedure* for finding out instead.
- **No business vocabulary.** Use neutral illustrative entities — `User`, `Order`, `Product`,
  `Account` — even when the pattern was found in a domain-specific file. Names the pattern itself
  defines (`AggregateRoot`, `Paginated`, `ApiResponseBuilder`) are conventions, not contamination.
  This is easiest to miss right after building a real feature, when the domain words are still the
  ones in your head.
- **Current state only, never decision history.** No "deliberately not using X", "X was removed",
  "left out for now". If a pattern is not in use it simply is not mentioned; git already holds that
  history. The one exception is a non-obvious *why* about something still true. Test: would the
  sentence make sense to someone with zero knowledge of how the code got here? If it says "before" /
  "used to" / "anymore", it fails.

## The conventions bind the skills' own snippets

Every rule in a plugin's conventions skill applies to the code samples inside that plugin's other
skills exactly as it applies to a consuming project. A model copies the snippet, not the sentence
next to it — so an example that violates the rule it illustrates teaches the violation, and does it
more effectively than the prose prevents it.

**The snippet check enforces what a linter can.** `npm run check:snippets`
(`tools/check-snippets.mjs`) lints every ```` ```typescript ```` and ```` ```tsx ```` block in the
Markdown of a skill or an agent — `SKILL.md` and `references/` — and every `examples/**/*.ts` and
`.tsx`, with the rules of **that plugin's** reference project's linter that need no type information:
no `any`, explicit return types and member accessibility, braces on every guard, no `console`,
type-only imports as their own statement, no `enum`, no optional call, abbreviations written as words, a
blank line on each side of a multi-line statement and between one-line statements of different
kinds. That last rule is the templates' own, and each stack plugin ships it as an asset the check
loads, so the check and a project run the same file; the two copies must stay identical, and the
check reports it when they drift. The frontend's adds its JSX spacing rule, its own rule for the
hook calls that open a component — an asset too — and the ban on a second headless UI library. Each plugin with snippets has its entry in the tool's
`CONFIGS`; one without is reported rather than judged by another stack's rules. Snippets are
fragments, so they are wrapped as little as they need to parse and never compiled; an undeclared
identifier is not an error. `npm install` wires it as the pre-commit hook. A report names the file,
the block number, and the line inside the block.

A block that must break one of those rules to make its point — a ❌ that shows the violation itself —
is excluded by writing `<!-- snippet-check: skip -->` on the line before its opening fence. Nothing
else excludes a block: a ❌ that shows a design mistake in lint-clean code is still checked, and a
block that fails to parse is fixed, not skipped. Use the marker only when the lint error *is* the
lesson.

**Audit by rule, not by file.** Reading each file front to back asking "what looks wrong here" finds
what is locally odd. It does not find the two defects that actually matter in a corpus of
interlocking documents: a rule stated in one skill and broken by another's example, and a rule the
skills define but their own snippets ignore. Those surface only by taking one rule at a time and
running it across every file.

## Don't restate a rule to summarize it

A closing section that recaps rules already stated above creates a second copy with nothing to say
which one is current. When a skill needs a closing summary, make it a `## Checklist` of **verifiable
items** — things you confirm about the code in front of you — not a paraphrase:

- ❌ `- [ ] Don't put business rules in the controller.`
- ✅ `- [ ] Every branch in the controller is a transport concern — no domain condition.`
