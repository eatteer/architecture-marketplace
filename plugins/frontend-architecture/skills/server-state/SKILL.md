---
name: server-state
description: "Server state with TanStack Query — the query client's defaults (stale time, retry that skips every 4xx), registering `ApiError` and the `meta` types, query options factories with hierarchical keys, the type a factory declares, per-query cache policy, reading from a component and from a route, mutation hooks and what each invalidates, returning the invalidation, cache work in the hook and screen work in `mutate`'s callbacks, optimistic updates with a rollback, and `setQueryData` without mutating."
when_to_use: "Trigger on — writing `useQuery`, `useMutation`, `queryOptions`, a query key, a `*-queries.ts` or `*-mutations.ts` file, invalidating after a write, a list that still shows a deleted row, a screen that shows stale data after a save, a key string duplicated across files, a query key missing a variable, choosing `staleTime`, a 404 that takes seconds to appear because it is retried, `retry`, declaring the `meta` types, `mutate` vs `mutateAsync`, a callback that runs after the component unmounted, an optimistic update, `onMutate`, `setQueryData` or `getQueryData`, `ensureQueryData` vs `fetchQuery`, a `Register` declaration, or copying query data into `useState`."
---

# Server state

What the backend holds is the query cache's, and nothing else keeps a copy: a component reads it
through a query, changes it through a mutation, and never mirrors it into its own state — a copy is
stale the moment the next refetch lands.

## The query client

```typescript
declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError;
    queryMeta: QueryMeta;
    mutationMeta: MutationMeta;
  }
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: DEFAULT_STALE_TIME_MS,
        retry: shouldRetryQuery,
      },
    },
    queryCache: new QueryCache({ onError: onQueryError }),
    mutationCache: new MutationCache({ onError: onMutationError }),
  });
}
```

- **`defaultError: ApiError`**, because that is what the client throws (see `api-client`). Every
  `error` a query or mutation hands back is typed without a cast. Something else can still arrive — a
  mapper reading a field the response lacks throws a `TypeError` — and that is a bug the caches
  report (see `observability`).
- **`meta` is typed**, so a misspelled option is a compile error. There are exactly the options the
  application reads:

  ```typescript
  export type QueryMeta = {
    errorToast?: boolean;
  };

  export type MutationMeta = {
    errorToast?: boolean;
    fullscreenLoader?: boolean;
  };
  ```

  What each one turns off is `error-handling`'s; the rule here is that a query or mutation says it
  through `meta`, and the caches decide, in one place.
- **`staleTime` is `0` by default.** Other people change this data, and a reader returning to a
  screen should see its current state — a remount goes back to the network. A query over data that
  only changes through events the application sees sets its own, higher value.
- **No retry for a 4xx**, and at most two for the rest. A 4xx describes the request, so repeating it
  only delays the same answer — a 404 retried three times with backoff takes seconds to reach the
  screen.

  ```typescript
  export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
    if (error instanceof ApiError && error.isClientError) {
      return false;
    }

    return failureCount < MAX_QUERY_RETRIES;
  }
  ```

  Mutations are never retried: a write that may have reached the server is not the client's to
  repeat.

## Query options factories

A feature's reads are one object of `queryOptions` factories in its `-queries.ts`, and every reader
— a component, a loader, a guard, an invalidation — goes through it. There is no key string anywhere
else.

```typescript
type UsersKey = readonly ["users"];
type UserListsKey = readonly ["users", "list"];
type UserListKey = readonly ["users", "list", UsersSearch];
type UserDetailKey = readonly ["users", "detail", string];

export const userQueries = {
  all: (): UsersKey => ["users"],
  lists: (): UserListsKey => [...userQueries.all(), "list"],
  list: (search: UsersSearch): AppQueryOptions<Paginated<User>, UserListKey> => queryOptions({
    queryKey: [...userQueries.lists(), search] as const,
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<Paginated<User>> => fetchUsers(search, signal),
    placeholderData: keepPreviousData,
  }),
  detail: (id: string): AppQueryOptions<User, UserDetailKey> => queryOptions({
    queryKey: [...userQueries.all(), "detail", id] as const,
    queryFn: ({ signal }: { signal: AbortSignal }): Promise<User> => fetchUser(id, signal),
  }),
};
```

- **Keys nest from the feature down** — the feature, then the kind of read, then its arguments — so
  an invalidation names exactly the level a change touched: every list after a create, everything
  about the feature after an edit.
- **The key holds every value the query function reads.** Two searches that share a key share a
  cache entry, and the second shows the first's rows. The query lint plugin reports a variable the
  function reads and the key lacks.
- **A factory declares its return type with the shared `AppQueryOptions<TData, TKey>`**, which spells
  out once what `queryOptions()` returns. The key then carries the data type, so every `useQuery`,
  `getQueryData` and `setQueryData` over it is typed without a cast.
- **A read that exists once is a constant, not a factory** — the session, which has no arguments:
  `export const sessionQuery = queryOptions({ … })`.
- **Cache policy is per query, beside its key**: `staleTime: Number.POSITIVE_INFINITY` for data that
  changes only with events the application handles itself (the session changes with a sign-in, a
  sign-out or a refresh, and each updates it), and `placeholderData: keepPreviousData` for a list
  whose key changes with its filters, so the page on screen stays while the next one loads (see
  `data-fetching-states` for what the screen shows meanwhile).

### Reading

- **In a component**: `useQuery(userQueries.list(search))`, named for what it reads (see
  `code-conventions`). How the screen renders its states is `data-fetching-states`'.
- **In a route's loader or guard**: `context.queryClient.ensureQueryData(userQueries.detail(id))`,
  which answers from the cache when it can, so a page the reader already visited opens without a
  request. Whether a route loads before it renders is `routing`'s and `data-fetching-states`'.
- **To force the network**, `fetchQuery({ ...sessionQuery, staleTime: 0 })` — after a sign-in, when
  the cached answer is known to be wrong.

A query function never runs as a side effect of rendering anything else, and a component never calls
the API client directly.

## Mutations

Each write is a hook in the feature's `-mutations.ts`, returning `useMutation`'s result with its
types spelled out:

```typescript
export function useCreateUser(): UseMutationResult<string, ApiError, CreateUserValues> {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createUser,
    meta: { errorToast: false },
    onSuccess: (): Promise<void> => queryClient.invalidateQueries({ queryKey: userQueries.lists() }),
  });
}
```

- **The mutation function resolves to what its caller needs next** — the new resource's id, to
  navigate to it — and nothing else.
- **The invalidation is returned, never fired and forgotten.** A mutation settles when its
  `onSuccess` settles, so returning the promise keeps it pending — and the fullscreen loader up —
  until every list knows it is out of date. A `void` invalidation lets the reader land on a list
  that still shows the old rows.
- **Invalidate the narrowest level that covers the change**, through the factory: a create changes
  the lists and no detail; an edit changes the detail and every list that shows it, which is the
  whole feature. A write that changes something another feature caches — the signed-in account's own
  email — invalidates that too:

  ```typescript
  onSuccess: async (): Promise<void> => {
    const isOwnAccount = queryClient.getQueryData(sessionQuery.queryKey)?.user.id === id;

    await Promise.all([
      queryClient.invalidateQueries({ queryKey: userQueries.all() }),
      isOwnAccount ? queryClient.invalidateQueries({ queryKey: sessionQuery.queryKey }) : undefined,
    ]);
  },
  ```

- **Cache work goes in the hook; screen work goes in `mutate`'s own callbacks.** The hook's
  `onSuccess` runs even if the component that called `mutate` has unmounted, which is what an
  invalidation needs. Navigating, placing errors on a form's fields and releasing a submit latch
  belong to the screen, and a callback passed to `mutate` does not run once that screen is gone —
  which is also what they need:

  ```typescript
  createUser.mutate(values, {
    onSuccess: onCreated,
    onSettled: (): void => {
      isSubmitting.current = false;
    },
  });
  ```

- **`mutate`, not `mutateAsync`.** A failed mutation already reaches the mutation cache, which
  decides whether it toasts; `mutateAsync` also rejects the promise it returns, and a caller that
  does not catch it has an unhandled rejection on every failure.
- **A write the reader should not wait on says so in `meta`** (`fullscreenLoader: false`), and a
  caller that shows the failure itself says `errorToast: false` (see `error-handling`).

### Optimistic updates

When the screen should change before the backend answers — a language switch, a toggle — the hook
does it in `onMutate`, returns what it needs to undo it, and undoes it in `onError`:

```typescript
onMutate: async (language: LanguageValue): Promise<LanguageRollback> => {
  const previous = queryClient.getQueryData(sessionQuery.queryKey)?.user.preferredLanguage;

  setSessionLanguage(queryClient, language);

  await changeLanguage(language);

  return { previous };
},
onError: async (_error: ApiError, _language: LanguageValue, rollback: LanguageRollback | undefined): Promise<void> => {
  if (rollback?.previous === undefined) {
    return;
  }

  setSessionLanguage(queryClient, rollback.previous);

  await changeLanguage(rollback.previous);
},
```

The failure is still announced — the cache toasts it — so the reader sees why the change went back.
An optimistic update is for a write that almost always succeeds and is cheap to undo; one that
creates something is never optimistic.

**`setQueryData` takes an updater that returns a new object**, never the cached one edited in place
(see `code-conventions`): the cache compares by reference, and an edited object is one no observer
is told about.

```typescript
queryClient.setQueryData(
  sessionQuery.queryKey,
  (session: Session | null | undefined): Session | null | undefined => session
    ? { ...session, user: { ...session.user, preferredLanguage } }
    : session,
);
```

## Checklist

- [ ] The query client registers `ApiError` and the `meta` types, keeps `staleTime` at `0` by
      default, and retries no 4xx.
- [ ] Every read goes through its feature's options factory, and no key is written anywhere else.
- [ ] Every key nests from the feature down and holds every value its function reads.
- [ ] Every factory declares `AppQueryOptions<TData, TKey>` as its return type.
- [ ] Every non-default `staleTime` or `placeholderData` sits on the query it applies to.
- [ ] Every mutation hook spells out `UseMutationResult<TData, ApiError, TVariables>`.
- [ ] Every mutation's `onSuccess` returns or awaits its invalidations, through the factory, at the
      narrowest level that covers the change.
- [ ] Navigation, form errors and latches live in `mutate`'s callbacks; cache work lives in the hook.
- [ ] No `mutateAsync`, and no query data copied into component state.
- [ ] Every optimistic update returns a rollback from `onMutate` and applies it in `onError`.
