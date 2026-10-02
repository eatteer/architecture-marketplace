---
name: adopt-template
description: "Turns a fresh clone of backend-template into the user's own project — summarizes what the clone contains, asks for the project's name and one-line description, rewrites every generic name (package, database, bucket, containers, documentation title), and verifies the result. Run it once, right after cloning."
argument-hint: "[project-name] \"[one-line description]\""
arguments: [project_name, project_description]
disable-model-invocation: true
---

# Make this clone your project

The user has cloned `backend-template` and wants it to stop being a template. Your job is to give
them their bearings, collect two facts, and rewrite every generic name in the repository.

## 1. Confirm you are in the right place

Check that `package.json` has `"name": "backend-template"`.

If it does not, stop and say so — either this is not a fresh clone of the template, or this skill
has already run. Offer to show what the name currently is. Do not rewrite anything.

## 2. Tell them what they have

Before asking anything, give them a short summary in their own language. Keep it to a few lines and
make it concrete. Something with the shape of:

> This is a NestJS + TypeScript + MongoDB backend built on Clean Architecture and DDD. It already
> ships sign-in with rotating refresh tokens, users, roles and permissions, transactional email and
> S3-compatible file storage — all of it working, none of it example code. `pnpm infra:up` starts
> the database, a mail catcher and object storage; `pnpm migrate` brings the database schema up to
> date; `pnpm seed` creates the first administrator.
>
> The architecture rules live in the `backend-architecture` skills, which load themselves when you
> work here, so you can start building features and they will follow the same patterns.

Read `README.md` first and describe what is actually there rather than repeating the above verbatim
— it may have moved on.

## 3. Ask for the two facts

Ask both at once, and say why each one is needed.

- **The project name.** Lowercase, words separated by hyphens, because it becomes the npm package
  name, the database name, the object-storage bucket and the container names. If they give you
  something else — spaces, capitals, underscores — convert it, show them the result, and let them
  correct it. Refuse a name that is not a valid npm package name (no leading dot or underscore, no
  uppercase, no spaces, under 214 characters).
- **A one-line description.** What the product does. It becomes the `package.json` description and
  the description of the API documentation, whose title becomes the project's name.

Arguments given with the invocation — name: `$project_name`; description: `$project_description`.
Either may be empty. Whatever was given, confirm it back rather than asking again, and ask only for
what is missing.

## 4. Rewrite

Replace **every** occurrence of `backend-template` with the new name, and the generic description
with theirs. Find them rather than trusting this list — the repository changes — but expect:

| Where | What |
| --- | --- |
| `package.json` | `name` and `description` |
| `CLAUDE.md` | the title on line 1 |
| `README.md` | the title on line 1, and any section that talks about the template as a template ("Starting a real project"): rewrite it for the project rather than replacing the name inside it |
| `compose.development.yml` | every `container_name` |
| `.env.example` | the database in the example `MONGO_URI`, the example `STORAGE_BUCKET`, and `OTEL_SERVICE_NAME` |
| `.env` | whichever of the three it has, if the file exists — it is git-ignored, so it may not |
| `src/**` and `test/**` | any spec that uses the name as a fixture |
| the API documentation | wherever it is built, usually `setup-docs.ts`: `setTitle` — written as "Backend template", so a hyphenated search misses it — becomes the project's name, and `setDescription` the one-line description |

Search for the old name when you are done — both `backend-template` and `backend template`,
case-insensitive, since the description and the documentation title spell it with a space — and
report anything you deliberately left — a URL to the template's own repository is a legitimate
leftover; the project's own name is not.

Do not touch: the marketplace reference in `.claude/settings.json`, the plugin name anywhere, the
decision records under `docs/adr/` (they say "the template" on purpose: that is where the decisions
were taken), or `pnpm-lock.yaml`, which does not carry the name.

## 5. Verify, then hand it over

Run `pnpm typecheck` and `pnpm test`. If the database name changed and containers are already
running, tell them their existing local data lives under the old database name and that
`pnpm infra:down && pnpm infra:up && pnpm migrate && pnpm seed` gives them a clean one.
The compose volumes are named after the directory the repository was cloned into, not after the
project, so renaming the project does not orphan them.

Finish with what to do next, in three lines at most: fill `.env` from `.env.example` if they have
not, `pnpm infra:up`, `pnpm migrate`, `pnpm seed`, `pnpm start:dev`. Then tell them they
can ask for their first feature in plain language and the skills will shape it.

Never commit. The user decides when to commit and what the message says.
