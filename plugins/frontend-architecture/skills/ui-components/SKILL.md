---
name: ui-components
description: "What this architecture decides on top of shadcn's catalog — Base UI as the one headless library, the whole catalog in `common/ui/` as lint-clean library code, the checks after an update and the local changes it carries forward, an overlay closing and why, the dialog's scrolling frame, a link styled as a button kept a link, a button with no loading indicator, where the palette rule binds, the theme class and its reveal, the toaster's translated close label, the scrollbar's gutter kept stable, and Base UI's style elements off for the Content-Security-Policy. Always loaded together with the `shadcn` skill, which owns how the catalog is used."
when_to_use: "Trigger on — a lint or type error in a file under `common/ui/` after adding or updating a component, a local change to a catalog file lost on an update, a `\"use client\"` directive in a catalog file, a Radix import or a second headless UI library, `onOpenChange` and its reason, `onInteractOutside` or `onPointerDownOutside`, a dialog whose title or buttons scroll away, a dialog's header that shifts a pixel or changes its spacing on scroll, a link styled as a button, `buttonVariants` on a `Link`, a `Spinner` inside a `Button`, a loading or pending state on a button, `ThemeProvider`, `useTheme`, the theme menu, `prefers-color-scheme`, the theme's reveal animation, a toast's close button in English, `CSPProvider`, `.base-ui-disable-scrollbar`, `scrollbar-gutter`, content that shifts sideways when a page gets a scrollbar, or a chart that loses its colors in production."
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
  it. The project makes three kinds: what the library cannot be told from outside — the toaster's
  and the dialog's close buttons, which take a translated `closeLabel` — what the registry's file
  does not do at all (the dialog's frame, below), and what the Content-Security-Policy refuses (the
  chart, below).
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

**A button carries no loading indicator.** shadcn composes `Spinner` + `data-icon` + `disabled` for a
pending action; here a write's progress is the fullscreen loader's, which covers the button that
sent it (see `error-handling`). The button is disabled while the write is pending, keeps its own
icon, and a write that does not raise the loader changes the label instead. A spinner belongs to a
status line, never inside a button.

**A select's nothing-selected value is `null`**, held by the form like every other value (see
`forms`).

## The dialog's frame

The registry's dialog scrolls as a whole, so a dialog taller than the screen takes its title, its
close button and its buttons out of view with the content. The catalog's `dialog.tsx` changes that,
and `alert-dialog.tsx` has the same frame for a long confirmation; an update of either carries it
forward:

- **The popup is a fixed frame around a scroller.** It is capped at the viewport's height minus a
  margin, does not scroll, and holds one `dialog-scroller` element that does; the close button sits
  in the frame, outside the scroller, so it never moves.
- **The header and the footer are sticky inside the scroller**, the header at its top and the footer
  at its bottom, painted with the popup's background so content passes under them. Only what lies
  between them moves; a form that wraps the fields and the footer scrolls the same way.
- **Each draws its hairline only while content runs beneath it.** The scroller names a scroll
  timeline and the two read it: the header's rule appears once the reader scrolls past the top, the
  footer's shows while there is more below. A dialog that fits shows neither, and a browser without
  scroll-driven animations shows none and still scrolls. The rules are three utilities in
  `styles.css`:

  ```css
  @utility overlay-scroller {
    scroll-timeline: --overlay-scroll y;
  }

  @utility overlay-rule-top {
    border-bottom: 1px solid transparent;

    @supports (animation-timeline: scroll()) {
      animation: overlay-rule-show linear both;
      animation-timeline: --overlay-scroll;
      animation-range: 0 1rem;
    }
  }
  ```

  `overlay-rule-bottom` is the mirror (`border-top`, `animation-range: calc(100% - 1rem) 100%`, a
  keyframe from `var(--border)` to transparent).
- **The space at an edge is the same whether content rests there or passes under it.** The header's
  bottom padding equals the scroller's gap and a negative margin of the same size takes it back, and
  the footer's top padding does the same. With a padding smaller than the gap, the space under the
  title shrinks the moment the reader scrolls.
- **The popup is centred by its margins, not by a translate**: `fixed inset-0 m-auto h-fit` with its
  maximum height and width, where the registry has `top-1/2 left-1/2 -translate-1/2`. A translate of
  half its size lands the frame on a fraction of a pixel — any odd size, any display scaled to 125%
  — and once the header sticks the browser rounds it apart from the frame, so the header seems to
  shift by a pixel and its edge flickers the moment the content scrolls. A dialog placed elsewhere,
  such as a command palette near the top, sets its own `top` with `bottom-auto`.
- **`--dialog-gutter` is the frame's padding**, set on the popup and read by the scroller, the header
  and the footer, which bleed to the frame's edges with it. A call site may change the variable — a
  command palette sets it to `0` to sit flush — and nothing else about the frame. Content that runs
  to the edges, such as a cover image, takes the same negative margin.
- **The footer has no close button.** The registry's footer offers one labelled "Close" in English;
  closing is the corner's button, and the footer holds the dialog's own actions.

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
- [ ] A dialog taller than the screen keeps its title, close button and footer in view, and the space
      under the title does not change when the content scrolls.
- [ ] A link that looks like a button is a `Link` with `buttonVariants()`, an overlay reacts to
      closing in `onOpenChange`, and no button holds a `Spinner`.
- [ ] Outside `common/ui/`, no palette color and no `dark:` color class.
- [ ] The theme is a class on `<html>`, applied before the first render, following the system through
      `useSyncExternalStore`, and the reveal respects reduced motion.
- [ ] `<html>` has `scrollbar-gutter: stable`.
- [ ] Base UI's style elements are off, and the rule they carried is in the stylesheet.
