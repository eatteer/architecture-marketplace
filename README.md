# architecture-marketplace — Claude Code plugin marketplace

Architecture, patterns and code conventions packaged as **auto-invoking Claude Code Skills**.
Maintain the rules in one place; every project that installs a plugin gets the updates.

## Plugins

| Plugin | Kind | Covers |
| ------ | ---- | ------ |
| [`backend-architecture`](plugins/backend-architecture/) | **core** | Code conventions, project bootstrap and module wiring, the steps to add a feature, the four layers of a feature, API documentation, money, transactions and consistency, event-driven side effects, pagination, error handling, observability, deployment, authentication and authorization, security hardening, configuration, i18n, audit logging, background jobs, external integrations, testing — see [its README](plugins/backend-architecture/README.md) for the full list |
| [`frontend-architecture`](plugins/frontend-architecture/) | **core** | Code conventions, project bootstrap and the lint config, the API client, server state and the states a read renders, error handling, forms, routing, pagination, the component catalog, accessibility, i18n, UX writing, authentication and authorization, security, testing, deployment — see [its README](plugins/frontend-architecture/README.md) for the full list |
| [`engineering-workflow`](plugins/engineering-workflow/) | shared | Git workflow — branch flow, branch naming, Conventional Commits — and architecture decision records |

`engineering-workflow` depends on nothing and holds the rules every stack shares. Each stack plugin
declares it as a dependency, so installing a stack plugin pulls it in automatically and it cannot be
disabled while a stack plugin that depends on it is active.

Plugin names carry a stack prefix, except a plugin that serves every stack. One marketplace hosts
every stack, and the versioning rule is per plugin, so a release in one stack is invisible to
projects on another.

## Install

```bash
# 1. Add the marketplace
claude plugin marketplace add eatteer/architecture-marketplace

# 2. Install the stack plugin — its dependency, engineering-workflow, comes with it
claude plugin install backend-architecture@architecture-marketplace    # or frontend-architecture
```

The skills auto-invoke once installed — nothing to copy or wire up. Each skill's `description` and
`when_to_use` carry its own trigger keywords, so the relevant one loads on its own when you work on
a matching task. A change spanning layers — the common case — needs several of them, not just one.

For a team, commit the marketplace and the plugin to the project's `.claude/settings.json` instead,
so everyone who opens the repository gets them — the plugin's README has the snippet.

## Updating

1. Edit the relevant `skills/<name>/SKILL.md`, or the files it points at.
2. If a pattern moved or changed, update **both** the skill body and its trigger keywords
   (`description` and `when_to_use`), and run the evals for the skills it touches.
3. **Bump the plugin's `version`** in `plugins/<name>/.claude-plugin/plugin.json` — without this the
   change is invisible to every project that already installed it. See [CLAUDE.md](CLAUDE.md).
4. Commit and push.
5. Each project refreshes and updates:

   ```bash
   claude plugin marketplace update architecture-marketplace
   claude plugin update backend-architecture@architecture-marketplace
   ```

   The `@architecture-marketplace` suffix on `update` is required — the bare plugin name fails with
   "Plugin not found". Restart Claude Code afterwards for the new content to load.

## Contributing

Run `npm install` once after cloning: it wires the pre-commit hook, which runs Claude Code's
manifest validator and lints every code sample against the conventions it teaches, so neither a
broken manifest nor a sample that breaks its own rules can be committed. The eval suite that proves
each skill still loads is run by hand, because every run is a model call — see "Running the evals"
in [CLAUDE.md](CLAUDE.md).

[CLAUDE.md](CLAUDE.md) holds the rules for maintaining this repo: what ships and what does not, the
versioning contract, the naming scheme, the ownership map, and what skills may and may not contain.

## License

[MIT](LICENSE).
