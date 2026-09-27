---
name: testing
description: "Tests of the single-page application — which layer tests what (a pure function with a literal, a component or a whole route rendered with the network mocked, the flow that crosses the backend end to end), the test runner's setup and what it resets, the console guard that fails a test on any warning, the network mock that starts signed in and overrides that win by their order, builders of DTOs, an in-memory backend for a feature, rendering the application at a path, finding elements by role and name, determinism seams instead of module mocks, the coverage floor and what it leaves out, and the Playwright suite against the build and a real backend."
when_to_use: "Trigger on — writing a `*.test.ts` or `*.test.tsx` or an `e2e/*.spec.ts`, `renderWithProviders` or `renderRoute`, `server.use`, an MSW handler, a request no handler answers, a builder in `test/builders/`, a test failing with 'The test wrote to the console', a router `console.warn` in a test, a `findBy` that times out, `vi.useFakeTimers`, `vi.mock`, a flaky test, coverage below the floor, `playwright.config.ts`, `page.route`, `storageState`, the backend's login limit in the end-to-end run, 'Failed to load resource' failing the end-to-end suite, or testing another tab."
---

# Testing

Each test runs at the lowest layer that can show the behaviour it is about, and the layers do not
repeat each other.

| Layer | Tests | With |
| --- | --- | --- |
| A pure function — a mapper, a formatter, a schema, a guard's decision | its output for a literal input | Vitest, nothing rendered |
| A component, a screen, a route | what a reader sees and does: states, errors, navigation, what reaches the backend | Testing Library in jsdom, the network mocked by MSW |
| A flow that crosses the backend | that the application and the real backend agree: the session, the refresh, the envelope, the errors | Playwright, against the production build and a running backend |

- **A screen is tested through what a reader perceives**, not through its implementation: no test
  reaches into a component's state, a hook's return value on its own, or a query's cache when the
  screen shows the same thing.
- **The network is the boundary that is mocked**, never the application's own modules. A test that
  mocks the API client or a query hook tests a copy of the wiring it replaced.
- **Tests sit beside what they test**; the shared support — setup, handlers, builders, render helpers —
  lives in `test/`, reached through `@test/` (see `project-bootstrap`).

## The setup

The test runner's config lives in `vite.config.ts` (see `project-bootstrap`): `jsdom`, one setup
file, the configuration the tests run with (a fake API origin — see `configuration`), and the
coverage floor. The setup file does four things around every test:

- **Starts MSW with `onUnhandledRequest: "error"`**, so a request no handler answers fails the test
  instead of reaching the network.
- **Guards the console** (below).
- **Resets everything a test can leave in the page**: rendered trees, handlers added with
  `server.use`, open toasts, `localStorage` and `sessionStorage`, the theme class, the language, and
  any replaced reporter.
- **Raises Testing Library's async timeout**: a route renders only after its guard read the session
  and its chunk loaded, and the first route a file renders transforms those chunks cold.

### The console guard

**Any `console.error` or `console.warn` during a test fails it.** React reports what it considers a
bug — an input switching from uncontrolled to controlled, a missing key, an update outside `act()` —
through the console and carries on rendering, so a test asserting on the screen would still pass.
Each call is recorded and the test fails after it, because React writes those warnings from inside a
render, where throwing would only change the warning.

```typescript
const messages = consoleGuard.drain();

consoleGuard.restore();

if (messages.length > 0) {
  throw new Error(`The test wrote to the console, which fails it:\n${messages.join("\n")}`);
}
```

- **A test that expects a warning asserts it, with a spy of its own that takes the call from the
  guard.** Outside production the router writes `console.warn("Warning: Error in route match")` for
  every route that fails on purpose — a refused route, a missing resource — so those tests replace
  `console.warn`, assert the call, and leave the guard nothing.
- **Every render passes the application's `onCaughtError`**, so an error a boundary caught goes to the
  error reporter exactly as in the browser (see `error-handling`), and its console default fails the
  test if it was a bug.

## The network mock

```typescript
export const handlers: RequestHandler[] = [signedIn()];
```

- **The default handlers start signed in**, so every page behind the session guard renders. A test
  that needs someone signed out, or a different account, overrides with `server.use(…)`.
- **`server.use(a, b)` gives priority to the first handler in its list**, and every override to the
  ones already there — a handler meant to win goes first, or it is shadowed.
- **Handlers answer as the backend does**: the `{ data }` envelope, Problem Details with its
  content type for failures. A helper per feature builds them (`problem({ status: 409, … })`,
  `userNotFound()`).
- **A feature's screens get an in-memory backend** — filtering, sorting and paging a list the way the
  real one does — that records what it received, so a test asserts on the query a filter sent or the
  body a form posted, not on how the client built it. An option to hold a write lets a test look at the
  screen while it is in flight:

  ```typescript
  const backend = usersBackend(buildUserDTOs(25), { holdCreate: release });
  ```

## Builders

**A builder returns a valid DTO of the generated type with every field filled**, and takes overrides
for what the test is about: `buildUserDTO({ status: "suspended" })`. A test states only what matters
to it, and a DTO that gains a field is updated in one place. A builder for a list numbers its items
and spaces their dates, so an order is predictable.

## Rendering

- **`renderWithProviders(ui)`** mounts a component inside the application's providers — a fresh query
  client per test, the theme, the fullscreen loader and the toaster — with the root's `onCaughtError`.
- **`renderRoute(path)`** mounts the whole application at a path, with the real router over an
  in-memory history, and returns the router so a test can assert on the URL. A screen is tested this
  way whenever its route matters — its guard, its search params, its loader.

**Find elements by role and accessible name**: `getByRole("button", { name: "Next" })`,
`findByRole("table", { name: "Users" })`. That is how a reader finds them, and a control a test cannot
find by its name is one a screen reader cannot announce (see `accessibility`). The error toast is
announced from the toast library's alert region, so it is found by the `alert` role, and its buttons
among hidden elements.

**Another tab is simulated with a second `BroadcastChannel`** on the session's channel name: the
runtime's channels deliver between instances in the same process.

## Determinism

- **Time**: fake timers for what depends on a delay (`vi.useFakeTimers()` for a debounce), always
  restored. A test that needs several keystrokes to land within the delay pastes the text instead of
  typing it — under coverage, keystrokes can arrive further apart than the delay.
- **Seams, not module mocks.** A function that touches the browser takes what it touches as a
  parameter with the real one as its default — the reload a chunk error triggers, the clock, the
  listeners of a measuring library — and the test passes its own. A module mock is shared by every
  import in the file, including the ones the setup already made.
- **Integration tests do not assert the exact sequence of requests** a debounced input produced; the
  debounce is proven in the hook's own unit test, and the screen test asserts where it ended.

## Coverage

`npm test` runs with coverage and fails under the floor — **90 % statements and lines, 85 % branches
and functions**. It measures `src/` and leaves out what is not the application's own logic: the
component catalog (library code, tested through how the screens use it), the generated files,
`main.tsx`, and the tests. The catalog still gets one test: every module in it is imported, so an
update that breaks a dependency fails even where no screen uses the component.

The React Compiler is off under the test runner (see `project-bootstrap`); the compiled output is
what the end-to-end suite exercises.

## The end-to-end suite

`npm run test:e2e` runs Playwright against **the production build** — its config builds it and
serves it with `vite preview` — and **a real backend** running with its seed. The build because that is what ships — the compiler included — and because the
router's development warnings would fail the console guard.

- **One worker, in file order**: every spec signs in as the same account against a backend whose login
  is rate-limited per account and whose refresh tokens are single-use.
- **One sign-in per run, through the real form**, in a setup project that saves the cookies as
  `storageState` for the specs that follow. A spec that rotates tokens — forcing a refresh — signs in
  with its own session instead, so it does not spend the shared one.
- **The console guard applies here too**, on the browser context: any error, warning or uncaught
  exception fails the test, **except** the line the browser writes for every response with a `4xx`
  status (`Failed to load resource: … status of 4xx`), since the flows provoke 400, 401 and 409 on
  purpose and the page shows each one. A `5xx` or a failed connection still fails.
- **A request is held with `page.route`** to look at the screen while it is in flight — the skeleton,
  the fullscreen loader — and released to see what follows.
- **Data a spec creates carries a tag unique to the run**, in the names and emails it writes, so a
  search for the tag finds exactly those rows whatever else the database holds; the spec deletes them
  in its `afterAll`, and a delete helper that tolerated a `404` would hide a spec that deleted the
  wrong thing.
- **An already-served application can be the target** (`E2E_BASE_URL`), which is how the suite runs
  against the deployable image and its real Content-Security-Policy (see `deployment` and `security`).
- Its variables are its own, never compiled into the bundle (see `configuration`).

## Checklist

- [ ] Each behaviour is tested at the lowest layer that shows it, and screens are tested through what
      a reader perceives.
- [ ] Only the network is mocked; no test mocks the API client, a query hook or a module of the
      application.
- [ ] No test writes to the console; an expected warning is asserted.
- [ ] Every override that must win is first in its `server.use` call, and every handler answers in
      the backend's envelope and Problem Details.
- [ ] Every DTO in a test comes from a builder with overrides for what the test is about.
- [ ] Elements are found by role and name.
- [ ] Every timer-dependent test uses fake timers or a seam, and restores them.
- [ ] Coverage stays above the floor with the catalog, generated files and the entry point excluded.
- [ ] Every flow that crosses the backend has an end-to-end spec that tags and deletes what it
      creates.
