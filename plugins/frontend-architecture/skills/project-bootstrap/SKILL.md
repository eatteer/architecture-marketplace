---
name: project-bootstrap
description: "Standing a new single-page application up and the files every project needs before any feature exists — the source tree and what `common/` may hold, the `@/` and `@test/` aliases declared once, compiler strictness and the project references, the Node version and the package manager, the Vite config and the order of its plugins, the React Compiler outside the test runner, the lint config and the project's own lint rule, package scripts, the pre-commit hook, and `main.tsx`: what runs before the first render and the order of the providers."
when_to_use: "Trigger on — starting a project, editing `vite.config.ts`, `tsconfig*.json`, `eslint.config.mjs`, `package.json` scripts, `.nvmrc`, `packageManager`, `pnpm-workspace.yaml` or the pre-commit hook, an install that fails on an ignored build script (`ERR_PNPM_IGNORED_BUILDS`), choosing lint rules or adding an ESLint plugin, a rule in `eslint-rules/`, editing `main.tsx` or adding a provider, where a cross-cutting file goes, `common/` importing from a feature, an import that resolves in the editor but not in the bundle or the tests, a Node API reaching browser code, the React Compiler and coverage, a dark theme that flashes light on load, a type error in a file nobody staged, or a plugin that only works in one order."
---

# Project bootstrap

## The source tree

```text
src/
├── common/
│   ├── api/            the one HTTP client, its middlewares, the error type, the generated schema
│   ├── config/         validated build-time configuration
│   ├── i18n/           the translation setup and its types
│   ├── query/          the query client and the shared query types
│   ├── ui/             the component catalog, as the registry ships it
│   ├── components/     the application's own shared components — the shell, error screens, toasts
│   ├── hooks/          shared hooks
│   └── lib/            shared helpers — formatting, error reporting
├── features/
│   └── <feature>/      api/ components/ pages/ schemas/ model/
├── locales/<language>/<namespace>.json
├── routes/             one file per route: guards, loaders, the page it renders
├── main.tsx
├── router.ts
└── styles.css
test/                   the test runner's setup, the network mock's handlers, builders
eslint-rules/           the project's own lint rules
docs/adr/               decision records
```

`common/` holds what is **generic**, not what is merely shared. The test is whether you can state
the thing without naming a feature: a client that turns Problem Details into errors is generic; the
session a sign-in creates is the `auth` feature's, even though every page reads it.

**`common/` never imports from `features/`.** When a shared component shows something a feature owns
— the account menu inside the application shell — the shell takes it as a prop, and the route that
renders the shell passes the feature's component in. The dependency then points one way, and a
feature can be deleted without editing `common/`.

What goes inside a feature folder, and how features depend on each other, is `adding-feature`'s.

## The aliases

Every import in `src/` and `test/` is absolute: `@/` is `src/`, and `@test/` is the test support
under `test/`. The one folder outside them imports relatively: `eslint-rules/`, which the linter loads
before any alias exists.

```typescript
import { apiClient } from "@/common/api/client";
```

**The aliases are declared once, in the application's compiler config, and every tool reads them
from there.** Vite's `resolve.tsconfigPaths` makes the bundler and the test runner resolve through
the compiler's `paths`, so there is no second list to fall out of step. The one extra copy is in the
root `tsconfig.json`, which compiles nothing: the component registry's CLI reads its aliases from
the root config, and nothing else looks there.

`@test/` never appears in application code: the build excludes `test/`, so an import of it compiles
in the editor and fails in the bundle.

## Compiler strictness and the project references

`strict` on, and with it `noUncheckedIndexedAccess` (an array read is `T | undefined` until checked),
`noImplicitOverride`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`,
`verbatimModuleSyntax` (see `code-conventions` for what it does to type imports) and
`erasableSyntaxOnly`, which rejects the TypeScript that emits code — an `enum`, a parameter
property — so what the bundler strips is only ever types.

The root `tsconfig.json` has no files of its own; it references one config per environment, and
`tsc -b` checks them all:

| Config | Covers | Types |
| --- | --- | --- |
| `tsconfig.app.json` | `src/`, without the tests | the bundler's client types only |
| `tsconfig.test.json` | the tests in `src/` and `test/` | the app's, plus Node |
| `tsconfig.node.json` | `vite.config.ts` | Node |

The split is what keeps a Node API out of browser code: the application's config has no Node types,
so `process.env` or `node:fs` in a component is a compile error rather than a runtime one.

## Runtime version, package manager and editor settings

**The package manager is pnpm**, pinned in the `packageManager` field of `package.json` and installed
with `corepack enable`, so every contributor and the image run the same version. A module sees only
the packages its own `package.json` declares, so an undeclared import fails here rather than after
the project moves into a workspace. The skills write each command for pnpm; a project on another
package manager runs its equivalent.

- **Install settings live in `pnpm-workspace.yaml`**, even in a repository with one package.
- **`allowBuilds` names every dependency whose install script may run**, `true` or `false`, each with
  its reason in a comment. pnpm runs none by default and fails an install that meets one it was not
  told about, so a new dependency with an install script is decided when it is added: allowed when
  the script compiles or fetches something the project uses, refused when it only reports
  analytics or serves a feature the project does not use.

The Node version is stated once and kept in step wherever it is written: `.nvmrc`, the `engines`
field of `package.json`, and the Dockerfile's build stage. Editor settings (`.editorconfig`,
`.vscode/`) are optional project files; the linter remains what enforces the format.

## The Vite config

```typescript
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    ...(process.env.VITEST ? [] : [babel({ presets: [reactCompilerPreset()] })]),
    tailwindcss(),
  ],
  build: {
    rolldownOptions: {
      output: {
        strictExecutionOrder: true,
      },
    },
  },
  resolve: {
    tsconfigPaths: true,
  },
});
```

- **The router's plugin comes first.** It generates the route tree and splits each route into its
  own chunk, and the React plugin has to see the code it produces (see `routing`).
- **The React Compiler runs in the build and not under the test runner.** It adds a cache branch to
  every component, taken only on a re-render with the same props, and coverage counts those as
  branches of the application's own code — the same tests measure several points lower with it on.
  The compiled output is what the served build runs, checked by hand before a release (see
  `deployment`).
- **Modules run in the order they are imported**, whichever chunk the bundler puts them in
  (`strictExecutionOrder`). Without it, a chunk that several routes share runs before the entry's
  first import, and a module imported first for its side effect — configuring Zod before any schema
  is built — runs too late. It costs nothing measurable: the bundler splits the chunks differently.
- **The test runner's config lives in the same file**, so the tests resolve modules exactly as the
  build does. What it sets — the environment, the setup file, the configuration the tests run with,
  the coverage floor — is `testing`'s.

## Lint, format, and the hook

The linter owns formatting and import order, and `--fix` applies it; where the linter and a
convention disagree, the linter wins (see `code-conventions`). **So the config has to enable the
rules those conventions depend on** — a convention the linter stays silent about holds only while
everyone remembers it.

The core is the same set a TypeScript project needs anywhere:

| Rule | Without it |
| --- | --- |
| `@typescript-eslint/no-explicit-any` | `any` is forbidden by convention and accepted by the build |
| `no-console` | A `console.log` in a component passes review and ships |
| `@typescript-eslint/explicit-function-return-type` (`allowTypedFunctionExpressions`) | Return types drift to whatever is inferred; the option lets an inline JSX handler go unannotated, and with it every callback typed by its context — which of those still annotate is `code-conventions`' rule, not the linter's |
| `@typescript-eslint/explicit-member-accessibility` | `public`/`private` becomes optional, so it stops meaning anything |
| `@typescript-eslint/no-floating-promises` | An unawaited call loses its errors silently |
| `@typescript-eslint/consistent-type-imports` (`separate-type-imports`) with the import plugin's `prefer-top-level` | A type reference becomes a runtime import |
| `curly: ["error", "all"]` | A bare `if (x) return;` beside braced guards |
| `@stylistic/padding-line-between-statements`, `"always"` before and after `multiline-` `const`, `let`, `expression`, `block-like`, `return`, `export` and `type`, and between `const`/`let` and `expression` | A wrapped call butts against the next statement, and a declaration against the work that uses it |
| `local/padding-between-expression-kinds` | An assignment, a function call, a method call and an awaited step run together |
| `@stylistic/padded-blocks`, `"never"` for blocks, classes and switches | A body opens or closes on a blank line, and nothing else stops it |
| `no-restricted-syntax` on `CallExpression[optional=true]` | A conditional call hides its branch in `?.()` |
| `@typescript-eslint/naming-convention` over a list of abbreviations | `APIError` beside `ApiPagination`: one word, two spellings |
| The import plugin's `order`, with `@/` and `@test/` as internal groups | Every file orders its imports its own way |

A front end adds its own:

| Rule | Without it |
| --- | --- |
| `react-hooks` (`recommended-latest`) | A conditional hook, and the patterns the compiler cannot memoize — state set in an effect, a ref read while rendering |
| `react-refresh/only-export-components` | A module that exports a component and something else loses its state on every hot reload |
| `jsx-a11y` (`recommended`) | A control with no accessible name passes review (see `accessibility`) |
| `@stylistic/jsx-newline` (`prevent`, `allowMultilines`) | A multi-line element butts against its siblings |
| `local/padding-around-hooks` | The hook calls that open a component run into the work that uses them |
| `better-tailwindcss` (`recommended-error`) | A class the theme does not define, or two that conflict, render as nothing |
| `@tanstack/eslint-plugin-query` and `-router` | A query key that misses a variable its function reads; route options in an order the types cannot infer |
| `no-restricted-imports` of a second headless UI library | Two libraries with two APIs for the same components (see `ui-components`) |
| `no-restricted-syntax` on `import.meta.env` outside the configuration module | A variable read raw, past its validation (see `configuration`) |

**Two rules are the project's own.** Copy each with its type declaration into the project's
`eslint-rules/` — the hook-spacing rule,
[assets/eslint-rules/padding-around-hooks.mjs](assets/eslint-rules/padding-around-hooks.mjs) and
[assets/eslint-rules/padding-around-hooks.d.mts](assets/eslint-rules/padding-around-hooks.d.mts), and
the one that keeps one-line statements of different kinds apart,
[assets/eslint-rules/padding-between-expression-kinds.mjs](assets/eslint-rules/padding-between-expression-kinds.mjs)
and
[assets/eslint-rules/padding-between-expression-kinds.d.mts](assets/eslint-rules/padding-between-expression-kinds.d.mts)
— and register them as a local plugin:

```typescript
import { paddingAroundHooks } from "./eslint-rules/padding-around-hooks.mjs";
import { paddingBetweenExpressionKinds } from "./eslint-rules/padding-between-expression-kinds.mjs";

export default tseslint.config({
  plugins: {
    local: {
      rules: {
        "padding-around-hooks": paddingAroundHooks,
        "padding-between-expression-kinds": paddingBetweenExpressionKinds,
      },
    },
  },
  rules: {
    "local/padding-around-hooks": "error",
    "local/padding-between-expression-kinds": "error",
  },
});
```

Each has an autofix and a test of its own in the project's suite. What they enforce, and why, is
`code-conventions`'.

**The abbreviation rule is `naming-convention` over a list.** No format can tell `API` from the
start of a word, so the rule rejects each listed abbreviation written in capitals — a plural `s`
included, unless an uppercase letter comes before it or a lowercase one after, so `IPasswordHasher`
(`I` + `Password`) passes — and skips a name in SCREAMING_SNAKE_CASE. A project adds its own
vocabulary to the list. `Id` is in it, so `userID` fails beside `userId`. It checks declarations
only — variables, functions, parameters, types, classes, methods — because a property's name is
often a contract (a JSON field, a stored one) and a destructured binding repeats one; those are the
reviewer's (see `code-conventions`).

The component catalog turns the rule off: it keeps the registry's names (`InputOTP`), so an update
from the registry lands without a rename (see `ui-components`).

```typescript
const ABBREVIATIONS = [
  "Ai", "Api", "Cors", "Csp", "Css", "Csv", "Dto", "E2e", "Html", "Http", "Id", "Ip", "Iso", "Json", "Jwt",
  "Otp", "Pdf", "Seo", "Sms", "Sql", "Svg", "Ui", "Uri", "Url", "Utc", "Uuid", "Xml",
];

const IN_CAPITALS = ABBREVIATIONS.map((word: string): string => word.toUpperCase()).join("|");

export default tseslint.config(
  {
    rules: {
      "@typescript-eslint/naming-convention": [
        "error",
        {
          selector: ["variableLike", "typeLike", "classMethod", "typeMethod"],
          format: null,
          custom: { regex: `^(?![A-Z0-9_]+$).*(?<![A-Z])(?:${IN_CAPITALS})s?(?![a-z])`, match: false },
        },
        { selector: ["variable", "parameter"], modifiers: ["destructured"], format: null },
      ],
    },
  },
  {
    files: ["src/common/ui/**"],
    rules: { "@typescript-eslint/naming-convention": "off" },
  },
);
```

**A file that turns off `no-restricted-syntax` for one selector re-declares the others.** An override
replaces the rule's whole option list, so the configuration module, which may read
`import.meta.env`, still lists the optional-call selector.

Three more decisions every config makes:

- **Generated files are ignored, not fixed.** The API's schema and the route tree are rewritten by
  their generators on every run, so lint errors in them would come back on the next one.
- **`react-refresh` lists names instead of switching off.** Route files export `Route`, and a
  component library ships its variants and hooks beside the component; the rule's
  `allowExportNames` names each, so a new non-component export still has to be looked at.
- **A plugin that declares too old a peer range is kept with a `peerDependencyRules.allowedVersions`
  entry in `pnpm-workspace.yaml` and the reason beside it** — not by pinning the linter back.

The `no-unsafe-*` family is left off: those fire on values coming out of third-party types the
project does not control — a chart library's payloads, a body before its schema parses it — rather
than on `any` written here, which the first rule already rejects.

Where a rule has to be suspended, suspend it on the line, with the reason after `--`:

```typescript
// eslint-disable-next-line @typescript-eslint/only-throw-error -- the router's control flow: a thrown redirect is how `beforeLoad` navigates.
throw redirect({ to: "/sign-in" });
```

Scripts every project has, under these names:

```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview",
  "lint": "eslint \"{src,test}/**/*.{ts,tsx}\" \"*.config.ts\" --fix",
  "typecheck": "tsc -b",
  "test": "vitest run --coverage",
  "api:types": "openapi-typescript <the backend's OpenAPI URL> --output <the schema file> …"
}
```

`build` does not typecheck: the bundler strips types without reading them, exactly as the tests do,
which is why the typecheck is its own script and its own step in the hook. What `api:types` passes is
`api-client`'s; what `test` runs is `testing`'s.

A pre-commit hook runs the linter on the staged files, then `typecheck` over the whole project. The
second is there because nothing else before a push catches a cross-file type error — a component
that gained a required prop while its callers and its test were not updated. The staged-file linter
cannot see those files, and neither the bundler nor the test runner reads types.

## `main.tsx`

The entry point does three things before React renders anything, then mounts the providers.

```tsx
import "@/common/config/zod";
import "@/styles.css";
import "@/common/i18n/i18n";

const rootElement = document.getElementById("root");

if (!rootElement) { throw new Error("index.html has no #root element to mount the application into"); }

applyResolvedTheme(resolveTheme(readStoredTheme(), getSystemTheme()));
reportUncaughtErrors();
reportWebVitals();
reloadOnPreloadError();

const queryClient = createQueryClient();
const router = createAppRouter(queryClient);

createRoot(rootElement, { onCaughtError: handleCaughtError }).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <RouterProvider router={router} />
          <FullscreenLoader />
          <AppToaster />
        </QueryClientProvider>
      </ThemeProvider>
    </CSPProvider>
  </StrictMode>,
);
```

Before the render:

- **Zod is configured before anything else is imported**, since the configuration and the API's
  schemas are built when their modules load, and it has to be jitless by then (see `security`). The
  test setup imports the same module, so the tests parse the way the browser does.
- **The stylesheet and the translations are imported for their side effects next**, so the first
  paint is styled and in the reader's language.
- **The theme is applied to the document before React starts**, or a dark theme flashes light for as
  long as the bundle takes to boot (see `ui-components`).
- **The listeners for uncaught errors and for a chunk that fails to load are installed before
  anything can throw or lazy-load**, and the Web Vitals are measured from before the first paint
  (see `observability` and `routing`).
- **The query client and the router are created once, outside any component**, and the router
  receives the client as context, so its loaders read through the same cache the components do.

The providers, outermost first — each wraps what reads it:

1. **The UI library's CSP settings**, since any primitive may read them: it renders no inline
   `<style>` element that the Content-Security-Policy would refuse (see `security`).
2. **The theme**, since everything paints with it.
3. **The query client**, around the router, whose loaders use it.
4. **The router, with the fullscreen loader and the toaster as its siblings** — never inside a
   route, so a navigation never unmounts them (see `error-handling`).

`onCaughtError` receives every error a boundary caught, which React otherwise writes to the console;
what it does with them is `error-handling`'s. `StrictMode` stays on: its double-invoked effects are
how a missing cleanup shows up in development instead of in production.

## Checklist

- [ ] Nothing under `common/` imports from `features/`.
- [ ] The aliases are declared once in the application's compiler config and resolved everywhere
      through it.
- [ ] `tsc -b` covers the application, the tests and the tooling config, and only the tests and the
      tooling get Node's types.
- [ ] The Node version agrees in `.nvmrc`, `engines` and the Dockerfile.
- [ ] `packageManager` pins pnpm, and every `allowBuilds` entry carries its reason.
- [ ] The router's plugin runs before the React plugin, the React Compiler is off under the test
      runner, and the build keeps the modules' execution order.
- [ ] Every rule in both lint tables is on, both of the project's own rules are registered from
      `eslint-rules/`, and generated files are ignored.
- [ ] Every suspended rule is suspended on one line, with its reason.
- [ ] The scripts have the names above, and the pre-commit hook runs `lint-staged` then `typecheck`.
- [ ] `main.tsx` imports the Zod configuration first, applies the theme, installs the error and preload listeners and starts the Web
      Vitals before the render, and the providers nest in the order above.
