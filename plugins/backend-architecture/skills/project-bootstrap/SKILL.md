---
name: project-bootstrap
description: "Standing a new backend up and the files every project needs before any feature exists — the source tree and `common/`, the `@/` and `@test/` aliases, compiler strictness, the Node version, lint setup, package scripts, the pre-commit hook, `main.ts` and the order of its steps, global pipes and filters, the root module, the modules that configure the framework, and the local stack."
when_to_use: "Trigger on — starting a project, choosing lint rules, a rule in `eslint-rules/`, editing `main.ts`, `app.module.ts`, `tsconfig.json`, the lint config, `package.json` scripts, `.nvmrc` or the pre-commit hook, a `forRootAsync` factory, the order global pipes, filters and guards are registered in, a pipe that trims every string in the body, where a cross-cutting file goes, an import that resolves in the editor but not at runtime, a type error in a file nobody staged, editing the compose file or pinning an image, a local replica set that never elects a primary, a build that emits `dist/src/main.js`, or a container that cannot bind its port because another project holds it."
---

# Project bootstrap

## The source tree

```text
src/
├── common/
│   ├── domain/          AggregateRoot, DomainEvent, DomainError, Transaction, Paginated, shared value objects
│   ├── application/     shared ports — transaction manager, event bus, password hasher, clock
│   ├── infrastructure/  their implementations, config validation, request context, database module
│   └── presentation/    response builders, the global filter and the error-status registry, the API
│                        version, guards, pipes, middlewares, the health controller
├── features/
│   └── <feature>/       domain / application / infrastructure / presentation
├── cli/                 the commands a deploy runs — migrate, seed
├── migrations/          one file per schema change, compiled with the application
├── i18n/
├── app.module.ts
├── instrumentation.ts   tracing, loaded before the application when the start command asks
└── main.ts
```

**Anything a deployment runs lives under `src/`.** The build compiles only `src/`, and the image
holds only the build, so a command kept outside it cannot run where it is needed (see the
`deployment` skill). A top-level `scripts/` holds what only a developer's machine runs — bringing
the local stack up, for instance — and a top-level `eslint-rules/` the project's own lint rules.

`common/` holds what is **generic**, not what is **shared**. The test is whether you can state the
concept's rules without naming a business entity; the `domain-modeling` skill owns it, and it is the
rule that decides whether a file belongs here or in the feature that invented it.

A feature replicates all four layers. A feature with only two is not simpler — it is one whose
missing layers ended up somewhere they cannot be found.

## The `@/` alias

Every import is absolute from the source root:

```typescript
import { User } from "@/features/users/domain/entities/user.entity";
```

Relative imports across features are what make a move a fifty-file diff, and `../../../` says
nothing about where the thing lives. The alias is declared in **three** places that must agree —
the compiler config, the runtime resolver, and the test runner's module mapper. When an import
resolves in the editor and fails at runtime, one of the three is missing it.

Test support — builders, doubles shared across suites, the global setup — sits under the test root
and is imported through a second alias, `@test/*`, declared in the compiler config's paths and in
the module mapper of every test runner config that reaches it (the integration and end-to-end ones
included). It never appears in `src/` outside a spec: the build excludes the test root, so a
production file that imports it compiles in the editor and fails in the image.

**A script run through a per-file compiler needs telling to load the type declarations.** Global
augmentations — the fields a middleware adds to the request, for instance — live in a `.d.ts` that
nothing imports, so a per-file compiler never sees it. `tsc --noEmit` passes because it reads the
whole program; a script run through `ts-node` — the seed, locally — fails on the same code. Enable
the runner's option that loads the full file list, or every such script eventually grows a cast to
work around a type that is already declared. The migrations are not affected: they run compiled.

## Compiler strictness

`strict` on, and with it the ones people disable first and regret: `noImplicitAny`,
`strictNullChecks`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`.

Strictness is worth most at the start and gets expensive later. A project that begins strict pays
nothing; a project that turns it on at ten thousand lines pays for every shortcut taken until then.

`experimentalDecorators` and `emitDecoratorMetadata` are required by the framework's injection and
by validation.

## Runtime version and editor settings

The Node version is stated once and kept in step wherever it is written: the version manager's file
(`.nvmrc`), the `engines` field of `package.json`, and the Dockerfile's `FROM` line. Moving it is
one change to all three — a developer on one major and the image on another is how "works locally"
fails in the container. Editor settings (`.editorconfig`) are an optional project file; the linter
remains what enforces the format.

## What the build emits

The build config excludes **every** top-level TypeScript directory outside `src/` — tests, scripts,
tooling — and the test-only files that live beside the code inside it: specs, builders and doubles.
The migrations are under `src/` and compile with the application.

```jsonc
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "test", "scripts", "dist", "**/*spec.ts", "**/*.builder.ts", "**/*.double.ts"]
}
```

One missing entry moves the whole output. TypeScript computes the common root of the files it
compiles: leave `scripts/` in and the root rises from `src/` to the repository, so the output
becomes `dist/src/main.js` plus `dist/scripts/` instead of `dist/main.js`.

Everything downstream then breaks at once, and none of it mentions the build:

- `node dist/main` — the start script and the container entrypoint — exits with "cannot find module"
- assets copied to `dist/<name>/` are no longer beside the code that resolves them from `__dirname`,
  so translations and templates fail at runtime with a path nobody wrote

`npm run start:dev` keeps working throughout, because it runs from a different path. The failure
appears only in the production start and in the image — which is the worst place to find it.

**Check the output layout once, when the project is set up**: build, and confirm `dist/main.js`
exists at the top and that the copied assets sit beside it.

## Lint, format, and the hook

The linter owns formatting and import order, and `--fix` applies it. The `code-conventions` skill
states the rule: where the linter and a convention disagree, the linter wins.

**Which means the config has to enable the rules those conventions depend on.** A convention the
linter stays silent about is a suggestion: it holds while everyone remembers it and stops the first
time someone does not. Worse, "the linter wins" then reads as permission.

At minimum:

| Rule | Without it |
| --- | --- |
| `@typescript-eslint/no-explicit-any` | `any` is forbidden by convention and accepted by the build |
| `no-console` | `console.log` in a service passes review and ships |
| `@typescript-eslint/explicit-function-return-type` | Return types drift to whatever is inferred |
| `@typescript-eslint/explicit-member-accessibility` | `public`/`private` becomes optional, so it stops meaning anything |
| `@typescript-eslint/no-floating-promises` | An unawaited call loses its errors silently |
| `@typescript-eslint/no-unused-vars` | Dead imports and parameters accumulate |
| `@typescript-eslint/consistent-type-imports` (`separate-type-imports`) | A type reference becomes a runtime `require`, and closes a cycle the container finds at boot |
| The import plugin's type-specifier-style rule (`prefer-top-level`) | `import { type X }` mixes a type into a value import, which the first rule does not reject |
| `curly: ["error", "all"]` | A bare `if (x) return;` beside braced guards, and a body that grows a second line without them |
| `@stylistic/padding-line-between-statements`, `"always"` before and after `multiline-` `const`, `let`, `expression`, `block-like`, `return`, `export` and `type`, and between `const`/`let` and `expression` | A wrapped call butts against the next statement and the two read as one lump, and a declaration runs into the work that uses it |
| `local/padding-between-expression-kinds` | An assignment, a function call, a method call and an awaited step run together |
| `@stylistic/padded-blocks`, `"never"` for blocks, classes and switches | A body opens or closes on a blank line, and nothing else stops it |
| `no-restricted-syntax` on `CallExpression[optional=true]` | A conditional call hides its branch in `?.()` |
| `@typescript-eslint/naming-convention` over a list of abbreviations | `APIError` beside `ApiPagination`: one word, two spellings |

**One rule is the project's own.** Copy
[assets/eslint-rules/padding-between-expression-kinds.mjs](assets/eslint-rules/padding-between-expression-kinds.mjs)
and its type declaration
[assets/eslint-rules/padding-between-expression-kinds.d.mts](assets/eslint-rules/padding-between-expression-kinds.d.mts)
into the project's `eslint-rules/`, and register it as a local plugin:

```typescript
import { paddingBetweenExpressionKinds } from "./eslint-rules/padding-between-expression-kinds.mjs";

export default tseslint.config({
  plugins: {
    local: { rules: { "padding-between-expression-kinds": paddingBetweenExpressionKinds } },
  },
  rules: {
    "local/padding-between-expression-kinds": "error",
  },
});
```

It has an autofix and a test of its own in the project's suite. What it enforces, and why, is
`code-conventions`'.

**The abbreviation rule is `naming-convention` over a list.** No format can tell `API` from the
start of a word, so the rule rejects each listed abbreviation written in capitals — a plural `s`
included, unless an uppercase letter comes before it or a lowercase one after, so `IPasswordHasher`
(`I` + `Password`) passes — and skips a name in SCREAMING_SNAKE_CASE. A project adds its own
vocabulary to the list. `Id` is in it, so `userID` fails beside `userId`. It checks declarations
only — variables, functions, parameters, types, classes, methods — because a property's name is
often a contract (a JSON field, a stored one) and a destructured binding repeats one; those are the
reviewer's (see `code-conventions`).

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
);
```

`consistent-type-imports` skips every file with decorators on its own, so in those files the
convention is kept by hand — `code-conventions` owns the rule and its exception.

The `no-unsafe-*` family is a separate decision. Those fire on values coming out of third-party
types the project does not control — decorator metadata, driver results — rather than on `any`
written here, which the first rule already rejects. Turning them on is defensible; turning them on
and then disabling them file by file is not.

Where a rule genuinely has to be suspended, suspend it on the line with the reason next to it:

```typescript
// An entry point's sanctioned console call: the application was never created, so there is no Logger.
// eslint-disable-next-line no-console
console.error({ message: "Application failed to start", error });
```

Scripts every project has, under these names so any script that calls them keeps working:

```json
{
  "start:dev": "nest start --watch",
  "build": "nest build",
  "lint": "eslint \"{src,test,scripts}/**/*.{ts,tsx}\" --fix",
  "typecheck": "tsc --noEmit",
  "test": "jest",
  "test:integration": "jest --config ./test/jest-integration.json",
  "test:e2e": "jest --config ./test/jest-e2e.json",
  "migrate": "nest build && node dist/cli/migrate up"
}
```

What each test script runs and against what is the `testing` skill's.

A pre-commit hook runs two things: the linter on the staged files, then a full typecheck of the
project. The second is there because nothing else before a push catches a cross-file type error —
a type error in a file you did not stage, such as a constructor that gained a dependency while its
spec was not updated. The staged-file linter cannot see that file, the build excludes specs, and the
test runner transpiles each file without checking types.

The hook still has to stay fast enough that nobody reaches for the flag that skips it — a hook
people bypass is a hook that does nothing. The linter is fast because it sees only the staged files;
the typecheck emits nothing, so it costs seconds rather than a build, and it is the cheapest place
that error is ever found. Anything slower — the test suites — belongs in continuous integration, not
here.

## `main.ts`

Bootstrap is one function, and several of its steps only work in the right order.

```typescript
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  const config: ConfigService<EnvironmentVariables, true> = app.get(ConfigService);

  app.use(helmet());
  app.disable("x-powered-by");

  app.set("trust proxy", config.get("TRUST_PROXY_HOPS", { infer: true }));

  app.enableCors(corsOptionsFrom(config));

  configureRequestPipeline(app);

  app.enableShutdownHooks();

  await app.listen(config.get("PORT", { infer: true }), "0.0.0.0");
}

bootstrap().catch((error: unknown): void => {
  // eslint-disable-next-line no-console
  console.error({ message: "Application failed to start", error });
  process.exit(1);
});
```

`corsOptionsFrom` stands for the project's own function that builds the CORS options — the explicit
origin list and credentials — from validated configuration; what they contain is the `security`
skill's. The response headers and the removed `X-Powered-By` are the two lines that skill asks for
at bootstrap, before the routes. Every `config.get` passes `{ infer: true }` (see the
`configuration` skill).

Everything a request passes through before it reaches a controller — the route prefix and the API
version, the body parser's limit, the cookie parser and the global pipes — lives in one exported
function, because the end-to-end tests need the identical arrangement:

```typescript
export const REQUEST_BODY_LIMIT: string = "100kb";

export function configureRequestPipeline(app: NestExpressApplication): void {
  app.setGlobalPrefix(API_PREFIX, { exclude: [LIVENESS_PATH, READINESS_PATH] });

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: DEFAULT_API_VERSION });

  app.useBodyParser("json", { limit: REQUEST_BODY_LIMIT });
  app.useBodyParser("urlencoded", { limit: REQUEST_BODY_LIMIT, extended: true });

  app.use(cookieParser());

  app.useGlobalPipes(
    new EmptyBodyPipe(),
    new I18nValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
}
```

It takes the Express application type because the body-parser call is Express's; the end-to-end
suite creates its application with the same type argument. The limit and why it is written down
belong to the `security` skill; the prefix, the version and why the health routes are excluded
belong to the `presentation-layer` skill. A test that sets them up itself, or forgets to, asserts
against routes the application does not serve.

**Middleware bound to every route names the route as
`{ path: "{*path}", method: RequestMethod.ALL }`**, declared once and shared — the logger's route
list included, since the logger module's own default is a bare `*`. Under a global prefix a bare `*`
becomes `/api/*`, a pattern the router rejects and rewrites with a warning on every boot.

A test that arranges its own copy of this list is testing an application that does not exist, and
the copy drifts silently — the bug lands in production while its test keeps passing. See the
`testing` skill.

**No pipe rewrites what the caller sent.** A global pipe that trims every string reaches the values
no rule should touch, and the first of those is a password: a passphrase with a trailing space is
stored without it, and its owner can never type what the server believes they chose. Normalizing a
value — trimming a name, lowercasing an email — is a rule about that value, so it lives in the value
object that owns it (see the `domain-modeling` skill), where it applies to that field and nothing
else. A password is never normalized at all.

The empty-body pipe is the one pipe that touches the body, and it adds nothing the caller did not
send; what it does and why belongs to the `error-handling` skill.

**One validation pipe, not two.** `I18nValidationPipe` IS a `ValidationPipe` and takes the same
options. Registering the plain one as well puts it first in the chain, where it throws its own
untranslated exception and the translating pipe never runs. What reaches the client is a raw
translation key with the rejected value embedded in it — the submitted password included.

The steps whose order is load-bearing:

- **`bufferLogs` then `useLogger`** — Nest's own boot lines are held until the real logger is
  installed, so nothing is printed twice or in the wrong format.
- **Security headers before the routes**, or the first responses go out without them.
- **`trust proxy` before anything reads the client address.** Its value is a hop count from
  validated configuration, because only the deployment knows how many proxies sit in front. A wrong
  value lets a client forge its own address and defeat every per-address limit; the `security` skill
  owns why.
- **Cookie parsing before the guards run**, or the authentication guard finds no cookie and every
  browser client falls back to a header it is not sending. It is inside `configureRequestPipeline`
  for that reason: the ordering has to hold in the tests too.
- **`enableShutdownHooks` before listening.** Without it no shutdown hook ever runs, and every
  deploy drops in-flight work (see the `observability` skill).
- **The port comes from validated configuration**, not from a fallback (see the `configuration`
  skill).

The global validation pipe's flags are a security decision; the `security` skill owns them.

The bootstrap's own `catch` is a sanctioned `console.error`: the application was never created, so
there is no `Logger` to reach for (the `code-conventions` skill owns the rule and its other entry
points). It prints and exits non-zero. A process that fails to start and stays alive is reported
healthy by the platform.

## The root module

`AppModule` imports the configuration module with its validation, the global infrastructure modules,
and every feature module. Beyond imports it holds only what is global by nature:

- **The global exception filter and the global guards, together** — the rate-limit guard, the
  authentication guard and the permission guard. Their order is the order they run in, and it is
  only readable in one place. Authorization is opt-out for the same reason authentication is (see
  the `authorization` skill).
- **The domain-error status registry** and the shared error-status list; each feature provides its
  own list from its own module (see the `error-handling` skill).
- **Middleware bound to every route**, in `configure()` — the trace id before the request context
  that reads it.

Nothing else: it is a wiring file, and it reads no configuration. Configuration read there rather
than where it is used puts a value one layer away from the code that depends on it — so a framework
module that needs configuration is wrapped in a module of `common/infrastructure` whose factory
reads it, and the root module imports the wrapper:

```typescript
@Module({
  imports: [
    I18nModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>): I18nOptions => ({
        fallbackLanguage: config.get("DEFAULT_LANGUAGE", { infer: true }),
        loaderOptions: {
          path: TRANSLATIONS_PATH,
          watch: config.get("NODE_ENV", { infer: true }) !== "production",
        },
      }),
    }),
  ],
})
export class I18nConfigModule {}
```

Every factory declares its return type, like any other function. Every framework module that reads
configuration gets a wrapper like this one; a connection goes inside the module that already
registers the providers that use it. A file watcher, a pretty-printer or anything else meant for a
developer is switched off in production in that factory, where the module is configured, and
nowhere else.

## Local development

A compose file brings up the database — a replica set, because transactions require one and a
standalone instance rejects them. Discovering that when the first transaction is written is a
half-day nobody planned.

**Every image is the vendor's official one, pinned to an exact version** — a tag such as
`mongo:8.0.32`, not `mongo:8` and never `latest`. A floating tag means two people cloning on
different days run different databases, and a third-party repackaging can disappear from the
registry. Moving a version is a change to the file, reviewed like any other.

The official database image starts a single-node replica set with authentication in three pieces:

- `mongod --replSet <name> --keyFile <file>` — a replica set with authentication needs a key file
  its members share; with one member, a fresh one is written at every start, owned by the server's
  user and readable by it only.
- **The healthcheck initiates the set.** The server cannot initiate itself and a one-shot container
  would race it, so the first probe that finds no replica set runs `rs.initiate`, and the check
  passes only once the member is primary — until then every write fails, and "bring it up, then
  seed" would lose that race on a cold start.
- The member is named `localhost`, and the application connects through the published port with
  `directConnection=true`, so no client ever resolves the name from outside. The set's name, like
  the port and the credentials, is derived from the connection string.

**Copy [assets/compose.database.yml](assets/compose.database.yml) into the local compose file** when
the project has no database service yet, with `my-project` replaced by the project's name; it is the
three pieces above, with the derived variables.

Keep the local stack to what the application cannot start without. Anything optional stays behind a
simulator selected by the environment (see the `module-wiring` skill), so a new contributor is
running in minutes without credentials to third-party services.

**A port the application connects to is never a literal here.** A host port belongs to one container
at a time, so two projects that hardcode the conventional numbers cannot run together — and the
failure is quiet. The second stack to start fails to bind and its container exits; the application
then connects to the **first** project's database, on the same port, with the same client. If the
credentials happen to match, nothing fails at all: it starts, reports healthy, and reads and writes
the wrong data.

The port published and the port the application dials are **one value**, written once in the
application's variable and derived for compose — the `configuration` skill owns the derivation, the
constants that stay in the compose file, and the `:?` guard.

Pair this with naming the target at boot (see the `observability` skill) — that line is what makes
this five seconds to diagnose instead of an afternoon.

## Checklist

- [ ] The tree has `common/` and `features/`, and every feature has all four layers.
- [ ] The `@/` alias is declared in the compiler config, the runtime resolver, and the test mapper;
      `@test/*` in the compiler config and every test runner's mapper, and nowhere in `src/` outside
      a spec.
- [ ] `strict` is on, with the unused and fallthrough checks.
- [ ] The build config excludes every top-level directory outside `src/` plus specs, builders and
      doubles, and `dist/main.js` is at the top of the output.
- [ ] The Node version in `.nvmrc`, `engines` and the Dockerfile `FROM` is the same.
- [ ] The lint config enables every rule in the minimum table, the project's own rule registered
      from `eslint-rules/`.
- [ ] Scripts exist for dev, build, lint, typecheck, test, integration and e2e, under the
      conventional names.
- [ ] A pre-commit hook lints staged files and then typechecks the whole project.
- [ ] `main.ts` installs the logger after buffering, sets the security headers, takes the proxy hop
      count from validated configuration, and enables shutdown hooks before listening.
- [ ] Cookie parsing sits in the shared request pipeline, before the guards.
- [ ] Every `config.get` passes `{ infer: true }`, and every provider factory declares its return
      type.
- [ ] The shared request pipeline sets the body limit explicitly, and no global pipe alters a
      request value; the empty-body pipe only substitutes `{}` for an absent body.
- [ ] The port and every other value come from validated configuration with no fallback.
- [ ] No port the application connects to is written twice: compose derives it from the
      application's variable, and only local-interface ports are literals.
- [ ] The local database runs as a replica set.
- [ ] Every image in the compose file is an official one, pinned to an exact version.
- [ ] Every command a deployment runs lives under `src/`.
- [ ] Every framework module that reads configuration is wrapped in its own module; the root module
      has no factory.
- [ ] The root module holds only imports, the global filter and guards, the error-status registry,
      and the every-route middleware in `configure()`.
