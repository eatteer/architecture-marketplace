---
name: authentication
description: "The browser's session against the backend's cookies — HttpOnly cookies the page never reads, the session read from `GET /auth/session` as a query that answers `null` for nobody signed in, the refresh on a 401 from a middleware registered last, run once per tab and once across tabs with Web Locks, the requests that never refresh, a refresh that fails for another reason, session events between tabs over `BroadcastChannel`, the one component where a session ends and the cache is cleared, sign-in and sign-out, the guard of the signed-in layout, redirect-back and the only targets it follows."
when_to_use: "Trigger on — sign-in, sign-out, the session, `/auth/session`, `/auth/login`, `/auth/refresh` or `/auth/logout`, `sessionQuery`, a token in `localStorage` or decoding a JWT, `accessTokenExpiresAt`, a 401 after the access token expired, a reader signed out when two tabs refreshed at once, `navigator.locks`, `BroadcastChannel`, a tab that stays signed in after another signed out, data of the previous account visible after signing in as another, `queryClient.clear()`, `requireSession`, the `?redirect=` parameter, an open redirect after sign-in, `SessionSync`, `useSessionUser`, a sign-in page shown to someone already signed in, or a visitor whose first page sends a 401 and a refresh."
---

# Authentication

The backend keeps the session in **HttpOnly cookies**: an access token that lasts minutes and a
refresh token, sent only to the auth routes, that rotates on every use. The page never sees either.
It asks the backend who is signed in, refreshes when a request says the access token expired, and
keeps every tab in step, because the cookies are shared by all of them.

## The page never holds a token

- **No token in `localStorage`, `sessionStorage` or memory, and no JWT decoded in the browser.** A
  token a script can read is a token an injected script can send elsewhere; an HttpOnly cookie is out
  of every script's reach.
- **Sign-in uses the backend's cookie transport**, its default, and reads nothing from the body.
- **Every request sends the cookies** because the client asks for them (`credentials: "include"`, see
  `api-client`), and the two origins are same-site so the browser has them at all (see
  `configuration`).

## Who is signed in

The session is a query over `GET /auth/session`, which answers with the user, the permissions the
access token carries and when it expires:

```typescript
async function fetchSession(signal: AbortSignal): Promise<Session | null> {
  try {
    const session = toSession(unwrap(await apiClient.GET("/api/v1/auth/session", { signal })));

    await changeLanguage(session.user.preferredLanguage);

    return session;
  } catch (error: unknown) {
    if (error instanceof ApiError && error.status === UNAUTHORIZED_STATUS) {
      return null;
    }

    throw error;
  }
}

export const sessionQuery = queryOptions({
  queryKey: ["auth", "session"],
  queryFn: ({ signal }: { signal: AbortSignal }): Promise<Session | null> => fetchSession(signal),
  staleTime: Number.POSITIVE_INFINITY,
});
```

- **A 401 is an answer, not a failure**: it reaches this function only after the refresh was refused
  too, so it means nobody is signed in, and the query resolves `null` — a query cannot resolve
  `undefined` (see `code-conventions`). Any other failure is rethrown and shown as one.
- **One constant, not a factory**: there is one session per tab (see `server-state`).
- **`staleTime: Infinity`**: the session changes only through a sign-in, a sign-out, a refresh or an
  edit of the account, and each of them updates or invalidates it.
- **The account's language is applied here**, where every read of the session lands (see `i18n`).
- **Permissions come from this answer**, never from a token (see `authorization`). The mapper keeps
  the user's own fields and the permissions, and leaves `accessTokenExpiresAt` behind: the refresh
  is reactive, so nothing reads it (see `api-client` on fields nobody reads).

Components read the user with `useSessionUser()`. Under the signed-in layout the guard already put
the session in the cache, so it answers on the first render — and it tolerates `null`, because
signing out empties the session a moment before the page is left.

## Refresh on a 401

An expired access token answers `401`, the same as no token. The client's last middleware catches
that 401 before it becomes an `ApiError`, refreshes, and sends the request again (the order of the
middlewares is `api-client`'s):

- **It keeps a clone of each request as it leaves**, with the time it was sent: `fetch` consumes the
  body of the one that went out, and the client hands the response hook that same consumed request.
- **The replay goes straight to the network**, past every middleware, so a second 401 is final instead
  of another refresh.
- **The auth routes never refresh**: a 401 from sign-in is wrong credentials, from the refresh is a
  refused token, from sign-out is nothing to undo. `/auth/session` does refresh — it is an ordinary
  read.

```typescript
const NON_REFRESHING_PATHS: ReadonlySet<string> = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/refresh",
  "/api/v1/auth/logout",
] satisfies (keyof paths)[]);
```

### Once, across every tab

**A refresh token is good for exactly one use.** The backend treats a second presentation as theft and
revokes the whole sign-in, so two tabs — or two requests in one tab — refreshing together sign the
reader out. The coordinator makes the refresh run once however many requests hit the expired token:

```typescript
export function createRefreshCoordinator(refresh: () => Promise<unknown>): (sentAt: number) => Promise<RefreshOutcome> {
  let inFlight: Promise<RefreshOutcome> | undefined;

  async function refreshUnlessDone(sentAt: number): Promise<RefreshOutcome> {
    if (readLastRefreshAt() > sentAt) {
      return "refreshed";
    }

    try {
      await refresh();
    } catch (error: unknown) {
      if (error instanceof ApiError && error.status === UNAUTHORIZED_STATUS) {
        publishSessionEvent({ type: "signed-out", reason: "expired" });

        return "ended";
      }

      throw error;
    }

    localStorage.setItem(LAST_REFRESH_STORAGE_KEY, String(Date.now()));

    publishSessionEvent({ type: "refreshed" });

    return "refreshed";
  }

  return (sentAt: number): Promise<RefreshOutcome> => {
    inFlight ??= runExclusively((): Promise<RefreshOutcome> => refreshUnlessDone(sentAt)).finally((): void => {
      inFlight = undefined;
    });

    return inFlight;
  };
}
```

- **Within a tab, callers share the promise in flight** — a promise, not a flag, so each waits for
  the same outcome.
- **Across tabs, `navigator.locks.request` queues them.** Whoever gets the lock after another tab
  refreshed finds a refresh newer than its own request — the time is in `localStorage`, which every
  tab reads — and only sends its request again.
- **The same check covers a 401 that arrives after this tab already refreshed**: that request left
  with the old cookie, and a new refresh would present a token already spent.
- **A refused refresh ends the session** and lets the original 401 through. **Any other failure — no
  connection, a 429, a 5xx — is propagated as it is**: a dropped connection is not a reason to sign
  anyone out.
- A browser without Web Locks, and the test environment, get the refresh once per tab.

A visitor who is not signed in pays a 401 on the session and a 401 on the refresh on every load: the
page cannot know whether a refresh cookie exists, because it cannot read the cookies.

## Session events between tabs

Every change to the session is published as an event — `signed-in`, `signed-out` (with the reason:
the reader chose to, or the refresh was refused), `refreshed`, and `updated` when the account's own
settings changed. A local bus delivers it to this tab and a `BroadcastChannel` to the others, with
`isRemote` telling the listener which; a message from another tab is validated before it is used,
like any input. A browser without `BroadcastChannel` keeps each tab to itself, and each finds out on
its next request.

## One component where a session ends

`SessionSync`, mounted at the root so it listens on every page — the sign-in page included — is the
only place that reacts to those events:

| Event | What this tab does |
| --- | --- |
| `refreshed` | Invalidates the session (new permissions, new expiry) with `cancelRefetch: false`: a read already under way is the request that triggered the refresh, and it comes back with the new session |
| `updated`, from another tab | Invalidates the session the same way; its own change is already in its cache |
| `signed-in`, from another tab | Fetches the session and invalidates the router, so a tab sitting on sign-in follows to where it was going. Fetched, not reset: a reset cancels a read a route guard may be waiting on |
| `signed-out` | Leaves the session (below) |

**Leaving a session empties everything the previous account saw:**

```typescript
queryClient.setQueryData(sessionKey, null);

await router.navigate({ to: "/sign-in", search: { redirect } });

queryClient.clear();
queryClient.setQueryData(sessionKey, null);
```

- **The session is emptied first**, so the sign-in page's guard does not send the reader straight
  back; **the rest of the cache only once the page is left**, so the screen going away does not
  refetch what was just removed. Nothing of one account survives for the next one to see.
- **A tab that had no session does nothing** — a visitor whose first request was refused all the way
  down, another tab's sign-out seen from the sign-in page.
- **The reader comes back to the page they were on, unless they chose to leave it**: a sign-out made
  in this tab goes to sign-in with no redirect; an expiry, or a sign-out in another tab, keeps where
  the reader was.

## Sign-in and sign-out

- **`useSignIn`** posts the credentials with `meta.errorToast: false` — the form shows wrong
  credentials beside the fields (see `forms` and `error-handling`) — and in `onSuccess` **awaits**
  `fetchQuery({ ...sessionQuery, staleTime: ALWAYS_STALE_MS })` before publishing `signed-in`, so the
  page the reader goes to next finds the session in the cache.
- **`useSignOut`** posts to logout — which the backend always answers `204` — and publishes
  `signed-out`. It navigates nowhere and clears nothing itself: `SessionSync` does, as for every other
  way a session ends.

## The signed-in layout's guard

Every page that needs a session is under one layout whose `beforeLoad` reads it (the lifecycle is
`routing`'s):

```typescript
export async function requireSession({ context, location }: GuardInput): Promise<{ session: Session }> {
  const session = await context.queryClient.ensureQueryData(sessionQuery);

  if (session === null) {
    // eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's control flow: a thrown redirect is how `beforeLoad` navigates.
    throw redirect({ to: "/sign-in", search: { redirect: location.href } });
  }

  return { session };
}
```

It returns `{ session }` into the context of every route below, whose permission guards read it from
there. The sign-in page is outside the layout, and its own `beforeLoad` sends someone already signed
in on to where they were going.

## Redirect-back

The page the reader asked for travels in `?redirect=`, validated as an optional string by the sign-in
route. **It arrives in the URL, which anyone can write**, so only a path on this site is followed:

```typescript
export function resolveRedirect(redirect: string | undefined): string {
  if (redirect === undefined || !redirect.startsWith("/") || redirect.startsWith("//") || redirect.startsWith("/\\")) {
    return HOME_PATH;
  }

  return redirect;
}
```

`//evil.example` and `/\evil.example` are other sites to a browser, and an absolute URL is one too.
Anything but a path of this site goes home. The redirect is followed with `replace`, so Back does not
return to the sign-in page.

## Checklist

- [ ] No token is stored or decoded in the browser; sign-in uses the cookie transport.
- [ ] The session is one query over `/auth/session` that resolves `null` on a 401 and rethrows the
      rest.
- [ ] The refresh middleware skips the auth routes, replays a clone past the middlewares, and runs
      through a coordinator that is single-flight in the tab and locked across tabs.
- [ ] Only a 401 from the refresh ends the session; any other failure propagates.
- [ ] Every change to the session is published as an event, and messages from other tabs are
      validated.
- [ ] Only `SessionSync` navigates away from an ended session and clears the cache, emptying the
      session before navigating and the cache after.
- [ ] Sign-in awaits the session before publishing; sign-out only publishes.
- [ ] Every signed-in page is under the layout whose `beforeLoad` requires the session.
- [ ] Every redirect target goes through `resolveRedirect`.
