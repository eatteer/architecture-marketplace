---
name: error-handling
description: "What the reader sees when something fails — an expected failure (the server's answer, no answer, a refused route) against a bug, where each one surfaces (an error screen in place, a route's error component, a toast, an alert inside a form, nothing), the error toast (priority, auto-close, no ids on screen, copying the full report), the copyable error report, `ErrorState`, the route error component and a retry that really retries, the fullscreen loader for writes, errors a boundary caught, and what a `catch` may end in."
when_to_use: "Trigger on — a failed request with no feedback, a toast that never closes or shows an id, a trace id or an error code on screen, a copy button that copies only part of the error, `showErrorToast`, `ErrorState`, a route's `errorComponent`, a retry button that shows the same error again, a 401 or 403 that toasts, a failed first load that toasts instead of showing an error screen, two toasts for one failure, `meta.errorToast` or `meta.fullscreenLoader`, `useIsMutating`, a loader that covers a skeleton, a reader who navigates away in the middle of a save, `onCaughtError`, an error React logs to the console from a boundary, writing a `catch` block, an empty `catch`, or a `catch` that only logs."
---

# Error handling

A failure is either **expected** — the server's answer, no answer at all, a route the reader's
permissions do not open — or **a bug**. An expected failure is shown to the reader in words they can
act on, and is not reported: the backend already logged it under the trace id the report carries. A
bug is reported (see `observability`) and shown as a generic failure, because its message was written
for developers.

| Failure | Type |
| --- | --- |
| The backend answered with an error, or did not answer | `ApiError` (see `api-client`) |
| A route the session's permissions do not open | `ForbiddenError`, thrown by the route's guard (see `authorization`) |
| Anything else — a mapper reading a missing field, a render that throws | a bug |

## Where each failure surfaces

One failure, one place. Two surfaces for the same failure — a toast over an error screen that says
the same — is noise that teaches the reader to ignore both.

| What failed | The reader sees |
| --- | --- |
| A read that never loaded, resolved in place | Its screen's `ErrorState`, with a retry (see `data-fetching-states`) |
| A read that never loaded, in a route's loader, or a route's guard | The route's error component |
| A read that failed a refetch behind data already on screen | A toast; the data stays |
| A write | A toast, unless its caller shows the failure itself |
| A write from a form | The backend's field errors on the fields; the rest as a toast, or an alert inside the form (below) |
| Any `401` | Nothing: the refresh already failed, and the sign-in page is the explanation (see `authentication`) |
| A bug a boundary caught | The route's error component, generic; and a report |
| A bug nothing caught | A report only |

That table is implemented once, in the query client's caches, so no screen decides it again:

```typescript
queryCache: new QueryCache({
  onError: (error: ApiError, query: Query<unknown, unknown>): void => {
    reportUnexpectedError(error, "query");

    if (query.state.data !== undefined && query.meta?.errorToast !== false) {
      showErrorToast(error);
    }
  },
}),
```

- **A query toasts only when it had data.** A read that never loaded shows its error in place of its
  content; only a failed refetch behind data on screen would otherwise go unnoticed.
- **A mutation toasts unless `meta.errorToast` is `false`**, which is what a caller that places the
  failure itself sets (see `server-state` for `meta`).
- **`showErrorToast` itself refuses a `401`**, whoever calls it: the caches, and a form that places
  its own failure and toasts the rest. A check in the caches alone would let a form toast over the
  redirect to sign-in.

### A form's failure

A form's mutation sets `errorToast: false` and handles the failure in `mutate`'s `onError`: the field
errors the backend named go on their fields (see `forms`), and what no field can carry — the email is
already registered, the connection dropped — goes to one of two places:

- **A toast**, for a form that is one part of a screen: a create or edit form. The reader can read
  it, copy it, and carry on with the fields as they are.
- **An alert inside the form**, for a screen that *is* the form and cannot be left until the failure
  is fixed — sign-in, where "wrong credentials" has to stay beside the fields until the next attempt,
  not close itself after a few seconds. It is cleared when the reader submits again.

## The error toast

```typescript
export function showErrorToast(error: unknown): void {
  if (error instanceof ApiError && error.status === UNAUTHORIZED_STATUS) {
    return;
  }

  const { title, detail } = describeError(error);

  async function copyAndConfirm(): Promise<void> {
    try {
      await copyErrorReport(error);
    } catch {
      return;
    }

    toast.update(toastId, { actionProps: { children: i18n.t("actions.error_copied"), "aria-disabled": true } });
  }

  const toastId = toast.add({
    type: "error",
    priority: "high",
    title,
    description: detail,
    timeout: ERROR_TOAST_TIMEOUT_MS,
    actionProps: {
      children: i18n.t("actions.copy_error"),
      onClick: (): void => {
        void copyAndConfirm();
      },
    },
  });
}
```

- **The words are the server's when it gave them** — already translated into the reader's language —
  and a generic sentence otherwise (`describeError`). A bug's message is never shown.
- **It closes on its own** after `ERROR_TOAST_TIMEOUT_MS` — long enough to read a sentence and reach
  for the button, short enough not to pile up. Hovering holds it open.
- **No id, trace id or error code on screen.** They mean nothing to the reader, and the report
  carries them for whoever needs them.
- **"Copy error" copies the whole report**, and its label turns into "Copied", disabled — with
  `aria-disabled`, since a natively disabled button drops the focus of whoever just pressed it (see
  `accessibility`). If the browser refuses the clipboard, the label stays "Copy error", which is the
  truth.
- **`priority: "high"`**: an error is announced assertively. The toast library then hides the visual
  toast from assistive technology and announces it from its own alert region, so a test finds it by
  its `alert` role and its buttons among hidden elements.

The toaster is mounted once, beside the router (see `project-bootstrap`), and takes its close button's
label from the translations. It paints with the theme's tokens, so it follows the theme with no wiring.

## The error report

What "Copy error" puts on the clipboard, in the toast and in `ErrorState` alike, so a reader who
copies either sends the same thing:

```json
{
  "method": "POST",
  "url": "https://api.example.com/api/v1/users",
  "status": 409,
  "code": "users.email_already_registered",
  "title": "Conflict",
  "detail": "The email is already registered",
  "errors": [],
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "timestamp": "2026-09-26T18:04:11.000Z"
}
```

An `ApiError` builds it with `toReport()`. A bug has no server answer to report, so its report is its
`name`, its `message` and the time — never its stack, which says nothing to the person it is pasted
to and may say too much about the code.

## Error screens

**`ErrorState` is what a screen shows in place of content that failed to load**: the same title and
detail as the toast, a retry when the caller passes one, and "Copy error". It has `role="alert"`, so
a failure that replaces content while the reader waits is announced. Every screen uses it; no feature
writes its own.

**The route's error component** is registered as the router's default and receives whatever a guard,
a loader or a component threw:

```tsx
export function RouteError({ error }: ErrorComponentProps): JSX.Element {
  const router = useRouter();

  const queryErrorResetBoundary = useQueryErrorResetBoundary();

  useEffect((): void => {
    queryErrorResetBoundary.reset();
  }, [queryErrorResetBoundary]);

  if (isForbidden(error)) {
    return <Forbidden />;
  }

  if (error instanceof ApiError && error.status === NOT_FOUND_STATUS) {
    return <NotFound />;
  }

  return (
    <ErrorState
      error={error}
      onRetry={() => {
        void router.invalidate();
      }}
    />
  );
}
```

- **A refusal and a missing resource get the pages that say so**, whether the route decided it or the
  API did: a `ForbiddenError` or a `403` shows `Forbidden`, a `404` shows `NotFound`. Neither has a
  retry; asking again changes nothing.
- **Anything else can be retried, and the retry is real.** The query error boundary is reset, so the
  failed queries lose their error state, and `router.invalidate()` runs the route's loaders again. A
  retry that only re-renders shows the same error from the cache.

## The fullscreen loader is for writes

**While a write is in flight the screen is blocked**, so nobody submits twice or navigates away from
a half-finished change. **A read never blocks**: it shows a skeleton where its content goes, and a
fullscreen loader over it would hide exactly what the skeleton is for.

```tsx
export function FullscreenLoader(): JSX.Element | null {
  const { t } = useTranslation();

  const pendingMutations = useIsMutating({
    predicate: (mutation: Mutation): boolean => mutation.meta?.fullscreenLoader !== false,
  });

  if (pendingMutations === 0) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-background/60 backdrop-blur-sm">
      <Spinner className="size-8" aria-label={t("loader.saving")} />
    </div>
  );
}
```

It is mounted once, beside the router, and counts every pending mutation except those that opt out
with `meta.fullscreenLoader: false` — a write the reader should not wait on, like a language switch
whose result is already on screen. Because a mutation's invalidation is returned (see
`server-state`), the loader stays up until the lists behind it know they are out of date.

## Errors a boundary caught

React hands every error an error boundary caught to the root's `onCaughtError`, and by default writes
it to the console. The boundary already shows it; what is left is to report it if it is a bug:

```typescript
export function handleCaughtError(error: unknown): void {
  reportUnexpectedError(error, "boundary");
}
```

It is passed to `createRoot` (see `project-bootstrap`) and to every render in the tests, where a
console line would fail the suite (see `testing`).

## What a `catch` may end in

A `catch` ends in one of three things, and each is visible in its body:

- **It rethrows** what it cannot handle — everything but the one case it was written for.
- **It turns the failure into an answer the caller expects.** A session read refused with a `401` is
  "nobody signed in", so it returns `null`; any other failure is rethrown.
- **It turns the failure into state the reader sees** — the clipboard refused, so the button keeps
  offering to copy.

```typescript
try {
  await copyErrorReport(error);
} catch {
  // The browser refused the clipboard; the button keeps offering to copy.
  return;
}
```

A `catch` without a binding is for a failure whose content changes nothing, and it says why in a
comment. A `catch` that only logs is not one of the three: there is no `console`, and a failure
nobody sees is a failure nobody fixes.

## Checklist

- [ ] Every failure has exactly one surface from the table, and no screen decides a toast the caches
      already decide.
- [ ] Every mutation whose caller shows the failure sets `meta.errorToast: false`, and that caller
      places field errors on fields and the rest in a toast or an alert inside the form.
- [ ] No `401` toasts.
- [ ] The error toast closes on its own, shows no id or code, and copies the full report.
- [ ] Every screen that shows a failed read uses `ErrorState`.
- [ ] The route's error component shows `Forbidden` for a refusal and `NotFound` for a `404`, and its
      retry resets the query errors and invalidates the router.
- [ ] Only writes show the fullscreen loader, and a write the reader should not wait on opts out.
- [ ] `onCaughtError` reports through the error port, in the application and in the tests.
- [ ] Every `catch` rethrows, returns an answer the caller expects, or sets state the reader sees.
