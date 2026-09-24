# Naming tables

The two lookup tables of the `code-conventions` skill. The rules that explain them, and settle what
they cannot, stay in that skill's `SKILL.md`.

## Names by context

| Context | Convention | Example |
| --- | --- | --- |
| Files, folders | kebab-case + type suffix | `create-user.usecase.ts`, `users-mongo.repository.ts` |
| Classes | PascalCase | `CreateUserUseCase` |
| Interfaces (contracts) | PascalCase, `I` prefix | `IUserRepository`, `IEventBus` |
| Types (data shapes, unions) | PascalCase, no prefix | `UserDTO`, `DataResponse` |
| Acronyms in classes/types | UPPERCASE | `APIPagination`, `HTTPClient` |
| Acronyms in variables/properties | camelCase | `apiUrl`, `httpClient` |
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

A file's suffix says what it holds before it is opened, and it is what a glob keys on. Two kinds of
file take no suffix at all — see "Naming conventions" in `SKILL.md`.

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
