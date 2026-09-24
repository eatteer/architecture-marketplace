---
name: pagination
description: "Paged list endpoints — the shared `ListQuery` and `ListQueryDTO`, the `Paginated<T>` result and its metadata, paging in the database rather than in memory, optional filters, the sortable-field whitelist and the stable tiebreaker, the cost of a total count, offset versus cursor paging, and denormalizing a field so a filter or aggregation can use an index."
when_to_use: "Trigger on — adding a list endpoint, adding a filter or a sort option to a query, extending `ListQuery` or `ListQueryDTO`, building a `Paginated<T>`, a page whose items repeat or vanish when you page through it, a list endpoint that gets slower the deeper you page, an aggregation over a field stored inside a related document, a filter the API documents and the query ignores."
---

# Pagination

Every list endpoint is paged. An endpoint that returns everything works until the collection grows,
and then it fails on the one request that mattered.

## The shared shapes

```typescript
export const SORT_ORDER_VALUES = ["asc", "desc"] as const;

export type SortOrderValue = (typeof SORT_ORDER_VALUES)[number];

export type ListQuery = {
  page: number;
  limit: number;
  ids?: string[];
  createdAtFrom?: Date;
  createdAtTo?: Date;
  sortOrder?: SortOrderValue;
};
```

A feature extends it with its own filters in the repository interface (see `domain-modeling`), and
the query DTO extends the shared `ListQueryDTO` with the matching validators (see
`presentation-layer`).

**The command extends a shared base too, and the controller maps the shared fields through one
helper.** Four places list these fields — the DTO, the command, the repository query, the mapping
between them — and a field missing from any one of them is a filter the API documents, validates and
then ignores:

```typescript
export abstract class ListQueryCommand implements ListQuery {
  /* page, limit, ids, createdAtFrom, createdAtTo, sortOrder */
}

export class GetUsersQueryCommand extends ListQueryCommand {
  public constructor(props: ListQueryCommandProps & { search?: string; status?: UserStatusValue }) {
    super(props);
    /* ... */
  }
}
```

```typescript
// controller — the shared fields are never spelled out per endpoint
new GetUsersQueryCommand({
  ...listQueryFrom(query),
  search: query.search,
  status: query.status as UserStatusValue | undefined,
});
```

Spelled out per endpoint, a field goes missing and nobody notices: the parameter is accepted,
validated, documented in the OpenAPI spec, and dropped. Nothing fails — the endpoint just answers as
though the filter were not there, which reads as a database problem rather than a wiring one. With
the helper, a new shared filter reaches every listing by construction. The `status` cast is the
controller's sanctioned narrowing of a validated DTO field (see the `code-conventions` skill).

`limit` carries a maximum. Without one, a caller asking for a million rows is a denial of service
anyone can trigger with a URL.

```typescript
export class Paginated<T> {
  public readonly data: T[];
  public readonly pagination: Pagination;

  public constructor(props: { items: T[]; total: number; page: number; limit: number }) {
    const pages = Math.ceil(props.total / props.limit);

    this.data = props.items;

    this.pagination = {
      total: props.total,
      pages,
      page: props.page,
      limit: props.limit,
      next: props.page < pages ? props.page + 1 : undefined,
      previous: props.page > 1 ? props.page - 1 : undefined,
    };
  }

  public map<U>(mapper: (item: T) => U): Paginated<U> {
    /* rebuilds with the same metadata */
  }
}
```

`map` is what lets the controller turn `Paginated<User>` into `Paginated<UserDTO>` without
recomputing the metadata — recomputing it is where a page count drifts from the data it describes.
The controller hands the mapped page to the shared paginated response builder, which puts the items
under `data` and the metadata under `pagination` (see the `presentation-layer` skill).

## Page in the database

```typescript
const documents = await this._userModel
  .find(filter)
  .sort(sort)
  .skip((page - 1) * limit)
  .limit(limit)
  .session(sessionOf(transaction))
  .lean<UserSchema[]>()
  .exec();

const total = await this._userModel.countDocuments(filter).session(sessionOf(transaction)).exec();
```

**Never load a collection and slice it in the use case.** The database is the only component that
can answer "rows 40 to 60" without reading the other rows; doing it in memory moves the whole
collection across the wire to throw most of it away.

The two queries run one after the other, not under `Promise.all` — the `persistence-layer` skill
owns why.

## Filters

A filter is optional, and absent means "do not filter on it"; how the guard tests for absence, and
the rest of filter building, belong to the `persistence-layer` skill.

Every filter combination that a real screen uses needs an index behind it. A filter nobody can reach
from the product does not need one — and does not need to exist.

## Sorting

`sortBy` comes from a whitelist declared with the repository interface. An unconstrained sort field
lets a caller sort by anything, including unindexed fields, which turns a fast endpoint into a
collection scan from a query string.

**Every value in that whitelist is a promise about an index.** A sort the endpoint offers and no
index covers is a scan plus an in-memory sort, which does not degrade gently — it fails outright
once the result exceeds the sort buffer. Adding a sort option means adding an index, or the option
does not exist. See the `persistence-layer` skill for the shape those indexes take.

**Sort by a non-unique field always carries a tiebreaker.** Without one, the database is free to
order equal values differently between two queries, so an item can appear on both page 1 and page 2
while another appears on neither:

```typescript
const sort: Record<string, 1 | -1> = { status: direction, _id: direction };
```

This is the bug behind "the list sometimes skips a row" and it is invisible in any dataset small
enough to fit on one page.

When the stored path differs from the field name the API exposes, map it in the repository:

```typescript
const SORT_FIELD_PATHS: Record<UserSortBy, string> = {
  createdAt: "createdAt",
  name: "profile.displayName",
};
```

The storage layout stays inside the repository, and renaming a nested path is not an API change.

## The cost of `total`

A total count reads the whole matching set. On a large collection with a selective filter it is
cheap; on a large collection with a broad one it is the most expensive part of the request.

- Keep it while the collection is small enough for it not to matter, which is most of the time.
- When it stops being cheap, the options are an approximate count, a cached count, or dropping the
  total and giving the client `next`/`previous` only. Say which one the endpoint does, because a UI
  built on "page 1 of 40" cannot be given an approximate 40 without warning.

## Offset or cursor

Offset paging — `skip`/`limit` — is the default: it supports jumping to a page, which is what an
admin table needs.

It degrades with depth. `skip(100000)` makes the database walk a hundred thousand rows to discard
them, so page 1 is fast and page 2000 times out. It is also unstable under writes: a row inserted
while the user pages shifts everything down by one.

**Cursor paging** — "give me the items after this key" — is constant-cost at any depth and stable
under inserts, but it cannot jump to an arbitrary page. Reach for it for an infinite scroll, an
export, or any list a client walks end to end.

Pick one per endpoint and say so in its documentation. An endpoint that accepts both is two
endpoints wearing one name.

## Denormalizing for a filter

Filtering or grouping by a field that lives in a related document cannot use an index: the database
has to resolve the relation for every candidate row first. The fix is to copy the field onto the
document being queried.

1. Add the field to the schema with a default, and backfill (see the `persistence-layer` skill).
2. Set it wherever the aggregate is created or the source value changes — through the entity's own
   method, so it cannot be forgotten and cannot drift.
3. Index it, alongside whatever it is usually combined with.
4. Filter and group on the local field.

The trade is a copy that must be maintained, so **do not denormalize speculatively**. Do it when a
real query is slow, for that query. The same reasoning applies to a discriminator derived from two
fields: computing it inside the query means no index can serve it, while storing it means one can.

## Checklist

- [ ] Every list endpoint is paged, with a maximum `limit`.
- [ ] Paging happens in the database; nothing is sliced in memory.
- [ ] `sortBy` is whitelisted, and every non-unique sort carries a tiebreaker.
- [ ] The command extends the shared list command, and the controller maps the shared fields
      through one helper rather than field by field.
- [ ] Storage paths are mapped inside the repository, not exposed as sort field names.
- [ ] The endpoint's paging style is offset or cursor, not both.
- [ ] Every denormalized field is maintained by the entity and justified by a real query.
