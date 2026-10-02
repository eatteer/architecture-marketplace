---
name: ui-components
description: "What this architecture decides on top of shadcn's catalog — Base UI as the one headless library, the whole catalog copied into `common/ui/` as lint-clean library code, the repository as the inventory, the checks after a component is added or updated and the local changes an update carries forward, an overlay closing and why, a link styled as a button kept a link, where the palette rule binds, the theme class with the system theme and the view-transition reveal, the toaster's translated close label, the scrollbar's gutter kept stable, and Base UI's inline style elements turned off for the Content-Security-Policy. Always loaded together with the `shadcn` skill, which owns how the catalog is used."
when_to_use: "Trigger on — a lint or type error in a file under `common/ui/` after adding or updating a component, a local change to a catalog file lost on an update, a `\"use client\"` directive in a catalog file, a Radix import or a second headless UI library, a registry item that brings another primitive library, `onOpenChange` and its reason, `onInteractOutside` or `onPointerDownOutside`, a link styled as a button, `buttonVariants` on a `Link`, a link announced as a button, `ThemeProvider`, `useTheme`, the theme menu, `prefers-color-scheme`, the theme's reveal animation, a toast's close button in English, `CSPProvider`, `.base-ui-disable-scrollbar`, `scrollbar-gutter`, content that shifts sideways when a page gets a scrollbar, or a chart that loses its colors in production."
---

# UI components

The application's primitives are **shadcn's catalog in its Base UI variant**, copied into
`src/common/ui/`. How the catalog is used — the CLI, Base UI's props against Radix's, composing a
component, semantic colors, variants, `cn`, icons, adding a token — is the `shadcn` skill's, which
is shadcn's own and is followed as written.

**Load the `shadcn` skill too, before writing or advising on any component**: none of its rules are
repeated here, so an answer from this skill alone is missing them. This skill holds what this
architecture decides on top of it; where the two disagree, this one wins.

## The catalog

- **The repository is the inventory.** Every component the registry offers is in `common/ui/`, not
  only the ones in use, so a screen never adds one: before building a dialog, a select, a date
  picker or a menu, look there. This skill never lists what exists, because the folder already
  does and never falls behind.
- **One headless library.** Base UI is the only one: two libraries give two APIs, two focus models
  and two sets of bugs for the same components, and the lint config refuses an import of the other
  (see `project-bootstrap`). A registry item built on another primitive library is not added.
- **Unused components cost nothing in the bundle.** Only what a screen imports is shipped, so the
  whole catalog stays, and the next screen finds what it needs already styled and lint-clean.
- **The catalog is library code that obeys the project's rules.** Nothing in `common/ui/` is excluded
  from the typecheck, and the linter turns off one rule there, the abbreviation rule, because of the
  names below; the tests load every module so an update that breaks one fails
  even where no screen uses it, and coverage leaves the folder out (see `testing`).
- **A change to a catalog file is rare and says why beside it**, because the next update overwrites
  it. The project makes two kinds: what the library cannot be told from outside — the toaster's
  close button, which takes a translated `closeLabel` — and what the Content-Security-Policy refuses
  (the chart, below).
- **The catalog keeps the registry's names**, so an update lands on the same files without a rename:
  its hook `useIsMobile` stays in `use-mobile.ts`, which the sidebar imports by that path, and a
  component keeps the registry's spelling of an abbreviation (`InputOTP`), which the rest of the
  code imports as it is.

### After a component is added or updated

The CLI does the adding and the updating, with a dry run and a diff per file before anything is
overwritten (see `shadcn`). A file that carries a local change is merged by hand, keeping the
change and its reason. Then the file is brought to the project's rules:

1. `lint`. Its `--fix` settles the format; what is left is fixed by hand — an explicit return type
   on every function, a `"use client"` directive removed (there is no server rendering), a named
   export for a new variant or hook added to the hot-reload rule's allowed names, an accessibility
   rule suspended on its line with the reason when the component leaves the wiring to its caller.
2. `typecheck`, and the tests, which import the new module.
3. The registry's own classes are left as shipped — an overlay's `bg-black/10`, the `dark:`
   refinements on its inputs — since the next update brings them back. The rule against palette
   colors and `dark:` color classes binds the code outside `common/ui/`, and a class the theme does
   not define is a lint error there (see `project-bootstrap`).

## Where this architecture differs from shadcn's examples

Each of these replaces what the `shadcn` skill shows for the same need.

**A link styled as a button stays a link**: `<Link to="/" className={buttonVariants()}>`. shadcn
shows the button rendered as an anchor with `nativeButton={false}`; the library then announces the
link as a button, the wrong role for something that navigates (see `accessibility`). The variants
function is exported beside the component for exactly this.

**An overlay closing is handled in `onOpenChange`**, which Base UI calls with the reason:
`onOpenChange={(open, details) => …}`, and `details.reason` says whether it was an outside press,
the escape key or the trigger. There is no `onInteractOutside` or `onPointerDownOutside`.

**A select's nothing-selected value is `null`**, held by the form like every other value (see
`forms`).

## The theme

The theme is a class on `<html>` — `light` or `dark` — and the stylesheet's dark variant keys on it
(`@custom-variant dark (&:is(.dark *))`). The class, not the media query, because the reader can pick
a theme that differs from the system's. The provider is the project's own; there is no theme
library.

- **The choice is `light`, `dark` or `system`**, stored in `localStorage`; `system` follows the
  operating system's preference, read with `useSyncExternalStore` over the media query so a change
  while the page is open applies at once (see `code-conventions` for external stores).
- **The class is applied before React starts** (see `project-bootstrap` for where), and the provider
  keeps it in step afterwards.
- **`useTheme()` throws outside the provider**, with a sentence that says so, rather than returning a
  default that hides the missing provider.
- **A change grows out of the control that made it**, as a circle revealed with a view transition:

  ```typescript
  startThemeTransition((): void => {
    flushSync((): void => {
      setThemeState(nextTheme);
    });

    applyResolvedTheme(resolveTheme(nextTheme, getSystemTheme()));
  }, origin);
  ```

  The transition snapshots the page when the callback returns, so the new theme is rendered
  synchronously and its class applied inside it. Without view transitions, without an origin, or for
  a reader who asked for reduced motion, the theme simply changes.
- **The reveal is a view transition of type `theme`** —
  `document.startViewTransition({ update, types: ["theme"] })` — and its rules in the stylesheet are
  scoped to that type (see `routing` for why every view transition declares one). A browser that
  cannot type a transition (`"types" in ViewTransition.prototype` is false) changes the theme at
  once.

**The toaster and every overlay follow the theme with no wiring**: they paint with the same tokens.
The toaster is mounted once with its translated close label; what an error toast shows is
`error-handling`'s.

## The scrollbar's gutter

The document keeps the scrollbar's gutter whether the page scrolls or not, so going from a short
page to a long one does not shift the content sideways:

```css
@layer base {
  html {
    scrollbar-gutter: stable;
  }
}
```

It is set on `<html>` because the document is what scrolls. Base UI's scroll lock reads the value
there when an overlay opens and keeps it, so a dialog does not shift the page either. Where the
scrollbar is drawn over the content, as with macOS's overlay scrollbars, there is no gutter to keep
and the rule changes nothing.

## Base UI and the Content-Security-Policy

A few Base UI components — a select's list, a scroll area — inject a `<style>` element with one rule
that hides a scrollbar. The Content-Security-Policy refuses inline styles (see `security`), so
`CSPProvider disableStyleElements` turns those elements off (its place among the providers is
`project-bootstrap`'s), and the rule is carried in `styles.css` instead:

```css
.base-ui-disable-scrollbar {
  scrollbar-width: none;
}

.base-ui-disable-scrollbar::-webkit-scrollbar {
  display: none;
}
```

A Base UI update that injects another element shows up as a CSP violation in the check of the
served image, which sends the real policy (see `deployment`); its rule is added here the same way.

The chart's registry file renders its color variables in an inline `<style>` through
`dangerouslySetInnerHTML`, which the policy blocks, so in production a chart would lose its colors.
The catalog's `chart.tsx` builds the same rules into a constructed stylesheet instead — the CSSOM,
which the policy does not restrict — adopted in a `useInsertionEffect` and removed on unmount. It is
the change an update of the chart has to carry forward.

## Checklist

- [ ] Every primitive a screen uses comes from `common/ui/`; nothing the catalog has is rebuilt, and
      nothing imports a second headless library.
- [ ] Every file in `common/ui/` passes lint and typecheck, and every local change to one carries its
      reason and survived the last update.
- [ ] A link that looks like a button is a `Link` with `buttonVariants()`, and an overlay reacts to
      closing in `onOpenChange`.
- [ ] Outside `common/ui/`, no palette color and no `dark:` color class.
- [ ] The theme is a class on `<html>`, applied before the first render, following the system through
      `useSyncExternalStore`, and the reveal respects reduced motion.
- [ ] `<html>` has `scrollbar-gutter: stable`.
- [ ] Base UI's style elements are off, and the rule they carried is in the stylesheet.
