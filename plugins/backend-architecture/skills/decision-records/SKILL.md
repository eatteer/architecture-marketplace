---
name: decision-records
description: "Architecture decision records — which decisions earn one, where they live and how they are numbered, the MADR format, status and superseding instead of editing, and keeping the README and the code from restating them."
when_to_use: "Trigger on — writing or editing a file under `docs/adr/`, choosing between two libraries, patterns, services or protocols, reversing or replacing a decision made earlier, a README section that explains why something was decided, a reviewer asking why it was done this way, a decision that lives only in a chat thread or a pull request description, or a code comment that has grown into an essay about the alternatives."
---

# Decision records

A decision record holds what a codebase cannot say about itself: the alternatives that were weighed
and the cost that was accepted. The code shows what was chosen. A comment says why a line is the way
it is. Neither can say what else was on the table, and without that the next person either
rediscovers the reasoning from scratch or undoes the decision without knowing what it was
protecting.

## What earns a record

A decision gets a record when **all three** hold:

- **It constrains later work.** Other code is written against it — a wire format, a revocation
  model, a storage layout, a library whose API spreads through the codebase.
- **There was a real alternative.** Something another competent team would reasonably have chosen.
  A decision with one sensible answer needs a comment at most.
- **It is costly to reverse.** Undoing it means a migration, a breaking change to clients, or a
  rewrite across features.

A convention does not get a record: the rules every project follows belong to the skills, and a
record that restates one is a second copy of it. What gets a record is **this project's** choice —
including the choice a skill leaves open and names as the project's to make. A record may cite a
skill's rule as the reason for its choice; it names the skill and does not restate the rule's
argument.

## Where and how

```text
docs/adr/
├── README.md                                    the index: number, decision, status
├── adr-template.md                              the skeleton for the next one
├── 0001-orders-settle-asynchronously.md
└── 0002-the-access-token-lifetime-is-the-revocation-window.md
```

- **Numbered in order, four digits, never reused**, with a kebab-case slug that states the decision
  rather than the topic — `orders-settle-asynchronously`, not `settlement`.
- **The title is the decision in the present tense**: "Orders settle asynchronously". A reader of
  the index learns what was decided without opening the file.
- **The index lists every record with its status**, and a new record adds its row in the same
  change.

The format is MADR. The skeleton is [assets/adr-template.md](assets/adr-template.md): **copy it into
the records folder as `adr-template.md`** when the project has none, and start each record from that
copy. A filled record reads like this:

```markdown
---
status: accepted
date: 2026-01-15
---

# 0002. The access token lifetime is the revocation window

## Context and problem statement

What forces the decision, in two or three sentences.

## Considered options

- A short access-token lifetime, with no lookup on each request
- A check of every request against the revocation store

## Decision outcome

Chosen option: the short lifetime, because … (the trade itself is laid out in the `authentication`
skill; this record says which side the project took and why)

### Consequences

- Good, because …
- Bad, because … — and what contains it.

## More information

Where it is implemented, and what would make it worth revisiting.
```

`date` is the date the decision was accepted, not the date the file was first drafted.

**The bad consequences are the section that matters.** A record that lists only benefits reads as a
justification written after the fact, and it tells the next person nothing about when the decision
stops being right. Name the cost, and what would make it worth paying no longer.

## A record is not edited to change its decision

The status is `proposed`, `accepted`, `deprecated`, or `superseded by NNNN`. When a decision
changes, a new record states the new one and names the record it replaces, and the old record's
status is the only line of it that changes. The reasoning that was true at the time stays readable
beside the reasoning that replaced it — which is the whole value of having written it down.

Correcting a fact that was wrong when written — a wrong link, a misnamed file — is an edit. Changing
what was decided is a new record.

## One copy of the reasoning

The record is where a decision's reasoning lives, and everything else points at it:

- **The README states the decision in one line and links the record.** A README paragraph that
  re-argues the decision is a second copy, and the one that drifts is whichever nobody reads when
  the decision changes.
- **A code comment says what the line needs to say where it is** — the constraint a change would
  break — and names the record when the rest of the argument is longer than the code it explains.
- **A pull request that makes a decision includes its record.** A decision that exists only in a
  review thread is gone the day the thread is.

## Checklist

- [ ] Every decision that constrains later work, had a real alternative and is costly to reverse has
      a record under `docs/adr/`.
- [ ] Each record states the decision in its title, lists the options weighed, and names at least
      one bad consequence.
- [ ] The index lists every record with its current status.
- [ ] No record restates a rule a skill owns; a record that relies on one names the skill.
- [ ] A changed decision is a new record, and the old one's status reads `superseded by NNNN`.
- [ ] The README links each record instead of repeating its reasoning.
