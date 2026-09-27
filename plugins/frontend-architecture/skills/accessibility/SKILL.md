---
name: accessibility
description: "Accessibility of the screens — the accessible name of every control in the reader's language, icon-only buttons and decorative icons, a table's caption, landmarks and the navigation's label, native elements before roles, keyboard support left to the catalog, `aria-busy` on a skeleton and on rows being replaced, `aria-sort`, live regions (an error that replaces content, an error toast, the saving indicator), focus after a failed submit and inside overlays, and the accessibility lint with the few suspensions it allows."
when_to_use: "Trigger on — a button with only an icon, `aria-label`, `aria-hidden`, `sr-only`, an image without alt text, a `div` or `span` with `onClick`, `role=`, a table without a caption, `<nav>`, `<main>` or `<header>`, a screen reader that reads placeholders or announces nothing, `aria-live`, `role=\"alert\"` or `role=\"status\"`, `aria-busy`, `tabIndex`, keyboard navigation or a focus trap, focus lost after an action, a `jsx-a11y` lint error or disabling one, or a menu item in another language."
---

# Accessibility

A screen works with a keyboard and a screen reader, or it does not work. Most of that comes free from
two choices — native elements, and the catalog's components, which already manage focus, keyboard and
roles — and what is left is naming things, saying what is happening, and putting focus where the
reader has to look.

## Every control has a name

The accessible name is what a screen reader announces and what a test finds an element by. It says
what the control does, in the reader's language — it is a translation like any other text (see
`i18n`).

- **Visible text is the name.** A button that says "Next" is named "Next"; nothing more is added.
- **An icon-only control is named with `aria-label`**, and its icon is hidden:

  ```tsx
  <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t("theme.label")} />}>
    <TriggerIcon aria-hidden="true" />
  </DropdownMenuTrigger>
  ```

- **An icon beside text is decoration**: `aria-hidden="true"`, so the name is not read twice or
  prefixed with an image.
- **A table is named by its caption**, visually hidden when the heading above already says it:
  `<TableCaption className="sr-only">{t("list.caption")}</TableCaption>`.
- **A form field is named by its label**, connected by id; the wiring of label, description and
  error is `forms`'.
- **A choice written in another language says so**: each item of the language menu is the language's
  own name, with `lang` set to it, so it is pronounced in that language.

## Native elements, and the catalog for the rest

- **An action is a `<button>`, a navigation is a link.** A `div` with `onClick` has no role, no focus
  and no keyboard; giving it all three by hand is rebuilding the button badly. A link that looks like a
  button stays a link (see `ui-components`).
- **Menus, selects, dialogs, popovers and tabs come from the catalog**, whose components implement
  the keyboard patterns and focus handling those widgets require — arrow keys, typeahead, Escape,
  returning focus to the trigger. A hand-built one never matches them.
- **No positive `tabIndex`.** The order focus moves in is the document's order; changing it is
  changing the markup.
- **Landmarks come from the shell**: one banner `<header>`, one `<main>` around the routed content,
  and the navigation in a `<nav>` with an `aria-label`, so a reader can jump between them. A page
  adds its own heading, never another `<main>`; a `<header>` inside the page's `<section>` groups
  its title and actions and is no landmark.
- **The document's language is kept in step with the screen's** (see `i18n`), so a screen reader
  pronounces the page in the language it is written in.

## Saying what is happening

- **A skeleton's root is `aria-busy="true"`**, so placeholders are not read as content (see
  `data-fetching-states`); a table whose rows are being replaced by the next page is `aria-busy`
  while they are.
- **A sorted column says so on its header cell** with `aria-sort` — `ascending` or `descending` —
  while the button inside keeps the column's name. An order folded into the button's name changes the
  name on every click, and a reader looking for the column no longer finds it.
- **A failure that replaces content while the reader waits is an alert**: the error screen has
  `role="alert"`, and so has the alert inside a form that could not be submitted. An error toast is
  announced by the toast library's own alert region because of its priority (see `error-handling`).
- **The saving indicator is a status with a name** — a spinner with `aria-label` ("Saving…") — so a
  reader who pressed submit hears that something is under way.

A live region announces what changes inside it after it is on the page. Announcing a whole screen
that just rendered is not its job; moving focus or the route's own heading is.

## Focus

- **After a submit that fails, focus goes to the first invalid field**, for the client's validation
  and for the backend's field errors alike (see `forms`), so a keyboard user lands where the fix is.
- **An overlay traps focus while open and returns it to its trigger when it closes.** The catalog
  does both; an overlay built outside it would have to, and that is why it is not built outside it.
- **A control that disappears takes focus with it.** When an action removes the element that had
  focus — a row deleted, a button that turns into text — focus is moved to what the reader will act
  on next, never left on the document's body.
- **A button that becomes disabled under the reader's focus stays focusable** — a submit while its
  write is pending, a "Copy error" once copied, a Next with no next page. A natively disabled button
  drops focus to the body; the catalog's `Button` takes `focusableWhenDisabled` (it renders
  `aria-disabled` instead), and a library button without that option gets `aria-disabled` itself.

## The lint

`jsx-a11y` in its recommended set is part of the lint config (see `project-bootstrap`): a control with
no name, an image with no `alt`, a click handler on an element with no role, a label with no control
all fail the build.

A rule is suspended only on its line, with the reason (see `project-bootstrap` for the form), and
only where a component deliberately leaves the wiring to its caller — a catalog label whose `htmlFor`
the caller passes, an addon that forwards a click to the input it decorates.

A suspension in a screen's own code means the screen is doing something the catalog already does.

Tests find elements by role and name — `getByRole("button", { name: "Next" })` — so an element a test
cannot find that way is usually one a screen reader cannot either (see `testing`).

## Checklist

- [ ] Every interactive element has a translated accessible name; every icon-only control has
      `aria-label`, and every decorative icon `aria-hidden="true"`.
- [ ] Every table has a caption, and every form field a connected label.
- [ ] No `onClick` on an element without a role, and no positive `tabIndex`.
- [ ] Menus, selects, dialogs and popovers come from the catalog.
- [ ] The shell has one `header`, one `main` and a labelled `nav`.
- [ ] Every skeleton root and every table showing a placeholder page is `aria-busy`.
- [ ] Every sortable header cell carries `aria-sort`; the button keeps the column's name.
- [ ] Every error that replaces content has `role="alert"`, and the saving indicator has a name.
- [ ] A failed submit focuses the first invalid field, a removed control hands focus on, and a
      button disabled under focus stays focusable.
- [ ] Every `jsx-a11y` suspension is on one line, with its reason, inside a component that leaves the
      wiring to its caller.
