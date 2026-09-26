# engineering-workflow

**The engineering workflow every stack shares**: how branches and commits are organized, and how
architecture decisions are recorded.

It belongs to no stack, so its name carries no stack prefix. The stack plugins declare it as a
dependency, so a project normally gets it by installing one of them rather than on its own.

## What it ships

| Component | How it runs | What it is |
| --- | --- | --- |
| 2 skills | Load themselves when the work matches their triggers | The rules, one owner per concept — the table below |

## How it works

The skills auto-invoke off their `description` and `when_to_use` frontmatter — nothing to copy or
wire up. Each one owns a set of rules, and a stack plugin that needs one of them points at it rather
than keeping a second copy.

| Skill | Scope |
| --- | --- |
| `git-workflow` | Branch flow, branch naming, Conventional Commits |
| `decision-records` | Which decisions earn a record, MADR, numbering, superseding instead of editing |

## Requires

Nothing. This plugin depends on no other plugin, and everything it documents holds with nothing else
installed.

## Add this to the consuming project

A project that installs a stack plugin already has this one: the dependency pulls it in, and it
cannot be disabled while the stack plugin is enabled. To install it on its own:

```bash
claude plugin install engineering-workflow@architecture-marketplace
```

## No runtime code

This plugin ships no library to depend on. Beside its `SKILL.md`, a skill may carry files it points
at:

| Kind | What it is | Where |
| --- | --- | --- |
| Assets | Files copied into a project — the ADR skeleton | `decision-records` |

## Quality checks

Every change to this plugin passes Claude Code's own manifest validator. Its [`evals/`](evals/)
suite, run with `claude plugin eval`, checks that each skill loads for a realistic request that does
not name it, and that an unrelated request loads none. How to run them is in the marketplace's
contributing notes.

## License

[MIT](LICENSE).
