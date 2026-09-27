---
name: pagination
description: "Lists against the backend's paginated endpoints — the list query a screen sends (only the parameters the backend declares, the page size stated explicitly, pages counted from 1), `Paginated<T>` and the pagination block as it arrives, the sort whitelist taken from the generated types and the default sort a list shows as active, the data table composed from the catalog's table with sortable headers, pagination controls driven by the backend's `next` and `previous`, a select filter, and a text filter that answers every keystroke and reaches the URL once typing pauses."
when_to_use: "Trigger on — rendering a paginated endpoint as a table, a `limit`, `page`, `sortBy` or `sortOrder` parameter, `Paginated<T>` or `mapPage`, a sortable column header, `SortableTableHead` or `DataTablePagination`, a Next button that stays enabled on the last page, a page count computed on the client, a sort field typed by hand, a column that shows no sort arrow on first load, a list whose page size changed when the backend's default did, a search box that sends a request per keystroke, a search input that loses what was typed when the URL updates, Back that does not restore the search box, `useDebouncedFilter`, a status filter with an 'all' option, or reaching for TanStack Table."
---

# Pagination

Every list the backend serves is paginated, filtered and sorted **by the backend**. The screen sends
the query, renders the page it gets back, and never pages, filters or sorts rows itself: the client
only ever holds one page, so anything it computed over the rows would be about that page, not the
list.

## The list query

The backend shares one list query across its endpoints: `page` counts from 1, `limit` has a default
and a maximum, `sortBy` is one of the feature's whitelisted fields and `sortOrder` is `asc` or `desc`,
beside the feature's own filters. **It refuses a parameter it does not declare**, so the request is
built from exactly two things — the validated search params, which only hold declared ones (see
`routing`), and the page size:

```typescript
export const USERS_PAGE_SIZE = 10;

async function fetchUsers(search: UsersSearch, signal: AbortSignal): Promise<Paginated<User>> {
  const page = unwrapPage(await apiClient.GET("/api/v1/users", {
    params: { query: { ...search, limit: USERS_PAGE_SIZE } },
    signal,
  }));

  return mapPage(page, toUser);
}
```

- **The page size is sent, even when it equals the backend's default.** The skeleton renders that many
  rows (see `data-fetching-states`), and the page a reader sees does not change size the day the
  backend's default does.
- **An absent param is not sent**, and the backend applies its default — the first page, its default
  sort. The generated type of the query is the list of what may be sent (see `api-client`).
- The whole search object is part of the query's key (see `server-state`), so each page and each
  filter combination is its own cache entry.

## `Paginated<T>`

What the backend's list envelope becomes once unwrapped (the mechanism is `api-client`'s):

```typescript
export type Pagination = ApiPagination;

export type Paginated<T> = {
  items: T[];
  pagination: Pagination;
};

export const FIRST_PAGE = 1;

export const SORT_ORDER_VALUES = ["asc", "desc"] as const;

export type SortOrder = (typeof SORT_ORDER_VALUES)[number];
```

- **`Pagination` is the generated type re-exported, not copied**: `{ total, pages, page, limit, next,
  previous }`, with `next` and `previous` as `number | null`. A component reads it as it arrives and
  compares against `null`, never against a sentinel of its own.
- **`FIRST_PAGE` and `SORT_ORDER_VALUES` live beside it**, once for every list: the backend's list
  query is common to all its endpoints, and its OpenAPI document repeats the parameters per endpoint
  rather than naming a shared schema to generate them from.
- `mapPage(page, toUser)` maps the items and keeps the block, so the mapper stays a function of one
  DTO.

## Sorting

**The fields a list may be sorted by are the backend's whitelist, taken from the generated types** —
never a union typed again:

```typescript
export const USER_SORT_BY_VALUES = pathsApiV1UsersGetParametersQuerySortByValues;

export type UserSortBy = (typeof USER_SORT_BY_VALUES)[number];

export const DEFAULT_USER_SORT: Sort<UserSortBy> = { sortBy: "createdAt", sortOrder: "desc" satisfies SortOrder };
```

**The default sort is the backend's, stated once in the feature's model**, so the column the list is
really sorted by shows as active when the URL says nothing. It is only ever read for display — never
sent — so the list follows the backend if the two disagree, and the constant carries a comment saying
whose default it restates.

The page merges the two, and every header reads the result:

```typescript
const sort: Sort<UserSortBy> = {
  sortBy: search.sortBy ?? DEFAULT_USER_SORT.sortBy,
  sortOrder: search.sortOrder ?? DEFAULT_USER_SORT.sortOrder,
};
```

A change of sort is a change of the list, so it goes through the same updater that resets the page
(see `routing`). Choosing the default order again takes the sort out of the URL instead of spelling
it out, so the request and a link to the plain list stay the same:

```typescript
function changeSort(next: Sort<UserSortBy>): void {
  const isDefault = next.sortBy === DEFAULT_USER_SORT.sortBy && next.sortOrder === DEFAULT_USER_SORT.sortOrder;

  changeList(isDefault ? { sortBy: undefined, sortOrder: undefined } : next);
}
```

## The data table

A list is the catalog's `Table`, composed with two shared pieces. A headless table library adds
nothing while the backend sorts and pages: the rows arrive in order, one page at a time.

- **`SortableTableHead`** is a header cell whose button sorts by its column — ascending first, then
  the other way on each click. The order is announced on the cell with `aria-sort`, so the button's
  accessible name stays the column's name (see `accessibility`). A column the backend cannot sort by
  is a plain `TableHead`.
- **`DataTablePagination`** renders where the reader is and how much there is ("Page 2 of 3 · 25
  results", a plural in every locale with its numbers formatted — see `i18n`), and Previous and
  Next. **Each is disabled when the backend's `previous` or `next` is `null`** — and stays focusable,
  so pressing Next onto the last page does not drop the reader's focus (see `accessibility`) — and
  moves to the page the backend named: whether another page exists is the backend's answer, never
  `page < pages` recomputed here. Its `DataTablePaginationSkeleton` is the same row, rendered beside
  the table's skeleton.

```tsx
<Button
  variant="ghost"
  disabled={next === null}
  onClick={() => {
    if (next !== null) {
      onPageChange(next);
    }
  }}
>
  {t("pagination.next")}
  <ChevronRightIcon aria-hidden="true" data-icon="inline-end" />
</Button>
```

- **Both are buttons that call back, not links.** A shared component cannot type the search params of
  a route it does not know, and the page's updater is what keeps the other params and drops the page
  back to the default.
- **The table has a caption**, visually hidden, which is its accessible name (see `accessibility`).
- Rows link to the resource's detail with the router's `Link`, typed against the route tree.

While the next page loads, the rows on screen stay and the table marks itself busy (see
`data-fetching-states`).

## Filters

A filter is a search param like any other: validated by the route's schema, absent when not set, and
changed through the updater that resets the page.

### A select

**"All" is the select's "nothing selected", not a value.** Its item is `{ value: null, label: t(…) }`
first in the list, the URL's absent param meets the select's `null` in the one attribute that needs
it (`value={status ?? null}`), and the change handler turns anything that is not a catalog member back
into `undefined` (see `code-conventions` for this frontier). The options are the catalog's array,
mapped.

### Text, debounced into the URL

A text filter answers every keystroke, and the URL — with the request it drives — follows once typing
pauses:

```typescript
const searchFilter = useDebouncedFilter(search, (value: string | undefined): void => {
  onChange({ search: value });
});
```

```tsx
<InputGroupInput
  id={searchId}
  type="search"
  maxLength={USER_SEARCH_MAX_LENGTH}
  value={searchFilter.draft}
  onChange={(event) => {
    searchFilter.change(event.target.value);
  }}
/>
```

- **The input shows a draft of its own**, which leads the URL until `FILTER_DEBOUNCE_MS` without a
  keystroke; then the draft is committed. A word typed at speed is one request.
- **Blank is no filter**: the committed value is trimmed, and an empty one is `undefined`, so the URL
  drops the param instead of carrying an empty one.
- **A new value in the URL that is not the echo of the input's own commit replaces the draft** —
  Back, a link, a reset — while an echo leaves alone whatever the reader went on typing. The hook
  decides that while rendering, by comparing against the last value it saw and the last it committed,
  with no effect copying the URL into state (see `code-conventions`); its one effect clears the timer
  when the input unmounts.
- **`maxLength` is the backend's limit**, the same constant the search schema uses, so the reader
  cannot type a term the backend would refuse.
- **Each commit is a navigation, but only the first is a step in the history.** Starting a search
  pushes; refining or clearing it replaces, so Back leaves the search in one step however slowly it
  was typed (the updater is `routing`'s).

## Checklist

- [ ] Every list request sends the validated search params and the page size, and nothing else.
- [ ] Every list query returns `Paginated<T>` through `unwrapPage` and `mapPage`.
- [ ] Every sort field list comes from the generated types, and the backend's default sort is a named
      constant read only for display.
- [ ] Sorting, paging and filtering happen in the backend; no screen sorts, filters or counts rows.
- [ ] Previous and Next are disabled by the backend's `previous` and `next`, and move to them.
- [ ] Every sortable header puts `aria-sort` on the cell, and every table has a caption.
- [ ] Every select filter offers "all" as a `null` item and maps it to an absent param.
- [ ] Every text filter goes through the debounced hook, trims, treats blank as absent, and caps its
      length at the backend's limit.
