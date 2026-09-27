---
name: observability
description: "What the running application tells the team — the W3C trace context every request starts and where its trace id ends up (the backend's logs, the copyable error report), the error-reporter port and where errors surface from, the filter that keeps expected failures out of it, the root and the query caches reporting through it, uncaught errors and unhandled rejections reported once, the console as the provider when none is installed, and the Web Vitals port."
when_to_use: "Trigger on — `traceparent`, `x-trace-id`, a trace id the backend's logs cannot find, installing Sentry, Datadog or another error or analytics provider, `setErrorReporter`, `reportUnexpectedError`, `reportUncaughtErrors`, `window.onerror` or `unhandledrejection`, an error reported twice or never, a failed request sent to the error tracker, the `console.error` in the reporter, a bug inside a query function that only shows a generic toast, Web Vitals, LCP, CLS or INP, the `web-vitals` package, or `setWebVitalsReporter`."
---

# Observability

A browser application tells the team two things: **what went wrong that nobody expected**, and **how
fast the page is for the people using it**. Each goes through a port — a function type the
application calls and a provider implements — so the provider is chosen by installing it, and no code
outside the port knows which one it is.

What the team learns about an **expected** failure — the backend's answer — it learns from the
backend, which logged it under the trace id the request carried.

## The trace every request starts

Every request carries a W3C `traceparent` the browser generates — a random trace id and span id,
sampled — unless one is already set (the client's middleware attaches it; see `api-client`):

```typescript
export function createTraceparent(): string {
  return [TRACEPARENT_VERSION, randomHex(TRACE_ID_BYTES), randomHex(SPAN_ID_BYTES), SAMPLED_FLAGS].join("-");
}
```

- **The backend continues that trace instead of starting its own**, so the id in its logs is one the
  browser already knows.
- **The trace id reaches the copyable error report** (see `error-handling`): the backend's
  `x-trace-id` header, then the `traceId` in its body, then the one the request's own `traceparent`
  carried — so even a request that never got an answer has an id to search the backend's logs for.
- **The id is never shown on screen**; the report carries it for whoever the reader sends it to.

## The error-reporter port

```typescript
export type ErrorSource = "boundary" | "query" | "uncaught" | "unhandled-rejection";

export type ErrorReporter = (error: unknown, source: ErrorSource) => void;

export function isExpectedError(error: unknown): boolean {
  return error instanceof ApiError || error instanceof ForbiddenError;
}

const reportedErrors = new WeakSet<object>();

export function reportUnexpectedError(error: unknown, source: ErrorSource): void {
  if (isExpectedError(error)) {
    return;
  }

  if (typeof error === "object" && error !== null) {
    if (reportedErrors.has(error)) {
      return;
    }

    reportedErrors.add(error);
  }

  reporter(error, source);
}
```

- **`reportUnexpectedError` is the one entry point.** It drops what the screen already shows and is
  not a bug — the server's answer (`ApiError`) and a route the reader's permissions do not open
  (`ForbiddenError`) — and hands everything else to the installed reporter. Which failures are
  expected is `error-handling`'s classification; this is where it is applied.
- **`source` says where the error surfaced**, so a provider can group by it:

  | Source | Reported from |
  | --- | --- |
  | `boundary` | The root's `onCaughtError`: an error a boundary caught while rendering (see `error-handling`) |
  | `query` | The query and mutation caches' `onError`: a query or mutation function that threw something other than the server's answer — a mapper reading a field the response lacks |
  | `uncaught` | The window's `error` event |
  | `unhandled-rejection` | The window's `unhandledrejection` event |

- **A provider is installed with `setErrorReporter`, in `main.tsx`, before the first render**, so no
  error raised while booting is missed. It is the one change a project makes to send errors to its
  service; a provider whose endpoint is another origin also needs that origin in the
  Content-Security-Policy (see `security`).

### With no provider, the console

```typescript
export const consoleErrorReporter: ErrorReporter = (error: unknown, source: ErrorSource): void => {
  // eslint-disable-next-line no-console -- the reporter of last resort, when no provider is installed.
  console.error(`Unexpected error (${source}):`, error);
};
```

This is the one `console` call in the application (see `code-conventions`). It writes where the
browser would have written the error anyway, and it is what makes an unexpected error fail both test
suites, which treat any console error as a failure (see `testing`).

### Reported once

The window's listeners call `preventDefault` before reporting, so the browser does not also write its
own line for the same error:

```typescript
const onUnhandledRejection = (event: PromiseRejectionEvent): void => {
  event.preventDefault();

  reportUnexpectedError(event.reason, "unhandled-rejection");
};
```

They are installed in `main.tsx`, before anything can throw (see `project-bootstrap`). An error a
boundary caught never reaches them — React hands it to `onCaughtError` instead.

**Each error is reported once, even when it surfaces twice.** A loader's query function that throws
is reported by the query cache, and then the router rethrows the same error into its boundary; a
`useSuspenseQuery` does the same. `reportUnexpectedError` remembers the error objects it has handed
over, in a `WeakSet` (above), and drops the second sighting.

## Web Vitals

How fast the page is for real readers — how long the main content took to appear (LCP), how much the
layout moved (CLS), how long an interaction waited (INP), with FCP and TTFB beside them — is measured
in their browsers by the `web-vitals` package and handed to a port of its own:

```typescript
export type WebVitalsReporter = (metric: Metric) => void;

export const ignoreWebVitals: WebVitalsReporter = (): void => undefined;

export function reportWebVitals(listeners: readonly MetricListener[] = METRIC_LISTENERS): void {
  listeners.forEach((listen: MetricListener): void => {
    listen((metric: Metric): void => {
      reporter(metric);
    });
  });
}
```

- **Measuring starts in `main.tsx`, before the first render**, so nothing that happens while the page
  loads is missed.
- **Each metric is handed over when it is final** — some only when the reader leaves the page — to
  whichever reporter is installed by then.
- **With no provider, nothing is sent and nothing is written.** A measurement nobody collects has no
  reader, and writing it to the console would fail the suites for no fault.
- **A provider is installed with `setWebVitalsReporter`**, like the error reporter, and its origin
  added to the Content-Security-Policy the same way.
- **The library's listeners are a default parameter**, so a test hands in its own and calls them back
  as the browser would, with no module mock (see `testing` for seams).

## Checklist

- [ ] Every request carries a `traceparent`, and the error report's trace id falls back to it.
- [ ] Every unexpected error reaches the port through `reportUnexpectedError`, once, under the first
      source it surfaced from, and no `ApiError` or `ForbiddenError` is reported.
- [ ] The query and mutation caches report through the port before deciding a toast.
- [ ] The window's listeners call `preventDefault` and are installed before the first render.
- [ ] Any provider is installed with `setErrorReporter` or `setWebVitalsReporter` before the first
      render, and its origin is in `connect-src`.
- [ ] The console reporter is the only `console` call.
