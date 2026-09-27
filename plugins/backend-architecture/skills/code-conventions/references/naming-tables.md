# Naming tables

The two lookup tables of the `code-conventions` skill, each with the rules that read it. What the
tables cannot settle stays in that skill's `SKILL.md`.

## Names by context

| Context | Convention | Example |
| --- | --- | --- |
| Files, folders | kebab-case + type suffix | `create-user.usecase.ts`, `users-mongo.repository.ts` |
| Classes | PascalCase | `CreateUserUseCase` |
| Interfaces (contracts) | PascalCase, `I` prefix | `IUserRepository`, `IEventBus` |
| Types (data shapes, unions) | PascalCase, no prefix | `UserDTO`, `DataResponse` |
| Abbreviations | one word in capitals; all lowercase at the start of a camelCase name | `APIPagination`, `HTTPClient`, `buildAPIError`, `apiURL` |
| `Id` | a word, as the stored fields spell it | `userId`, `findById()` |
| Functions, methods, variables | camelCase | `getUserById()`, `userId` |
| Getters / setters (reads and writes of a value) | native accessors, never `getX()`/`setX()` | `get email()` |
| Private members | `_camelCase` | `_usersRepository`, `_assertActive()` |
| Module-level constants | SCREAMING_SNAKE_CASE | `MAX_RETRIES` |
| DI tokens | SCREAMING_SNAKE_CASE + `_TOKEN`, `unique symbol` | `USERS_REPOSITORY_TOKEN` |
| Environment variables | SCREAMING_SNAKE_CASE | `MONGO_URI` |
| Database collections | snake_case plural | `order_items` |
| Document fields | camelCase | `createdAt`, `preferredLanguage` |
| Enumerable values (a value union's members, an audit action) | snake_case | `pending_creation`, `roles_assigned` |
| Error codes | `<feature>.snake_case` | `orders.order_already_settled` |
| REST routes | kebab-case, under the version | `/api/v1/user-profiles` |
| Query parameters | camelCase | `?sortBy=name` |

## File suffixes by artifact

A file's suffix says what it holds before it is opened, and it is what a glob keys on — the build
and coverage exclusions, a test runner's pattern. The test files' own suffixes belong to `testing`.

Two kinds of file take **no suffix**, and the rule for each has no exceptions:

- **What its folder already names.** Value objects in `value-objects/`, helpers in any `utils/`
  folder — `fingerprint.ts`, `holds-exactly.ts`. A `.util` suffix inside `utils/` says the same
  thing twice.
- **A port's implementation**, named for its technology and the port it implements, as the
  kebab-case of its class: `bcrypt-password-hasher.ts`, `system-clock.ts`, `s3-file-storage.ts`,
  `nodemailer-email-service.ts`, `mongo-transaction-manager.ts`. The technology is the one thing
  that tells it from the next implementation of the same port; a suffix such as `.adapter` or
  `.service` on some of them and not others is how a glob or a grep misses half.

Mappers take the **layer** in the suffix because a feature has two of them, and a bare
`user.mapper.ts` in two folders gives two different classes the same name.

**Plural vs singular.** Artifacts that serve the whole feature take the **feature name (plural)**:
module, repository, controller, errors file, errors map, event handlers. Artifacts that describe or
convert one thing take the **entity name (singular)**: entity, schema, DTO, value object, command,
and both mappers (`user.persistence-mapper.ts`).

| Suffix | Holds |
| --- | --- |
| `.entity` | An entity or aggregate |
| `.repository` | A repository interface in `domain/`; its implementation is `<feature>-mongo.repository.ts` |
| `.usecase` | A use case |
| `.command` / `.query` | A command; `.query` for a list query command |
| `.result` | A use case's result type |
| `.policy` | A domain or application policy |
| `.schema` | A persistence schema |
| `.controller` | A controller |
| `.dto` | A request or response DTO |
| `.module` | A Nest module |
| `.events` / `.errors` | The feature's domain events / domain errors |
| `.errors-map` | The feature's error-to-status list, in presentation |
| `.handlers` | The feature's event handlers |
| `.interface` | A port declared in `application/` |
| `.guard` / `.decorator` / `.pipe` / `.filter` / `.middleware` | The framework artifact of that name |
| `.factory` | A named provider factory |
| `.persistence-mapper` / `.presentation-mapper` | A mapper, named for its layer |
| `.error` | One shared error class in `common/` |
| `.service` | An injectable that implements no port — the request context |
| `.validation` | The environment validation |
| `.email.tsx` | An email template |
| `.builder` / `.double` | A test builder / a test double, beside what it builds or stands in for; excluded from the build and from coverage |
