---
name: git-workflow
description: "The branching and commit methodology — the long-lived branches and which direction changes flow between them, branch names prefixed by the commit type, Conventional Commits with a feature scope, what belongs in one commit, and keeping documentation and skills in the same commit as the change they describe."
when_to_use: "Trigger on — creating a branch, naming a branch, writing a commit message, choosing a commit type or scope, configuring commitlint or a `commit-msg` hook, a commit rejected by the message linter, splitting work across commits, deciding which branch to start from or merge into, setting up branches in a repository that deploys nothing, or a change to a pattern that leaves its skill unedited."
---

# Git workflow

## Branches

**A long-lived branch is justified by an environment behind it, and by nothing else.** It exists to
answer a question somebody asks: what is deployed right now, what is being verified right now. A
repository that deploys nothing — a template, a library consumed by tag, a plugin read from its
default branch — has no such question, so it has one branch.

Getting this backwards is not free ceremony, it is a stale default branch. Work accumulates on `dev`
because that is where work goes, `main` is never promoted because no deployment forces it, and the
branch everyone actually clones or reads falls weeks behind the thing being maintained. The repo
looks abandoned while it is under daily development.

Where there *are* environments, three long-lived branches, and changes only ever flow in one
direction:

```text
<type>/* ──▶ dev ──▶ test ──▶ main
```

- **`dev`** — where work lands and integrates. Short-lived branches start here and return here.
- **`test`** — what is being verified. Receives from `dev` only.
- **`main`** — what is deployed. Receives from `test` only.

Never start a short-lived branch from `test` or `main`, and never merge upward out of order. A
change that reaches `main` without passing through the others has been verified nowhere, and the
next promotion from `test` will conflict with it.

An urgent fix is still a branch off `dev` and still travels the same path. If the path is too slow
for a real emergency, the path is the thing to fix.

Single-branch repositories keep everything below — the branch names, the commit format, one concern
per branch. A change still gets its own short-lived branch when it wants review; it just merges back
into `main`, which is also where it is released from.

## Branch names

```text
<type>/<short-description>
```

**The prefix is the commit type** the branch's work will carry: `feat/`, `fix/`, `refactor/`,
`perf/`, `docs/`, `test/`, `build/`, `ci/`, `chore/`. One vocabulary for both means nobody maps
`feature/` to `feat` or wonders which prefix a documentation change takes, and a branch whose work
does not fit its prefix is a sign it holds more than one concern.

Kebab-case, in English, describing the change rather than the ticket: `feat/order-settlement`
reads; `feat/PROJ-1423` requires a lookup to mean anything. When tickets matter, they go in the
commit body or the pull request, where there is room for the link.

One branch, one concern. Two unrelated changes on one branch cannot be reviewed separately, cannot
be reverted separately, and cannot be released separately.

## Commits

[Conventional Commits](https://www.conventionalcommits.org), with the feature as the scope:

```text
feat(orders): add settlement endpoint
fix(users): reject an email that differs only by case
refactor(payments): extract the retry policy into a port
docs(skills): document the idempotency key contract
test(orders): cover settlement under a concurrent retry
chore(deps): update the driver to 9.2
```

- **Type** is one of `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, `chore`,
  `revert`. `build` is the build and the image — compiler output, the Dockerfile, dependencies
  that change what ships; `ci` is the pipeline definition; `revert` undoes an earlier commit and
  names it in the body.
- **Scope** is the feature directory the change lives in, or a cross-cutting area (`common`,
  `config`, `skills`, `deps`). A scope is expected; the hook warns rather than rejects without one,
  because a change that spans the whole repository has no single area to name.
- **Description** is lower case, imperative mood, no trailing period. "add", not "added" or
  "adds": it completes the sentence *this commit will…*.
- **A breaking change** is marked with `!` after the scope and explained in the body.

**A `commit-msg` hook enforces the format** with commitlint and the
`@commitlint/config-conventional` preset, its `type-enum` narrowed to the list above. A rule the
tooling does not check holds only until the first hurried commit, and a history with one malformed
message in it cannot be fed to anything that reads the log.

The body explains *why*, when the why is not obvious. The diff already shows what changed; the thing
it can never show is what the alternative was and why it was rejected.

## What goes in one commit

One commit is one complete, coherent change: it builds, it passes, and reverting it leaves the
codebase consistent.

That means some things are **always** in the same commit as the code:

- A schema change and its migration.
- A domain error, its entry in the errors map, and its translation keys.
- A new environment variable and the `.env.example` line that declares it.
- A pattern change and the edit to the skill that documents it — **including its triggers in
  `description` and `when_to_use`**, or the skill stays correct and becomes unreachable.

And some things are **never** in the same commit: a behavior change and a reformat. A diff where
one real change hides among four hundred whitespace lines is a diff nobody reviews.

Commit while the work is coherent, not when you stop for the day. A commit that says "wip" is a
commit that has to be read alongside the next one to make sense, forever.

## Checklist

- [ ] Every long-lived branch has an environment behind it; a repository that deploys nothing
      has only `main`.
- [ ] The branch started from the integration branch, its prefix is its commit type, and the rest
      of its name describes the change.
- [ ] The branch holds one concern.
- [ ] Every commit message has a type from the list, a scope (or a reason the change has none), and
      a lower-case imperative description.
- [ ] A `commit-msg` hook runs commitlint with the project's type list.
- [ ] Every commit builds and passes on its own.
- [ ] Schema changes carry their migration, errors carry their map entry and translations, new
      environment variables carry their `.env.example` line.
- [ ] Every pattern change edits its skill's body and its triggers in the same commit.
- [ ] No commit mixes a behavior change with a reformat.
