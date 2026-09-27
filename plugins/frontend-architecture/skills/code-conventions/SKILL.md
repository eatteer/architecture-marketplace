---
name: code-conventions
description: "Universal TypeScript and React conventions for every `.ts` and `.tsx` file — forbidden constructs (`any`, non-null `!`, `console.*`, `enum`, `as` outside sanctioned cases), what carries a type annotation and which callbacks do not, `type` vs `interface`, `?` vs `| undefined`, absence via `undefined`, no magic values, pure functions, no mutation of data you do not own, type-only imports, floating promises and `void`, named exports, props typing, no manual memoization under the React Compiler, what an effect is for, comments, blank lines between statements, JSX siblings and hook calls, braces, the naming and file-suffix tables."
when_to_use: "Trigger on — writing or editing ANY `.ts` or `.tsx` file or React component, declaring a type or a component's props, casting with `as`, inlining a literal, binding a `const`, mutating an array, an object or state, calling an async function from an event handler, annotating a callback or a JSX event handler, reaching for `useCallback`, `useMemo` or `React.memo`, writing a `useEffect`, copying a prop into state, naming a file, component, hook or constant, choosing a file suffix, a guard without braces, a blank line after a hook call, a lint error about hook spacing or JSX siblings, a default export, adding a comment or JSDoc, a lint rule that contradicts a documented convention, or reviewing code for convention compliance."
---

# Universal code conventions

These apply to **every file** regardless of feature or folder. Patterns particular to one concern
live in the other skills (`api-client`, `server-state`, `forms`, …); this skill is the
always-relevant baseline.

## Formatting belongs to the linter

Whitespace, indentation, quote style, semicolon placement, import order, the layout of a long class
string and everything of that kind are the project's linter to decide and its `--fix` to apply. This
skill prescribes none of it: a rule spelled out here would drift from the config while reading as
authoritative.

What this skill does prescribe are the shapes a reader has to recognize — where a blank line falls,
when a guard takes braces, what a name says. The lint config that enforces them is
`project-bootstrap`'s.

**When the linter and this skill disagree, the linter wins.** Follow it, then report the
disagreement so this skill gets corrected: a rule here that fails `lint` sends every reader who
trusts it into a red build.

## TypeScript

- **`any` is forbidden.** Use `unknown` and narrow it with a type guard. `any` does not describe a
  value the compiler cannot type — it switches the compiler off for every expression that value
  touches.
- **The non-null assertion operator (`!`) is forbidden**, with no exception. Use an explicit guard,
  `??`, or extract-then-check. Even the element the application mounts into gets a guard, because a
  renamed id in `index.html` should fail with a sentence, not with "cannot read properties of null":

  ```typescript
  const rootElement = document.getElementById("root");

  if (!rootElement) { throw new Error("index.html has no #root element to mount the application into"); }
  ```

- **Annotate what other code reads, and where inference is wrong.** Parameters, return types and
  class properties are the surface somebody else depends on, so they always carry a type — a
  component's return type included (`JSX.Element`, or `JSX.Element | null` when it can render
  nothing). A local binding does not: `const users = useQuery(userQueries.list(search))` is already
  typed by the factory, and repeating it is noise to keep in step.

  The exception is a local whose inferred type is not the one intended — an empty array that will be
  filled, a literal that must widen to its union:

  ```typescript
  const sort: Sort<UserSortBy> = { sortBy: search.sortBy ?? DEFAULT_USER_SORT.sortBy, sortOrder: "asc" };
  ```

- **Every callback annotates its parameters and its return type** — a `.map`, a library option, a
  function handed to another — **except a handler written inline in a JSX attribute, which annotates
  neither.** The attribute's own type already types it; spelling out a DOM event
  (`FormEvent<HTMLFormElement>`) or a render prop's arguments is a long type nobody reads, and one
  that can disagree with the attribute. A test runner's callbacks (`describe`, `it`) are the other
  exception, for the same reason.

  ```tsx
  // ✅ an ordinary callback: both annotated
  {users.map((user: User): JSX.Element => <UserRow key={user.id} user={user} />)}

  // ✅ inline in a JSX attribute: neither
  <Select
    onValueChange={(value) => {
      onChange({ status: isUserStatus(value) ? value : undefined });
    }}
  />
  ```

  A handler defined as a named function above the `return` is an ordinary function, annotated like
  one.
- **No TypeScript `enum`.** An enumerable concept is a `const` array with its union derived from it.
  An `enum` adds a second set of names beside the values, and hands no plain list to the Zod schema,
  the select or the loop that needs one. When the backend owns the catalog, the array comes from the
  API's generated types instead of being typed again (see `api-client`):

  ```typescript
  export const SORT_ORDER_VALUES = ["asc", "desc"] as const;

  export type SortOrder = (typeof SORT_ORDER_VALUES)[number];
  ```

- **`type` for every shape, `interface` only where TypeScript requires one**: reopening a library's
  declaration (`declare module "@tanstack/react-query" { interface Register { … } }`), which only an
  interface can do. Props, models, unions and function types are all `type`.
- **`?` when a caller may leave a member out, `T | undefined` when every producer must state it.** An
  optional prop is `onRetry?: () => void`. A record that always carries the key — a form's values,
  the filters a component receives — is `status: UserStatus | undefined`, so forgetting to pass it is
  a compile error rather than a silent `undefined`.
- **`readonly` on what must not change after construction** — an error's fields, a catalog. It says
  a value is an input, not a slot.
- **The `as` cast is forbidden** except two cases, and both prove nothing and hide nothing:

  1. `as const`.
  2. Widening a typed collection to test a wider value against it — the one line inside a type
     predicate:

     ```typescript
     export function isLanguageValue(value: string): value is LanguageValue {
       return (LANGUAGE_VALUES as readonly string[]).includes(value);
     }
     ```

  To narrow `unknown` — a `catch` binding, a message from another tab, a JSON body — use a type
  guard or a schema, never `as`. To check that a value fits a type without widening it, use
  `satisfies`: `z.object({ … }) satisfies z.ZodType<ProblemDetailsDTO>` fails the build when the
  backend's shape changes, and a cast would have hidden it.
- **A type-only import says so**: `import type { X } from "…"`, as its own statement rather than
  mixed into a value import. With `verbatimModuleSyntax` the bundler keeps every import it is not
  told is a type, so a type mixed into a value import becomes a runtime import of a module that may
  not exist, or that closes a cycle.
- **`console.*` is forbidden.** A failure reaches the reader through the screen and reaches the team
  through the error reporter; the one `console` call is that reporter's default, when no provider is
  installed (see `observability`).
- **No floating promises.** Every promise is awaited, returned, or explicitly discarded with `void`.
  `void` is a statement that the failure is already handled somewhere else — by the function's own
  `try`, by the query cache that toasts a failed mutation, by the router that renders a failed
  navigation — never a way to silence the linter over a promise whose rejection nobody sees. An event
  handler that starts async work does it in a block body, because a handler that returns a promise
  to an attribute typed `void` is one the linter rejects:

  ```tsx
  <form
    noValidate
    onSubmit={(event) => {
      void handleSubmit(submit)(event);
    }}
  />
  ```

### Absence is `undefined`, never a sentinel

`""`, `0`, `-1` and `"none"` are legitimate values. Reusing one to mean "not set" conflates absence
with data and forces a matching decode somewhere else — a `!== ""` guard, a `?? ""` round-trip whose
only job is to be undone. A pure helper takes a real value; do not widen it to accept `undefined` and
return `""`. When a value may be absent on screen, **guard the render** so the element appears only
when the value exists — absence is a show-or-hide decision, not a value to format.

The sanctioned exceptions are all **frontier** cases, where a library — not the application —
refuses `undefined`, and the foreign shape stops at that library's boundary:

- A Base UI select says "nothing selected" with `null`. A form field holds `null` for it (see
  `forms`); a filter maps the URL's `undefined` onto it in the one attribute that needs it,
  `value={status ?? null}`, and back in its change handler.
- A query cannot resolve to `undefined`, so a read whose answer is "there is none" — nobody signed
  in — resolves `null`, and the feature that owns the query says what that `null` means.
- A property the API declares nullable is `null` in the generated type. A mapper decodes it for the
  feature's model; a component that takes the generated type as it is — the backend's pagination —
  compares against `null`, never against a sentinel of its own.

The test for any new one: the foreign shape exists on exactly one side of a boundary and is decoded
*at* that boundary.

### No magic values

A literal that carries meaning is a named `SCREAMING_SNAKE_CASE` constant, not an inline literal: a
duration, a page size, a storage key, a channel or lock name, a header, a path, an error code.
Exempt: trivial structural literals (`0`/`1`/`-1` for index, length or step; `length === 0`), and the
values a universal vocabulary already names *in the code you are reading* — a MIME type.

**Where the platform publishes no vocabulary, the project names it once.** `fetch` has no status
constants, so the statuses the application branches on are declared beside the error type, and every
reader imports them instead of retyping `401`.

**The string nothing type-checks is where this bites hardest**: a backend error code, a storage key
shared by two modules, a `BroadcastChannel` name. Rename it on one side and an inline literal keeps
compiling on the other.

**Value-union members stay inline.** Comparing against a member (`sort.sortOrder === "asc"`), passing
one to a parameter typed as the union, or assigning one where the union is the declared type
(`sortOrder: "desc"` in a `Sort<UserSortBy>`) keeps the literal: the union makes a typo or a rename a
compile error there already.

### A `const` earns its place by adding a name

A local binding is justified two ways: it **names something the expression doesn't** — a compound
condition, a real transformation — or it **unifies several readers**. A binding that does neither is
noise, and the giveaway is an alias read exactly once.

<!-- snippet-check: skip -->
```tsx
// ❌ restates the access it wraps
const items = users.data.items;

return <UsersTable users={items} />;
```

```typescript
// ✅ names a condition the expression doesn't
const isOwnAccount = queryClient.getQueryData(sessionQuery.queryKey)?.user.id === id;
```

### Pure functions stay pure

A helper, a formatter, a mapper, a schema builder: output depends only on its arguments, with no I/O,
no mutation of those arguments, and no read or write of module-level mutable state. Side effects
belong in hooks, event handlers and the query functions — never hidden inside a function that looks
like a transform. That is also what makes them testable with a literal and an assertion.

### No in-place mutation of data you don't own

Derive new values with `map`, `filter`, spread. Never mutate an argument, React state, the data in
the query cache, or a shared constant — `setQueryData` receives a new object, never the old one
edited. Prefer `const`; reach for `let` only when reassignment is intrinsic to the algorithm.

**A mutable object a library hands you to mutate is not "data you don't own".** A fetch client's
request middleware receives the request to modify and return — `request.headers.set(…)` is its
contract, and cloning instead would drop what the client set on it.

## React

- **A component is a named function** — `export function UsersTable(props: UsersTableProps):
  JSX.Element` — with `JSX` imported as a type from `react`. Not an arrow in a `const`, not
  `React.FC`.
- **Props are a named `<Component>Props` type declared right above the component** once there is more
  than one; a single prop, or a component private to its file, may type them inline. The props type
  is exported only when another module needs it. A wrapper that renders nothing but its children
  declares them required — `children: ReactNode` — so the empty call site is a compile error.
- **No manual memoization.** The React Compiler memoizes every component and hook, so `useCallback`,
  `useMemo` and `React.memo` for referential stability are redundant — and a stale dependency array
  is a bug only the manual form can have. Write plain functions and plain derived values.
- **An effect synchronizes with something outside React** — a subscription, a timer's cleanup, a
  library's reset — and nothing else. It is never how one piece of state follows another:
  - A value computed from props or state is computed while rendering.
  - A value that must follow a prop only sometimes — an input's draft that takes a new value from the
    URL unless it is the echo of its own change — is adjusted while rendering, by comparing against
    the last value seen, not copied into state by an effect that renders twice.
  - A value from outside React that changes on its own — the system theme, a media query — is read
    with `useSyncExternalStore`.
  - Everything a component's state should forget when its subject changes is dropped by a `key`.

  <!-- snippet-check: skip -->
  ```tsx
  // ❌ an effect whose only job is to copy a prop, one render late
  useEffect(() => {
    setDraft(value ?? "");
  }, [value]);
  ```

  ```typescript
  // ✅ adjusted while rendering: React discards this render and starts the next one with the new state
  if (value !== seen) {
    setSeen(value);

    if (value !== committed) {
      setDraft(value ?? "");
    }
  }
  ```

- **A hook's result is named for what it holds, not for being a result.** A query is named for what
  it reads and read through that name (`const users = useQuery(…)` then `users.isPending`,
  `users.data.items`); a mutation for the action (`const createUser = useCreateUser()` then
  `createUser.mutate(values)`). Destructure only where the pieces read better alone
  (`const { t } = useTranslation("users")`).

## Comments and JSDoc

Default is **no comments, no JSDoc**. Add a comment only when the *why* is non-obvious — a hidden
constraint, a workaround, surprising library behavior, a number that encodes a rule — and cannot be
expressed through naming. Never describe *what* the code does, and never caption a block of markup
(`{/* Header */}`): the elements already say what they are. A JSX comment is for the same *why* as
any other, beside the element it is about.

JSDoc follows the same test. It earns its place when the *why* belongs to a whole module or type;
it never restates a signature with `@param` and `@returns`.

An effect and a `try`/`catch` are where the rule slips most, because both feel like they deserve a
caption. If an effect needs explaining, that is usually the signal to give it a named hook.

## Blank lines and spacing

A blank line marks a **change of concept** or gives a tall block room to breathe; it is not a
separator dropped between every statement. When everything is separated, nothing is grouped. All
three rules below are enforced by the linter, so `--fix` settles them; what is written here is the
reason, so the code reads the same where the linter cannot reach.

**Statements: how tall they are decides.** A run of single-line statements of the same kind stays
together. Anything that spans more than one line gets a blank line on each side, even from code it
is closely related to — a wrapped call, a multi-line object, a braced guard. Height is what makes a
block's edges hard to find, and the blank line gives them back.

<!-- snippet-check: skip -->
```typescript
// ❌ the wrapped call starts wherever the eye happens to land
const queryClient = createQueryClient();
const router = createAppRouter(queryClient);
createRoot(rootElement, { onCaughtError: handleCaughtError }).render(
  <App router={router} />,
);
```

**JSX siblings: the same rule, one level down.** A multi-line element gets a blank line on each side;
a run of single-line siblings stays packed.

```tsx
<Field data-invalid={errors.email !== undefined}>
  <FieldLabel htmlFor={emailId}>{t("form.email")}</FieldLabel>

  <Input
    id={emailId}
    type="email"
    aria-invalid={errors.email !== undefined}
    {...register("email")}
  />

  <FieldError id={`${emailId}-error`} errors={[errors.email]} />
</Field>
```

**Hook calls: each thing a component reads is a paragraph.** A component or a hook opens by reading
what it depends on, then works with it. A blank line separates a hook call from a statement that
calls none, and two hook calls from each other **unless they read the same thing** — the same hook
(a run of `useId`, of `useState`) or the same object (a route's `useSearch` and `useNavigate`).
Grouping by what a reader thinks belongs together would be a judgment everyone makes differently; the
same hook or the same source is one the linter can make for everybody.

```tsx
export function CreateUserForm({ onCreated }: CreateUserFormProps): JSX.Element {
  const { t } = useTranslation("users");

  const createUser = useCreateUser();

  const nameId = useId();
  const emailId = useId();

  const isSubmitting = useRef(false);

  return <form aria-labelledby={nameId} data-email={emailId} data-busy={isSubmitting.current} />;
}
```

A blank line between two calls of the same hook is still allowed — before one that carries its own
comment, for instance.

- **No blank line at the very start or end** of a function, callback or component body.
- **The import block and parameter lists are the linter's alone**: its import-ordering rule decides
  the groups, and a list's separator is the comma.

**Every guard takes braces**, whatever its body — a `throw`, a returned element, a statement, and
equally a bare `return;`:

```tsx
if (users.isPending) {
  return <UsersTableSkeleton />;
}
```

```typescript
if (isSubmitting.current) { return; }
```

One form for every guard means the body can grow a second statement without the `if` changing shape.

## Exports

Named exports everywhere. A default export lets each importer invent its own name for the same
symbol, which breaks every search for a usage.

The one exception is a file a **tool** loads by convention and requires a default from: a
`*.config.ts` or `*.config.mjs`. A route file is not one — it exports a named `Route`, which the
router's plugin reads by that name (see `routing`).

## Naming conventions

Both naming tables — names by context and file suffixes by artifact — are in
[references/naming-tables.md](references/naming-tables.md). **Read it before naming a file,
component, hook, constant or type, or choosing a suffix**; the rules below settle what the tables
cannot.

- **No camelCase in a file or folder name.** kebab-case is the only casing a path takes, so a file
  can be found by the words in its component's name. What a route parameter is called, since the
  router reads it from a folder name, is `routing`'s.
- **A file holds what its name says.** A component's file is the component's name; the skeleton it
  exports beside it and the small private pieces it composes live there too.
- **snake_case is for values that cross a boundary**, camelCase for the identifiers around them: an
  error code the backend sends, a translation key (see `i18n`). The backend's own names — a query
  parameter, a sort field — keep the backend's casing, because renaming them here breaks the request.
- **Names carry domain meaning.** Prefer the domain word over `data`, `result`, `item`, `info`:
  `.map((user: User): JSX.Element => …)`, a prop `users`, not `items`. Grep a sibling file before
  inventing a name for something the codebase already names. Sanctioned generic names: `dto` inside
  a mapper, `field` and `fieldState` from the form library, `value` and `label` on the items a select
  renders, and a generic helper over `unknown`.
- **No single-letter parameters.** `(event) =>`, not `(e) =>`; `(error: unknown)`, not `(e)`. An
  unused positional parameter is `_` (`Array.from({ length }, (_: unknown, row: number) => …)`).
- **Sentence case for docs, comments and messages**: "Copy error", not "Copy Error". Proper nouns,
  acronyms and products keep their casing. A commit description follows
  `engineering-workflow:git-workflow`.

## Checklist

- [ ] No `any`, no `!`, and every `as` is `as const` or the widening inside a type predicate.
- [ ] No TypeScript `enum`; every enumerable concept is an `as const` array with its derived union,
      or the backend's generated array.
- [ ] Every parameter, return type and class property carries a type, callbacks included — all but
      an inline JSX attribute handler and a test runner's callbacks, which carry none.
- [ ] Every `interface` reopens a library's declaration; every other shape is a `type`.
- [ ] Every promise is awaited, returned, or `void`ed where its failure is already handled.
- [ ] Every literal that carries meaning and is not a value-union member is a named constant.
- [ ] Every `const` either names a concept or unifies several readers.
- [ ] No `useCallback`, `useMemo` or `React.memo`; every `useEffect` synchronizes with something
      outside React.
- [ ] Every component is a named function with a declared return type, and props with more than one
      member on an exported component are a named `<Component>Props`.
- [ ] `lint` passes: no statement or JSX sibling that wraps touches its neighbor, hook calls are
      paragraphs, and every `if` body is in braces.
- [ ] Every type-only import uses `import type` as its own statement.
- [ ] No `console.*` outside the error reporter's default.
- [ ] Every default export is one a tool requires.
- [ ] Every comment states a *why* the code cannot.
- [ ] Every file, component, hook and constant follows the naming tables, and no path contains
      camelCase.
