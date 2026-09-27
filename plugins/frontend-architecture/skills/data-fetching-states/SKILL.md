---
name: data-fetching-states
description: "How a screen renders the states of a read — pending, error, empty, ready — resolved in order and then descended as non-optional props, `isPending` rather than `isLoading`, a query disabled until the reader chooses, the altitude a state resolves at (the page, a section, a dependent read, an overlay), a route loader with a suspense query as the alternative to a skeleton in place, not found against a real error, empty only for collections, the page kept on screen while the next one loads, and skeletons as sibling exports that keep the ready UI's height."
when_to_use: "Trigger on — branching on `isPending`, `isLoading`, `isError` or `isFetching`, rendering a skeleton, an empty state or an error state, a `?.` or `?? []` on query data, a component that takes a `loading` prop, editing a component that has a companion skeleton, a page that jumps when its data lands, a list that flashes a skeleton on every filter change, `keepPreviousData` and `isPlaceholderData`, a query with `enabled: false` that shows a skeleton forever, a query whose argument comes from another's result, a dialog that fetches its own data, a page with several independent sections, choosing between a loader and a skeleton in place, `useSuspenseQuery` or `pendingComponent`, or a 404 shown with a retry button."
---

# Data-fetching states

Every read spans up to four states — **pending, error, empty, ready** — and a component resolves them
explicitly, in that order, then **descends**: it hands the resolved value to a child as a
non-optional prop. Reaching for a default *instead of* branching (`users.data?.items ?? []`,
`user?.email ?? ""`) keeps an illegal state representable — ready UI with no data — and the screen
renders a form for nobody or a table that says "no results" when the request failed.

## Resolve in order, and let the types follow

```tsx
function UsersListContent({ search, sort, onSort, onPageChange }: UsersListContentProps): JSX.Element {
  const { t } = useTranslation("users");

  const users = useQuery(userQueries.list(search));

  if (users.isPending) {
    return <UsersTableSkeleton />;
  }

  if (users.isError) {
    return (
      <ErrorState
        error={users.error}
        onRetry={() => {
          void users.refetch();
        }}
      />
    );
  }

  if (users.data.items.length === 0) {
    return <UsersEmpty title={t("list.empty.title")} />;
  }

  return (
    <div className="flex flex-col gap-4">
      <UsersTable users={users.data.items} sort={sort} onSort={onSort} isBusy={users.isPlaceholderData} />
      <DataTablePagination pagination={users.data.pagination} onPageChange={onPageChange} />
    </div>
  );
}
```

**Branch on `isPending`, never on `isLoading`.** A query is pending while it has no data — before its
first answer, and for as long as it is disabled. `isLoading` is pending *and* fetching, so a disabled
query is not loading, falls past the guard, and the ready branch renders with no data. `isPending`
is also what TypeScript narrows on: after the `isPending` and `isError` guards, `users.data` is the
data type itself, with no `undefined` left in it. A `?.` on query data below those guards is the
sign that one of them is missing.

**The query result is read through its name**, not destructured into loose flags (see
`code-conventions`): `users.isPending`, `users.error`, `users.data`. The narrowing only works on the
object.

**Resolution happens in statements above the `return`, never inside JSX.** A ternary in the markup
that tests `isError`, defaults `data` or reads through `?.` is resolution in disguise. Swapping one
already-resolved element for another inside a tree the parent renders anyway is fine inline.

Once resolved, **the value descends non-optional**, and everything below reads it directly:

```tsx
export function UserDetails({ user }: { user: User }): JSX.Element {
  const format = useFormatters();

  return <p>{user.email} · {format.dateTime(user.createdAt)}</p>;
}
```

A hook that needs the resolved entity's id then mounts only once the id exists — no `enabled: id !==
""`, no `?? ""` to satisfy its type.

## A query that waits for the reader

`enabled: false` is right for a read that **may not run yet** — a search the reader has not typed,
a gate that is not data. Such a query stays pending for as long as it is disabled, so a screen that
shows its skeleton on `isPending` shows it forever. The component resolves "nothing asked yet" first,
from the same input that disables the query:

```tsx
if (term === undefined) {
  return <SearchPrompt />;
}

if (results.isPending) {
  return <ResultsSkeleton />;
}
```

When the input is a value from another read, it is not a gate but a dependency, and it is expressed
by structure instead (below).

## Altitude: resolve where the data lives

The altitude at which a state resolves must match what the screen is still worth with that source
missing — **not always the page**.

- **The page is one required resource** (a detail page, an edit form) → the page resolves it. There
  is nothing to show without it.
- **Several sources, each worth reading on its own** (a dashboard) → **each section** owns its query
  and its states, so one failing degrades one card, with its own retry, and the rest keep rendering.
- **Several sources the screen needs all of** — a form and the catalogs its selects offer — → **the
  page**, as if they were one. A form whose options failed to load is a form nobody can fill, and an
  honest page-level error beats empty dropdowns. The test is not how many endpoints there are: with
  this one missing and every other present, is there still something worth showing?
- **One read's argument comes from another's result** → **split by altitude**. The parent resolves
  and descends; the child that owns the dependent read exists only once the parent's entity does, so
  its argument is an ordinary value and its failure stays in its own section:

  ```tsx
  export function UserDetail({ user }: UserDetailProps): JSX.Element {
    const orders = useQuery(orderQueries.byUser(user.id));

    if (orders.isPending) {
      return <UserOrdersSkeleton />;
    }

    if (orders.isError) {
      return <ErrorState error={orders.error} />;
    }

    return <UserOrders orders={orders.data} />;
  }
  ```

  A `Boolean(user)` or an `id !== undefined` in `enabled` is the tell that a data dependency has been
  written as a gate.
- **A read behind a dialog or a drawer** → **inside the overlay**. Its skeleton fills the dialog, its
  error renders in the dialog, and the page underneath never learns about either; hoisting them to
  the page turns one detail that failed into a blanked list. The overlay opens when the reader opens
  it, not when its data arrives.

**A shell that renders in every state** — a header, filters, a back link — stays in the page, and
the states resolve inside a content child below it (the list above is exactly that: the page renders
the title and the filters, and `UsersListContent` resolves). When several states and the shell grow
together, a hook in the feature can return a discriminated union keyed by `status`, so the shell
renders once and each branch reads non-optional fields.

## Loading before the page renders

A route can load its data before its component renders, and then the component never has a pending
state at all:

```tsx
export const Route = createFileRoute("/_app/users/$id/")({
  loader: async ({ context, params }): Promise<void> => {
    await context.queryClient.ensureQueryData(userQueries.detail(params.id));
  },
  pendingComponent: UserDetailPageSkeleton,
  component: UserDetailPage,
});
```

```tsx
export function UserDetailPage(): JSX.Element {
  const { id } = userRoute.useParams();

  const { data: user } = useSuspenseQuery(userQueries.detail(id));

  return <UserDetails user={user} />;
}
```

`useSuspenseQuery` reads what the loader put in the cache, and its `data` is never `undefined` — the
route already resolved pending (its `pendingComponent`, shown only when the load takes long enough to
notice) and error (its error component, which shows a 404 as not found — see `error-handling`).

Which to choose is one question: **does the screen have something to show before its data?**

- **No — the page *is* the resource**: a detail page, an edit form. Load in the route. A form then
  mounts with its values from the start, which is what `forms` needs, and a missing resource is a
  not-found page rather than a skeleton that turns into one.
- **Yes — a shell worth showing at once**: a list with its title and filters. No loader; the content
  resolves in place, and the reader can start typing a filter while the rows arrive.

`useSuspenseQuery` is only ever used under a loader that ensured the same options. Without one, the
component suspends on first render and the route's pending component replaces the whole page — the
shell included.

## Not found against a real error

Inside the error state there are two outcomes with different UI, split by the `ApiError`'s
**`status`**, never by a feature's `code`:

- **404** — the resource does not exist. A not-found view, **with no retry**: retrying cannot make it
  exist.
- **Anything else**, a network failure included — an error state **with** a retry.

A read in a route loader gets this from the route's error component. A read resolved in place
branches on it itself, before the generic error.

## Empty exists only for collections

A list with zero matches is a successful answer with an empty page — a real state, which the
component resolves as `items.length === 0` with an empty view that says why (no users, or none that
match the filters). A single resource has **no** empty state: a missing one is a 404, handled above.

## The page on screen while the next one loads

A read fetches more than once — a filter changes, a page advances, a write invalidates it. Only the
first time has nothing to show. After that, a list query keeps the previous page with
`placeholderData: keepPreviousData` (see `server-state`), so `isPending` stays false and the rows stay
on screen; the component marks them as being replaced with **`isPlaceholderData`**:

```tsx
<Table aria-busy={isBusy} className={isBusy ? "opacity-60" : undefined} />
```

**Never branch a state on `isFetching`.** It is true for every background refetch — a window
focus, an invalidation after someone else's save — and a screen that shows a skeleton or a spinner on
it blinks every time. `isPlaceholderData` is true only while the rows on screen belong to another
key, which is the one moment they are wrong.

## A resolved entity's nullable relation

Resolving the entity does not make every field of it present: a relation the API declares nullable
is still `null`. Guard the render — show the element only when the relation exists — so a formatter
keeps a strict `T => string` contract, and fields that only mean something together (an amount and
its currency) render under one guard, together or not at all.

## Skeletons are a sibling export, not a `loading` prop

A component renders its **empty** and **ready** states only. Its skeleton is a second export **in the
same file** — `UsersTable` and `UsersTableSkeleton`, `UserDetailPage` and `UserDetailPageSkeleton` —
and the caller chooses between them where it resolves the state. A `loading?: boolean` prop buries
the branch inside a shared component and forces every caller to thread a flag it may not have.

**A skeleton is a second copy of its component's layout, and it has to keep the same height**, or the
page jumps when the data lands. Nothing fails when they drift — not the compiler, not the tests — so
**editing a component means editing its skeleton in the same change.**

- **Reuse the real structure.** The page and its skeleton render the same layout component — the same
  card, the same header — and the skeleton puts placeholders only where content goes:

  ```tsx
  export function UserDetailPageSkeleton(): JSX.Element {
    return (
      <UserDetailLayout title={<Skeleton className="h-8 w-48" />}>
        <UserDetailsSkeleton />
      </UserDetailLayout>
    );
  }
  ```

- **Count what the component renders.** A list's skeleton renders a full page of rows — the page
  size the query asks for — and a details list the same number of rows it has fields.
- **Size placeholders to the text they stand for.** A line of body text is its line height, not the
  height of the bar drawn inside it; keep the real text element and put the placeholder inside it
  when the difference shows.
- **The error and empty branches reserve the same space**, or recovering from an error moves the page.
- **The skeleton's root says it is busy** — `aria-busy="true"` — so assistive technology does not
  read placeholders as content (see `accessibility`).

## State-to-render map

| State | A single resource | A collection |
| --- | --- | --- |
| pending | `isPending` → skeleton, or the route's pending component under a loader | `isPending` → skeleton |
| not found | `status === 404` → not-found view, **no retry** | — none: zero items is an empty page |
| error | any other failure → error state **with retry** | the same |
| empty | — none | `items.length === 0` → empty view |
| ready | the resolved data, non-optional | the same |
| next page loading | — | the previous page, `aria-busy` while `isPlaceholderData` |

## Checklist

- [ ] Every read resolves `isPending`, then `isError`, then empty, in statements above the `return`.
- [ ] No `?.`, `??` or non-null default on query data below its guards, and no `isLoading` or
      `isFetching` deciding a state.
- [ ] Every disabled query's screen resolves "not asked yet" before `isPending`.
- [ ] Every dependent read lives in a child that receives the resolved parent.
- [ ] Every `useSuspenseQuery` reads options its route's loader ensured.
- [ ] A 404 shows not found without a retry; every other failure has one.
- [ ] Every list query that changes key with its filters keeps the previous page and marks it busy.
- [ ] Every skeleton is a sibling export, renders the real layout, and has the ready UI's height.
- [ ] No component takes a `loading` prop.
