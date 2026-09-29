---
name: ui-components
description: "The component catalog and the theme — shadcn's components in their Base UI variant, copied whole into `common/ui/` and kept lint-clean, how a component is added or updated, the repository as the inventory, Base UI's composition (`render` instead of `asChild`, `onOpenChange` with its reason, `nativeButton`), a link styled as a button, semantic color tokens under `@theme`, variants with CVA, merging classes with `cn`, icons, the theme class with the system theme and the view-transition reveal, the toaster's translated close label, and Base UI's inline style element turned off."
when_to_use: "Trigger on — `npx shadcn add`, editing a file in `common/ui/`, `components.json`, building a dialog, select, popover, menu, tabs or tooltip by hand, `asChild`, `render=`, `nativeButton`, `onInteractOutside` or `onPointerDownOutside`, `onOpenChange`, a Radix import, a hard-coded color like `bg-white` or `text-gray-500`, `dark:` color classes, a new color or radius token, `@theme`, `cva` or `VariantProps`, `buttonVariants`, `cn`, `clsx` or `tailwind-merge`, a class the linter says the theme does not define, a lucide icon, `ThemeProvider`, `useTheme`, the theme menu, `prefers-color-scheme`, a toast's close button in English, a link announced as a button, `CSPProvider`, or `.base-ui-disable-scrollbar`."
---

# UI components

The application's primitives are **shadcn's catalog in its Base UI variant**, copied into
`src/common/ui/` — every component the registry offers, not only the ones in use. Screens compose
them; nothing a primitive already does is built again.

## The catalog

- **The repository is the inventory.** Before building a dialog, a select, a date picker or a menu,
  look in `common/ui/`: it is there. This skill never lists what exists, because the folder already
  does and never falls behind.
- **One headless library.** Base UI is the only one: two libraries give two APIs, two focus models
  and two sets of bugs for the same components, and the lint config refuses an import of the other
  (see `project-bootstrap`).
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

### Adding or updating a component

1. `npx shadcn@latest add <component>` — `components.json` selects the Base UI style, the stylesheet
   and the aliases, so the file lands in `common/ui/` importing through `@/`. Updating an existing one
   overwrites it: diff against what was there and put back any change that carried a reason.
2. `npm run lint`. Its `--fix` settles the format; what is left is fixed by hand — an explicit return
   type on every function, a `"use client"` directive removed (there is no server rendering), a named
   export for a new variant or hook added to the hot-reload rule's allowed names, an accessibility
   rule suspended on its line with the reason when the component leaves the wiring to its caller.
3. `npm run typecheck`, and the tests, which import the new module.
4. Check an edit of yours uses tokens (below). The registry's own classes are left as shipped —
   an overlay's `bg-black/10`, the `dark:` refinements on its inputs — since the next update brings
   them back; the rule against palette colors and `dark:` binds the code outside `common/ui/`.

## Base UI's vocabulary

The catalog's components expose Base UI's API, not Radix's, and screens use it as it is:

| Need | Base UI |
| --- | --- |
| Render a trigger as another element | `render={<Button variant="ghost" size="icon" />}` — there is no `asChild` |
| A trigger rendered as something that is not a `<button>` | `nativeButton={false}`, so the library adds the button semantics itself |
| React to an overlay closing, and know why | `onOpenChange={(open, details) => …}`, with `details.reason` — not `onInteractOutside` |
| A select's value and its items | `items` with `{ value, label }`, and `null` for nothing selected (see `forms`) |

**A link styled as a button stays a link**: `<Link to="/" className={buttonVariants()}>`. Rendering
the button component as a link sets `nativeButton={false}`, and the library then announces the link as
a button — the wrong role for something that navigates (see `accessibility`).

## Styling

### Semantic tokens

Every color is a token that says what it is for — `bg-background`, `text-muted-foreground`,
`border-input`, `bg-destructive` — never a palette color (`bg-white`, `text-gray-500`). A token is
defined twice in `styles.css`, once under `:root` and once under `.dark`, and mapped into Tailwind
under `@theme inline`:

```css
@theme inline {
  --color-muted-foreground: var(--muted-foreground);
}

:root {
  --muted-foreground: oklch(0.556 0 0);
}

.dark {
  --muted-foreground: oklch(0.708 0 0);
}
```

- **So there is no `dark:` variant for a color.** The token already changes with the theme; a `dark:`
  class beside it is a second definition that drifts from the first.
- **A new token is added to all three places at once**, or the class compiles to nothing in one
  theme. The Tailwind lint rule reports a class the theme does not define (see `project-bootstrap`).
- Radii and fonts are tokens the same way.

### Variants and class merging

- **Variants are declared with `cva`**, and the props type derives from them with `VariantProps`, so
  a variant that does not exist is a compile error. The variants function is exported beside the
  component (`buttonVariants`) for the element that needs the look without the component — the link
  above.
- **Classes are merged with `cn`**, and the caller's `className` goes last so it wins a conflict. `cn`
  is shadcn's own package, which resolves Tailwind conflicts; there is no separate `clsx` or
  `tailwind-merge`.
- **A class list that grows long is the linter's to wrap**; how it is laid out is not a decision.

### Icons

Icons are lucide's. An icon beside text is decoration and takes `aria-hidden="true"`; an icon that is
the whole content of a button needs a name on the button (see `accessibility`).

## The theme

The theme is a class on `<html>` — `light` or `dark` — and the stylesheet's dark variant keys on it
(`@custom-variant dark (&:is(.dark *))`). The class, not the media query, because the reader can pick
a theme that differs from the system's.

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

**The toaster and every overlay follow the theme with no wiring**: they paint with the same tokens.
The toaster is mounted once with its translated close label; what an error toast shows is
`error-handling`'s.

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
- [ ] Every file in `common/ui/` passes lint and typecheck, and every change to one carries its reason.
- [ ] Triggers use `render`, overlays use `onOpenChange`, and a link that looks like a button is a
      `Link` with `buttonVariants()`.
- [ ] Every color outside `common/ui/` is a semantic token defined for both themes and mapped under
      `@theme`; no palette color and no `dark:` color class.
- [ ] Every component with variants declares them with `cva` and merges classes with `cn`, the
      caller's last.
- [ ] Every decorative icon has `aria-hidden="true"`.
- [ ] The theme is a class on `<html>`, applied before the first render, following the system through
      `useSyncExternalStore`, and the reveal respects reduced motion.
- [ ] Base UI's style elements are off, and the rule they carried is in the stylesheet.
