---
name: i18n
description: "Translations with i18next — resources bundled rather than fetched, one namespace per feature beside `common`, keys in snake_case grouped by screen, keys typed from the reference locale, the parity test across locales, plurals with each language's own categories, interpolation, text read outside a component, the languages the application speaks and the one it starts in, the account's language once signed in, the language every request asks the backend for, the document's `lang`, and each language named in its own words."
when_to_use: "Trigger on — adding text to a screen, a file under `locales/`, `useTranslation`, `t(`, `i18n.t` outside a component, a new namespace or `i18next.d.ts`, a key missing in one language, a key that shows raw on screen, a hard-coded English string, camelCase translation keys, `_one`/`_other`, a plural that is wrong in Spanish, `{{ }}` interpolation, text computed when a module loads that never changes language, `changeLanguage`, the language menu, `navigator.languages`, `<html lang>`, a signed-in reader whose screen ignores the account's language, error messages from the backend in the wrong language, `Accept-Language`, or adding a language."
---

# i18n

Every word on screen comes from a translation file, in every language the application speaks. The
backend speaks the same languages, and every request tells it which one to answer in, so the
server's messages arrive already translated. What those words say is `ux-writing`'s.

## Resources

Translations live in `src/locales/<language>/<namespace>.json` and are **bundled**, not fetched:

```typescript
const LOCALE_MODULES = import.meta.glob<ResourceKey>("/src/locales/*/*.json", { eager: true, import: "default" });
```

- **Bundled, because a namespace that arrives after its screen has mounted suspends a tree already on
  screen.** Shipping every namespace leaves nothing to arrive late, and the initialization is
  synchronous (`initAsync: false`), so the first render already has its text.
- **`escapeValue: false`**: React escapes what it renders, and escaping twice shows entities on screen.
- **The module is imported for its side effect before anything renders** (see `project-bootstrap`).

## Namespaces and keys

- **`common` is the default namespace**: the application's name, actions every screen shares ("Copy
  error", "Try again"), the generic error texts, pagination, the shell. **Each feature has its own**,
  named after it, read with `useTranslation("users")`.
- **Keys are snake_case**, nested by screen or area: `list.search_placeholder`,
  `form.errors.name_required`, `sign_in.email_invalid`. A key is a value that crosses into a file
  translators edit, and the backend's keys use the same casing (see `code-conventions`).
- **Interpolation variables are one word** — `{{min}}`, `{{page}}` — so they need no casing either.
- **A key for each catalog member** is written out in the file and read with a template literal over
  the catalog, which the types still check: `t(\`status.${status}\`)`.

## Typed keys

English is the reference locale. Its files define which keys exist, registered once per namespace:

```typescript
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    resources: {
      auth: typeof auth;
      common: typeof common;
      users: typeof users;
    };
  }
}
```

A key that is not in the English file is a compile error at `t()`, and a renamed key is an error at
every reader. **A new namespace is added to this declaration in the same change**, or its keys are
untyped strings.

## Parity across locales

A test compares every namespace across the locales:

- **Every language has the same keys as English**, with plural suffixes set aside.
- **Every plural is written in every category of its own language**, as `Intl.PluralRules` reports
  them. English has `one` and `other`; Spanish has `one`, `many` and `other`. A plural copied from
  English into Spanish is missing a form, and the test says which.
- **There is one folder per language the application speaks, and no other.**

The test is what makes a translation missing in one language a red build instead of a raw key a
reader finds.

## Plurals and interpolation

A count goes through `count`, and i18next picks the form:

```json
{
  "summary_one": "Page {{page}} of {{pages}} · {{total}} result",
  "summary_other": "Page {{page}} of {{pages}} · {{total}} results"
}
```

```tsx
<p>
  {t("pagination.summary", {
    page: format.number(page),
    pages: format.number(Math.max(pages, 1)),
    total: format.number(total),
    count: total,
  })}
</p>
```

Numbers and dates inside a sentence are formatted before they are interpolated (see `formatting`),
so 12345 results read "12,345" in English and "12.345" in Spanish. `count` stays
the raw number, since it is what picks the plural, and the sentence shows the formatted `total`.

## Text outside a component

A component reads text through `useTranslation`, which re-renders it when the language changes.
Anything else reads it **when it is used, never when its module loads**: a toast built in a function
calls `i18n.t(…)` as it is shown, the client's own error texts are read when the error is built, and a
form's schema is built with the translator it receives (see `forms`). A string computed at module load
stays in the language the page started in.

## The language

```typescript
export const LANGUAGE_VALUES = ["en", "es"] as const;

export type Language = (typeof LANGUAGE_VALUES)[number];

export const DEFAULT_LANGUAGE: Language = "en";
```

- **The application speaks the backend's languages, and falls back to the backend's default**, so a
  reader the two cannot match gets the same language from both.
- **At startup**: the language the reader chose last, stored in `localStorage`; then the first of the
  browser's languages the application speaks, matched on its primary subtag (`es-CO` is `es`); then the
  default. No detection library — three lines of that order are the whole of it.
- **`changeLanguage` persists the choice and switches i18next, each only when it changes something**,
  so applying the language already in place writes nothing.
- **Signed in, the account's language wins**, chosen on whichever device. It is applied where every
  read of the session lands — the session query's function — so screens switch before anything
  renders against the session (the session itself is `authentication`'s). Storing it locally too is
  deliberate: the next visit paints in that language before the session has been read.
- **The language menu changes the language on screen at once.** Without a session that is all it
  does; with one it also tells the backend, as an optimistic update (see `server-state`), and other
  tabs follow.
- **Each language is named in its own words** — "English", "Español" — so a reader lost in the other
  one still finds theirs.

## The language the backend answers in

Every request carries the language on screen in `x-lang` — the client attaches it (see
`api-client`) — and the backend translates the `title`, `detail` and field messages of its errors
into it. A failure shown after a language switch is in the new language; one already on screen keeps
the language it arrived in. A backend `code` is never translated and never shown.

## The document's language

`<html lang>` is set when i18next starts and on every change, so a screen reader pronounces the page
in the language it is written in (see `accessibility`).

## Adding a language

Add it to `LANGUAGE_VALUES` and its name to the labels, create its folder with every namespace — the
parity test lists what is missing — and make sure the backend speaks it too, or its error messages
arrive in the backend's default.

## Checklist

- [ ] No text on screen is written in a component; every string is a key in the feature's namespace
      or in `common`.
- [ ] Every key is snake_case, and every interpolation variable is one word.
- [ ] Every namespace is registered in the i18next type declaration.
- [ ] The parity test passes: the same keys everywhere, and every plural in every form its language
      has.
- [ ] Every count goes through `count`; no plural is built by concatenation.
- [ ] No translated string is read at module load.
- [ ] The languages match the backend's, and the fallback is the backend's default.
- [ ] Signed in, the account's language is applied when the session is read.
- [ ] `<html lang>` follows the language on screen.
