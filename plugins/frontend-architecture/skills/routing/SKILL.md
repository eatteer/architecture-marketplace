---
name: routing
description: "File routes with TanStack Router — thin route files that export `Route`, the root route with the router's context, layouts without a path and layout routes without a component, the router's defaults, `beforeLoad` and loaders in a route's lifecycle and what each may do, context handed down to child routes, search params validated by a schema that drops what it cannot parse, reading them from a page and navigating with an updater, resetting the page when anything else changes, route parameter names, a URL that matches no route, code splitting per route, reloading once when a chunk fails to load, and the page transition on a change of path."
when_to_use: "Trigger on — adding or editing a file under `routes/`, `createFileRoute`, `createRootRouteWithContext`, `getRouteApi`, `validateSearch`, `useSearch`, `useNavigate` or `navigate({ search })`, a search param that breaks the page when edited by hand, an old bookmark that crashes a screen, a filter change that leaves the reader on page 3 of nothing, `page=1` in the URL, a `$param` folder name, `useParams`, a `redirect` thrown from `beforeLoad`, context a child route reads, `useLoaderData`, `routeTree.gen.ts`, `defaultPreload`, `notFoundComponent`, a URL that matches no route, `React.lazy` or a `.lazy.tsx` route, `vite:preloadError`, 'Failed to fetch dynamically imported module' after a deploy, a page that reloads in a loop, animating navigation, `defaultViewTransition`, `view-transition-name`, or every navigation playing another animation."
---

# Routing

Routes are files under `src/routes/`, and the router's plugin generates the route tree from them
(`routeTree.gen.ts`, committed and never edited — see `project-bootstrap`). A route file is **thin**:
it states what must hold before the page renders — a guard, a loader, the search params it accepts —
and renders a page that lives in a feature.

## The route files

```text
src/routes/
├── __root.tsx            the root: the router's context, what listens on every page
├── sign-in.tsx           a public page, outside the signed-in layout
├── _app.tsx              a layout without a path: the session guard and the application shell
└── _app/
    ├── index.tsx         /
    └── users/
        ├── route.tsx     a layout route without a component: the guard for everything below
        ├── index.tsx     /users
        ├── new.tsx       /users/new
        └── $id/
            ├── index.tsx /users/$id
            └── edit.tsx  /users/$id/edit
```

- **Every route file exports a named `Route`**, which is the name the plugin reads (see
  `code-conventions` for exports).
- **The component is a feature's page, imported**: `component: UsersListPage`. A route that only
  composes — the shell, handed the features' menus as props — writes that composition inline, as an
  arrow with its return type; a named component declared in the route file makes the module export
  something besides components, which the hot-reload lint rule refuses.
- **A folder's `route.tsx` with no component** is where a guard for every page below it goes: its
  `beforeLoad` runs for each of them, and the pages add only what they need on top.
- **A page reads its route through `getRouteApi("/_app/users/")`**, never by importing the route file:
  the route imports the page, and the reverse import is a cycle.

```tsx
export const Route = createFileRoute("/_app")({
  beforeLoad: requireSession,
  component: (): JSX.Element => (
    <AppShell navigation={<UsersNavLink />} languageMenu={<AccountLanguageMenu />} userMenu={<UserMenu />} />
  ),
});
```

## The router

```typescript
export function createAppRouter(
  queryClient: QueryClient,
  history?: RouterHistory,
): ReturnType<typeof createRouter<typeof routeTree>> {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    defaultPreload: "intent",
    defaultPreloadStaleTime: ALWAYS_STALE_MS,
    defaultErrorComponent: RouteError,
    defaultNotFoundComponent: NotFound,
    defaultViewTransition: { types: pageTransitionTypes },
    scrollRestoration: true,
  });
}
```

- **The query client is the router's context**, declared on the root route with
  `createRootRouteWithContext<RouterContext>()`, so every guard and loader reads through the same
  cache the components do. The router is created once, in `main.tsx` (see `project-bootstrap`); the
  optional `history` is how a test renders the application at a path with an in-memory one.
- **`defaultPreload: "intent"`** runs a route's loader when the reader hovers or focuses a link to it,
  so the page is often ready by the click.
- **`defaultPreloadStaleTime` of zero**, because the query cache already decides what is fresh (see
  `server-state`); the router's own cache would only keep a second copy of the same answer.
- **The error and not-found components are defaults**, so no route repeats them. What the error
  component shows for each failure is `error-handling`'s.
- **`defaultViewTransition`** animates a change of page; which navigations animate, and how, is
  below under "Page transitions".
- **The router is registered** (`declare module "@tanstack/react-router" { interface Register { … } }`),
  so every `Link`, `navigate` and `getRouteApi` is checked against the real route tree — a link to a
  path that does not exist is a compile error.

## Page transitions

A navigation to another page is a view transition: the content leaves and the next page fades in,
while the shell around it stays still. The router starts it; the browser animates it.

```typescript
const PAGE_TRANSITION_TYPES = ["page"];

export function pageTransitionTypes({ pathChanged }: { pathChanged: boolean }): string[] | false {
  return pathChanged ? PAGE_TRANSITION_TYPES : false;
}
```

```tsx
<main className="flex-1 page-transition:[view-transition-name:page]">
  <Outlet />
</main>
```

```css
@custom-variant page-transition (html:active-view-transition-type(page) &);

html:active-view-transition-type(page)::view-transition-old(page) {
  animation: page-exit 120ms ease-in both;
}

html:active-view-transition-type(page)::view-transition-new(page) {
  animation: page-enter 200ms cubic-bezier(0.4, 0, 0.2, 1) both;
}

@media (prefers-reduced-motion: reduce) {
  ::view-transition-group(*),
  ::view-transition-old(*),
  ::view-transition-new(*) {
    animation: none;
  }
}
```

- **Only a change of path animates.** A filter, a sort or a page of results changes the search alone
  and answers at once; a list that fades on every change of a filter reads as a reload.
- **The shell's content is named `page` only during a change of page**, so only it animates and the
  navigation around it stays put. Named always, it would be captured apart from the root by every
  other view transition too, and would crossfade through the theme's reveal instead of being revealed
  with the rest. A page outside the shell — the sign-in pages — crossfades as the root, the browser's
  default.
- **Every view transition declares a type, and every rule for its pseudo-elements is scoped to it**
  with `:active-view-transition-type()`. A rule on `::view-transition-new(root)` alone applies to
  every transition the page runs, so another feature's animation would play on each navigation.
- **Reduced motion is the stylesheet's**, one media query over every view transition. The router
  does not read the preference, and a browser that cannot type a transition runs it untyped.
- **A browser without view transitions navigates as before**; nothing waits on the animation.

## A route's lifecycle

On a navigation the router runs **every matched route's `beforeLoad`, parent first, one after the
other**, and only then **every loader, in parallel**. The order is what each is for:

- **`beforeLoad` decides whether the route may render at all.** It is where guards go — who must be
  signed in is `authentication`'s, what permission a route needs is `authorization`'s — and a guard
  that refuses throws, so no loader of that route or any below it ever sends a request.
- **What a `beforeLoad` returns is merged into the context of every route below it.** The session
  guard returns `{ session }`, and the guards under it read `context.session` instead of reading the
  session again.
- **A redirect is thrown**, which is the router's control flow and the one reason to suspend the
  lint rule that wants only `Error`s thrown:

  ```typescript
  if (session === null) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's control flow: a thrown redirect is how `beforeLoad` navigates.
    throw redirect({ to: "/sign-in", search: { redirect: location.href } });
  }
  ```

- **A loader puts data in the query cache and returns nothing**: `await
  context.queryClient.ensureQueryData(userQueries.detail(params.id))`, typed `Promise<void>`. The page
  reads the same options through a query, so there is one copy of the data, the one invalidations
  reach. `useLoaderData` would read a second copy that no mutation knows about. Whether a route has a
  loader at all is `data-fetching-states`'.

```tsx
export const Route = createFileRoute("/_app/users/$id/edit")({
  beforeLoad: ({ context }: { context: SignedInContext }): void => {
    requirePermissions(context.session, ["users:update"]);
  },
  loader: async ({ context, params }: { context: RouterContext; params: { id: string } }): Promise<void> => {
    await context.queryClient.ensureQueryData(userQueries.detail(params.id));
  },
  pendingComponent: EditUserPageSkeleton,
  component: EditUserPage,
});
```

## Search params

What a screen can be asked for through its URL — a page, a filter, a sort — is declared by a schema
in the feature's `schemas/`, and the route validates with it. The URL is the screen's state: Back,
a reload and a shared link all land on the same screen.

```typescript
export const usersSearchSchema = z.object({
  page: z.int().min(FIRST_PAGE).optional().catch(undefined),
  search: z.string().trim().min(1).max(USER_SEARCH_MAX_LENGTH).optional().catch(undefined),
  status: z.enum(USER_STATUS_VALUES).optional().catch(undefined),
  sortBy: z.enum(USER_SORT_BY_VALUES).optional().catch(undefined),
  sortOrder: z.enum(SORT_ORDER_VALUES).optional().catch(undefined),
});

export type UsersSearch = z.output<typeof usersSearchSchema>;
```

- **Every param is `.optional()`**, and absent means the default. The default is never written into
  the URL — no `page=1`, no `status=all` — because absence is `undefined` (see `code-conventions`),
  and a URL that spells out the default is a second way to say the same thing.
- **Every param is `.catch(undefined)`.** A value that does not parse — a hand-edited URL, a bookmark
  from before a status was renamed, a term longer than the backend accepts — is dropped, and the
  screen opens with that param at its default. Without the catch, one bad param fails the whole page.
- **The limits are the backend's.** A value the schema accepts is one the backend accepts, so a
  refused request is never the first sign of a bad URL. Which params a list may send at all is
  `pagination`'s.
- **A catalog in the schema comes from the generated types** (see `api-client`), so a value the
  backend dropped stops parsing the moment the types are regenerated.

The page reads the validated params and changes them with an updater:

```tsx
const search = usersRoute.useSearch();
const navigate = usersRoute.useNavigate();
```

```typescript
function changeList(change: Partial<UsersSearch>, replace = false): void {
  void navigate({ search: (previous: UsersSearch): UsersSearch => ({ ...previous, ...change, page: undefined }), replace });
}

function changeFilters(change: Partial<UsersSearch>): void {
  changeList(change, "search" in change && search.search !== undefined);
}

function changePage(page: number): void {
  void navigate({
    search: (previous: UsersSearch): UsersSearch => ({ ...previous, page: page === FIRST_PAGE ? undefined : page }),
  });
}
```

- **Any change but the page itself resets the page.** Page 3 of the old results says nothing about
  the new ones, and a filter that narrows the list to one page would otherwise show an empty one.
- **The updater starts from `previous`**, so a change to one param keeps the others.
- **A change is a step in the history, except refining a search.** Starting one pushes, so Back
  returns to the list without it; refining or clearing it replaces that step, so a pause every few
  keys does not pile up entries (see `pagination` for the text filter).
- **Navigating is the only way the screen's state changes** — no copy of a param in `useState`, and no
  effect that pushes state into the URL. An input that must answer faster than the URL does keeps a
  draft of its own (see `pagination` for the text filter).
- **The `void` is correct**: a failed navigation is rendered by the router's error component.

## Route parameters

**A path parameter is named `$id`, and its folder says whose id it is**: `users/$id/`. The router takes
everything after the `$` as the parameter's name, so `$user-id` would be read as `params["user-id"]`;
one word needs no casing (see `code-conventions` for paths). A route that nests two resources' ids
cannot call both `$id`, and chooses its two names there, each one word.

## A URL that matches no route

The router answers it with its default not-found component, inside the layouts that did match. The
server hands every path that is not a file to `index.html` (see `deployment`), so this is where an
unknown URL ends up. A route whose resource does not exist is a different case — its loader fails
with a `404`, and the error component shows the same page (see `error-handling`).

## Code splitting

**The router's plugin splits every route into its own chunk** (`autoCodeSplitting: true`, see
`project-bootstrap`). A route never declares `React.lazy` or a separate `.lazy.tsx` file: a chunk per
route is the plugin's job, and a page loads when its route does, including on a preload.

### A chunk that fails to load

After a deploy, a page opened before it still names the old chunks, and the server answers them with
a `404` (see `deployment`). Vite reports that as a `vite:preloadError` event, and the page reloads to
pick up the current file names — **once**:

```typescript
export function handlePreloadError(
  event: Event,
  reload: () => void = (): void => {
    window.location.reload();
  },
  now: number = Date.now(),
): void {
  const lastReloadAt = Number(sessionStorage.getItem(RELOAD_GUARD_STORAGE_KEY) ?? 0);

  if (now - lastReloadAt < RELOAD_GUARD_WINDOW_MS) {
    return;
  }

  sessionStorage.setItem(RELOAD_GUARD_STORAGE_KEY, String(now));
  event.preventDefault();

  reload();
}
```

- **The guard is what stops a loop.** A chunk that fails again within `RELOAD_GUARD_WINDOW_MS` of the
  last reload is not a stale deployment but a broken one; the event goes on, and the route's error
  component shows the failure.
- **`preventDefault` only when reloading**, so the error is not also thrown into a page that is about
  to go away.
- The listener is installed in `main.tsx`, before anything lazy-loads (see `project-bootstrap`).

## Checklist

- [ ] Every route file exports `Route`, renders a feature's page, and holds no component of its own
      beyond an inline composition.
- [ ] Every page reads its route through `getRouteApi`, never by importing the route file.
- [ ] Every guard runs in `beforeLoad`, and every route that needs a permission gets it from its own
      `beforeLoad` or a layout route above it.
- [ ] Every loader ensures query options and returns nothing; no page calls `useLoaderData`.
- [ ] Every screen state in the URL is declared by a schema whose params are all `.optional()` and
      `.catch(undefined)`, within the backend's limits.
- [ ] No default value is written into the URL, and every change but the page resets the page.
- [ ] No search param is copied into component state.
- [ ] Every path parameter is `$id` under a folder named for its resource, unless two ids nest.
- [ ] No route uses `React.lazy` or a `.lazy.tsx` file.
- [ ] `vite:preloadError` reloads once, guarded by a window in `sessionStorage`.
- [ ] The router's view transition is typed `page` and returns `false` when the path did not change.
- [ ] The shell's content carries `view-transition-name: page` only under the `page-transition`
      variant.
- [ ] Every `::view-transition-*` rule in the stylesheet is scoped to a type, and one reduced-motion
      query turns every view-transition animation off.
