# Naming tables

The two lookup tables of the `code-conventions` skill, each with the rules that read it. What the
tables cannot settle stays in that skill's `SKILL.md`.

## Names by context

| Context | Convention | Example |
| --- | --- | --- |
| Files, folders | kebab-case, never camelCase | `create-user-form.tsx`, `use-debounced-filter.ts` |
| Components | PascalCase; the file is its kebab-case | `CreateUserForm` in `create-user-form.tsx` |
| A component's props | `<Component>Props` | `CreateUserFormProps` |
| A companion skeleton | `<Component>Skeleton`, in the component's file | `UsersTableSkeleton` |
| Hooks | `use` + PascalCase; the file is its kebab-case | `useDebouncedFilter` in `use-debounced-filter.ts` |
| Types | PascalCase, no prefix | `User`, `Paginated<T>`, `Session` |
| Abbreviations | one word in capitals; all lowercase at the start of a camelCase name | `UserDTO`, `APIError`, `buildAPIError`, `apiClient` |
| `Id` | a word, as the backend's fields spell it | `userId`, `roleIds` |
| Functions, variables | camelCase | `resolveRedirect()`, `sessionKey` |
| Module-level constants | SCREAMING_SNAKE_CASE | `FILTER_DEBOUNCE_MS` |
| A duration or a size | the unit as a suffix | `ERROR_TOAST_TIMEOUT_MS`, `USERS_PAGE_SIZE` |
| A value catalog and its union | `<CONCEPT>_VALUES`, and the concept as the type | `USER_STATUS_VALUES`, `UserStatus` |
| A query options factory | `<entity>Queries` | `userQueries.detail(id)` |
| A mutation hook | `use<Action><Entity>` | `useCreateUser`, `useSignOut` |
| A route's typed API in a component | `<name>Route` | `usersRoute = getRouteApi("/_app/users/")` |
| A form's values | `<Form>FormInput` (what the fields hold), `<Form>Values` (what is sent) | `CreateUserFormInput`, `CreateUserValues` |
| Environment variables | `VITE_` + SCREAMING_SNAKE_CASE | `VITE_API_URL` |
| Query and search parameters | camelCase — the backend's names | `?sortBy=name` |

## File suffixes by artifact

A file's suffix says what it holds before it is opened, and it is what a glob keys on — the coverage
exclusions, the lint ignores, the test runner's pattern. Components, hooks, a feature's model files
and helpers in a folder that already names them take **no** suffix: `users-table.tsx`,
`use-session.ts`, `user.ts`, `format.ts`.

| Suffix | Holds |
| --- | --- |
| `.mapper.ts` | The functions from one generated DTO to the feature's model, named for the entity: `user.mapper.ts` |
| `.schema.ts` | A Zod schema and the types around it — a form's (`create-user.schema.ts`) or a route's search params (`users-search.schema.ts`) |
| `-queries.ts` | A feature's query options, named for what they read: `user-queries.ts` |
| `-mutations.ts` | A feature's mutation hooks, named for what they write: `user-mutations.ts` |
| `-page.tsx` | A page — what a route renders: `users-list-page.tsx` → `UsersListPage` |
| `.gen.ts` | Written by a tool and committed; never edited by hand |
| `.d.ts` | An augmentation of a library's types |
| `.test.ts` / `.test.tsx` | A test, beside what it tests |
| `.builder.ts` | A test builder |
