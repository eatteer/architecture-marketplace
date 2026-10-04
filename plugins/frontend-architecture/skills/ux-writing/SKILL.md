---
name: ux-writing
description: "What the words on screen say — button labels as a verb with its object and the labels exempt from it, sentence case, voice and tense, where a period goes and where it does not, field labels and placeholders, the wording of a confirmation dialog and of a task dialog, toasts, error messages and field errors, empty states, progress text, links that name where they go, one word per concept, the rules each language adds, and what a project decides for itself and writes down once."
when_to_use: "Trigger on — what a button, menu item, link, dialog, toast, empty state or error should say, writing or reviewing the text of a key under `locales/`, a button labelled with a noun (\"New project\") or \"OK\", \"Yes\", \"Submit\", Title Case On A Label, a period at the end of a button, title or toast, a colon after a field label, a placeholder used as the label, \"please\", \"oops\", \"click here\", an exclamation mark in an ordinary message, a toast that says \"Done\" or \"Success\", an error that says only \"Error\" or \"Something went wrong\", a field error that blames the reader, an empty state that only says \"No data\", \"Loading...\" with three dots, the title and buttons of a delete confirmation, two words used for the same thing, button text in Spanish (infinitive or imperative), ¿ and ¡, or the quotes a language uses."
---

# UX writing

Every word on screen tells the reader what is there, what happened, or what to do next, in as few
words as that takes. These rules hold for any product and any visual style; the words a product
chooses for its own concepts and its tone are the project's (see "What the project decides").

The text lives in the translation files (see `i18n`); these rules bind every language they hold.

## Everywhere

- **Sentence case**: only the first word and proper names are capitalized — "Create project", not
  "Create Project". Product and brand names keep their own casing.
- **Active voice, present tense**: "The file is too large", "We couldn't save the project", not "The
  project could not be saved by the system".
- **The reader is addressed directly**, with the same form of address on every screen.
- **No "please", no "oops", no "sorry" for routine events.** A request is a plain instruction, a
  failure a plain fact.
- **An exclamation mark only for a real celebration** — a first publish, a finished setup — never in
  an ordinary confirmation or an error.
- **A link names where it goes**: "Read the billing terms", never "click here" or "learn more" on its
  own, so it still makes sense read out of its sentence.
- **The ellipsis is one character**, `…`, not three periods.

## Periods

| Ends without a period | Ends with a period |
| --- | --- |
| Buttons, titles, headings, labels, menu items and their secondary line, tabs, tooltips, placeholders, badges, toasts | A complete sentence in body text: a description, a help text, an error message, an alert's detail |

A fragment in body text ("Optional", "Up to 5 MB") takes no period either. Two sentences in one
text both end with one.

## Buttons and actions

**A button starts with a verb** — the action it performs — followed by its object when the context
does not already give it:

| ✅ | ❌ |
| --- | --- |
| Create project | New project |
| Add member | Member |
| Delete file | Yes |
| Save | Submit, OK |

- **A single verb when the object is obvious** from the screen or the dialog: "Save" at the foot of
  a form that edits one thing, "Publish" beside the draft it publishes.
- **The label says what happens, not the gesture**: "Send invite", not "Click to send".
- **The same action has the same label everywhere.** A reader who learned "Remove" on one screen
  does not meet "Unlink" for the same thing on the next.
- **Exempt**, because they do not perform an action: the options of a toggle, a select or a segmented
  control ("Grid", "List"), a menu named on an icon-only button ("Language"), pagination, "Back" and
  "Next" between steps, and passing states shown on the button while it works ("Saving…").
- **Titles of pages and dialogs may be nouns** ("Members", "Billing"); a dialog that performs one
  task is titled with that task (below).

## Labels and placeholders

- **A field's label is a noun phrase**, with no colon at its end: "Email", "Company name". The one
  colon is a prefix shown before its value on the same line: "Sort by: Newest".
- **A placeholder shows an example, never the label**: the label stays visible above the field and
  the placeholder says "For example: ana@company.com". A placeholder disappears as the reader types,
  so an instruction there is lost exactly when it is needed.
- **A help text under a field is a sentence** when it is one, and says what the field needs before
  the reader gets it wrong: "Use at least 8 characters."

## Dialogs

**A confirmation dialog is only for a loss** (when to ask is `forms`'s rule). Its words:

- **The title is the question, with the action and its object**: "Delete this project?"
- **The description says what is lost**, and ends with "This can't be undone." when that is true:
  "Its pages and files will be deleted. This can't be undone."
- **The confirm button repeats the title's verb with its object**: "Delete project", never "Yes",
  "OK" or "Confirm".
- **The dismiss button says "Cancel"**, in every confirmation dialog.

**A task dialog is titled with the task**, a verb and its object: "Invite a member", "Add a video".
Its main button finishes the task: "Send invite", "Add video".

## Toasts

**A toast confirms what happened, in a few words**: the object and the participle — "Project saved",
"Member invited" — or one short sentence when it carries a fact the reader needs: "Change scheduled
for October 3". No period, and never a bare "Done" or "Success", which say nothing about what. An
error toast follows the rules of errors below (its behavior is `error-handling`'s).

## Errors

- **Say what happened and what to do next**: "We couldn't upload the file. Check your connection and
  try again." Never a bare "Error" or "Something went wrong" with nothing after it.
- **No blame and no technical words**: no "invalid input", "backend", "request failed", no status
  codes or ids (what the report carries instead is `error-handling`'s).
- **A field error is the instruction that fixes the field**: "Enter a valid email", "Choose a date
  after today", not "Email is invalid" or "Wrong date".
- **Name the problem, not the reader**: "This name is already taken" rather than "You entered a
  duplicate name".

## Empty states

**An empty state says what will appear here and how it gets there**, with the action to start when
the reader can take it: "Projects you create appear here." and a "Create project" button. A list
that is empty because of a filter says so and offers to clear it: "No projects match these filters."
and "Clear filters". "No data" alone tells the reader nothing.

## Progress

**Work in progress is the verb in its continuous form, followed by `…`**: "Saving…", "Uploading 3
files…", "Preparing your report…". It names the real operation; a wait that is long enough to notice
says what is being waited for.

## One word per concept

**Each concept has one word, and a word names one concept**, across every screen, message and
language file. If the product says "remove" for taking an item out of a list and "delete" for
destroying it, it never swaps them, and never adds "erase" for either. The list of those words is the
project's (below); the rule that there is one per concept is not.

## Per language

These come with the language, not with the project. Apply the section of each language the
application speaks.

### English

- **The verb in a button is the imperative, which is its base form**: "Create project", "Sign in".
- **Contractions are fine** where they read naturally: "We couldn't save the project", "This can't
  be undone."
- **Quotes are “ ”**, with ‘ ’ inside them.

### Spanish

- **The verb in a button is the infinitive**: "Crear proyecto", "Iniciar sesión", "Añadir miembro".
  Never the imperative ("Crea proyecto", "Inicia sesión"), a noun ("Nuevo proyecto") or the first
  person ("Prefiero…").
- **Questions and exclamations open with ¿ and ¡**: "¿Eliminar este proyecto?"
- **Quotes are « »**, with “ ” inside them.
- **Progress uses the gerund**: "Guardando…", "Subiendo archivos…".
- **The toast's participle agrees with its object**: "Proyecto guardado", "Página guardada".
- **A field prompt is the instruction in the form of address the project chose** ("Escribe tu email"
  or "Escriba su email"), never "Ingresar…" or "Introduzca…" mixed with the other form.

## What the project decides

These change from product to product, so the rules above leave them open. A project decides them
once and writes them where everyone who writes its text reads them — its own `CLAUDE.md` or product
document — and every screen follows them:

- **The voice**: how formal, how warm, how technical the reader can be assumed to be.
- **The form of address**, where the language has more than one (*tú* or *usted*, *du* or *Sie*).
- **The word for each concept** of the product: the list of terms, with the words never used instead.
- **Its own celebrations**: which moments, if any, earn an exclamation mark.

When this skill and a project's written decision disagree on one of these, the project's wins; on
anything else, this skill does.

## Checklist

- [ ] Every button that performs an action starts with a verb, and none says "OK", "Yes" or "Submit".
- [ ] Every label, title and button is in sentence case.
- [ ] No button, title, label, menu item, tooltip, placeholder, badge or toast ends with a period;
      every full sentence in body text does.
- [ ] No field label ends with a colon, and no placeholder stands in for a label.
- [ ] Every confirmation dialog's title is a question naming the action and its object, its confirm
      button repeats that verb and object, and its dismiss button says "Cancel".
- [ ] Every toast names what happened; none says only "Done" or "Success".
- [ ] Every error says what happened and what to do next, with no code, id or technical word; every
      field error is the instruction that fixes it.
- [ ] Every empty state says what will appear and how, with the action to start when there is one.
- [ ] Every progress text is a continuous verb followed by the single character `…`.
- [ ] No link reads "click here" or "learn more" alone.
- [ ] Each concept uses the project's one word for it in every screen and language.
- [ ] Each language's own rules hold in its files: Spanish buttons in the infinitive, ¿ ¡ opening
      marks, its quotes.
