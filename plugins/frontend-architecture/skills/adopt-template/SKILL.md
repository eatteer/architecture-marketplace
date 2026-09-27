---
name: adopt-template
description: "Turns a fresh clone of frontend-template into the user's own project — summarizes what the clone contains, asks for the project's name and one-line description, rewrites every generic name (package, page title, the application's name in every language, documentation), and verifies the result. Run it once, right after cloning."
argument-hint: "[project-name] \"[one-line description]\""
arguments: [project_name, project_description]
disable-model-invocation: true
---

# Make this clone your project

The user has cloned `frontend-template` and wants it to stop being a template. Your job is to give
them their bearings, collect two facts, and rewrite every generic name in the repository.

## 1. Confirm you are in the right place

Check that `package.json` has `"name": "frontend-template"`.

If it does not, stop and say so — either this is not a fresh clone of the template, or this skill
has already run. Offer to show what the name currently is. Do not rewrite anything.

## 2. Tell them what they have

Before asking anything, give them a short summary in their own language. Keep it to a few lines and
make it concrete. Something with the shape of:

> This is a React + TypeScript single-page application on Vite, built against backend-template's
> contract: its Problem Details errors, its cookie session with a refresh that works across tabs, and
> its paginated lists. It already ships sign-in, a users screen gated by permissions, English and
> Spanish, a light and a dark theme, and the whole shadcn catalog on Base UI — all of it working, none
> of it example code. `npm run dev` starts it against the backend in `.env`; `npm run test:e2e` drives
> the build against a real backend.
>
> The architecture rules live in the `frontend-architecture` skills, which load themselves when you
> work here, so you can start building features and they will follow the same patterns.

Read `README.md` first and describe what is actually there rather than repeating the above verbatim
— it may have moved on.

## 3. Ask for the two facts

Ask both at once, and say why each one is needed.

- **The project name.** Lowercase, words separated by hyphens, because it becomes the npm package name
  and the image tag in the deploy instructions. If they give you something else — spaces, capitals,
  underscores — convert it, show them the result, and let them correct it. Refuse a name that is not
  a valid npm package name (no leading dot or underscore, no uppercase, no spaces, under 214
  characters). Ask too how the product is called on screen — the name in the browser tab and the
  application's header — which is usually the same words with capitals and spaces.
- **A one-line description.** What the product does. It becomes the `package.json` description and
  the opening of the README.

Arguments given with the invocation — name: `$project_name`; description: `$project_description`.
Either may be empty. Whatever was given, confirm it back rather than asking again, and ask only for
what is missing.

## 4. Rewrite

Replace **every** occurrence of `frontend-template` with the new name, and the generic description and
display name with theirs. Find them rather than trusting this list — the repository changes — but
expect:

| Where | What |
| --- | --- |
| `package.json` | `name` and `description` |
| `CLAUDE.md` | the title on line 1 |
| `README.md` | the title on line 1, the image tag in the deploy commands, and any section that talks about the template as a template ("Starting a real project"): rewrite it for the project rather than replacing the name inside it |
| `index.html` | the `<title>`, written as "Frontend template", so a hyphenated search misses it |
| `src/locales/*/common.json` | `app_name` in every language — translated, not copied: the Spanish file says "Plantilla de frontend" |
| `src/**` and `test/**` | any test that uses the display name as a fixture, such as the link to the home page found by its name |
| `package-lock.json` | the two `name` fields, regenerated with `npm install --package-lock-only` rather than edited |

Search for the old name when you are done — `frontend-template`, `frontend template` and each
language's display name, case-insensitive — and report anything you deliberately left.

Do not touch: every mention of `backend-template` (it names the backend this project talks to until
the user points it elsewhere, and its links are legitimate), the marketplace reference in
`.claude/settings.json`, the plugin name anywhere, the decision records under `docs/adr/` (they say
"the template" on purpose: that is where the decisions were taken), or `package-lock.json` beyond
what `npm install --package-lock-only` regenerates.

## 5. Verify, then hand it over

Run `npm run typecheck` and `npm test`. The locale parity test confirms `app_name` still exists in
every language, and the test that finds the home link by the application's name confirms the display
name reached the screen.

Finish with what to do next, in three lines at most: fill `.env` from `.env.example` if they have not
— `VITE_API_URL` is their backend — regenerate the API's types with `npm run api:types` once that
backend runs, and `npm run dev`. Then tell them they can ask for their first feature in plain language
and the skills will shape it.

Never commit. The user decides when to commit and what the message says.
