---
name: authorization
description: "Permissions in the browser — the permission catalog taken from the generated types, the permissions a session carries rather than a token's, `hasPermissions` requiring every one, the three places a permission is checked (the route, the component, the API) and which of them protects anything, the guard in a route's `beforeLoad` that throws before any loader, a layout route that guards everything below it, hiding what the reader may not use, navigation shown only to who may open it, `ForbiddenError` and the forbidden screen in place with the URL kept, and a read the API refuses."
when_to_use: "Trigger on — checking a permission, a `resource:action` permission string, `requirePermissions`, `useHasPermissions` or `hasPermissions`, hiding a button, a column or a menu item, a navigation link to a page that answers 'no access', a route the reader lacks the permission for, `ForbiddenError`, the forbidden page, redirecting away from a page the reader may not see, a 403 from the API, 403 against 404, checking a role by name, an admin or root bypass, or permissions that stay stale after an administrator changed them."
---

# Authorization

The backend decides what each account may do, and says so in the session: the permissions its access
token carries (see `authentication` for the session). The browser uses them for one thing — **not
showing the reader what they cannot use** — and never believes that protects anything.

## The catalog

**A permission is a member of the backend's catalog, taken from the generated types**, never a string
typed again:

```typescript
export type Permission = SessionDTO["permissions"][number];
```

A permission the backend renames or drops is then a compile error at every check that names it,
instead of a gate that is silently always closed. How the catalog reaches the generated file is
`api-client`'s.

**The check is on permissions, never on a role.** A role is a name for a set of permissions that an
administrator can change; code that checks `role === "admin"` is wrong the day the set changes. There
is no bypass either — no permission that means "everything" — because the backend has none.

```typescript
export function hasPermissions(session: Session, required: readonly Permission[]): boolean {
  return required.every((permission: Permission): boolean => session.permissions.includes(permission));
}
```

**A check names what it needs, and needs all of it**: `hasPermissions(session, ["users:read",
"users:update"])` is true only with both.

## Three places, one of which protects

| Where | What it does | What it protects |
| --- | --- | --- |
| The route's `beforeLoad` | Refuses the page before any of its data is requested | Nothing: it saves a request and shows the right screen |
| The component | Hides a button, a link, a column | Nothing: it keeps the reader from a dead end |
| The API | Refuses the request | Everything |

The browser's checks are about **what the reader sees**. Anyone can change what runs in their own
browser, so a permission the API does not check is a permission nobody has to hold.

### The route

A route that needs a permission requires it in its `beforeLoad`, reading the session its layout's
guard put in the context (the lifecycle is `routing`'s). `SignedInContext`, exported beside the
guards, names that context — the router's plus the session — so the callback's argument is typed in
words a reader can follow:

```typescript
export function requirePermissions(session: Session, required: readonly Permission[]): void {
  if (!hasPermissions(session, required)) {
    throw new ForbiddenError();
  }
}
```

```tsx
export const Route = createFileRoute("/_app/users")({
  beforeLoad: ({ context }: { context: SignedInContext }): void => {
    requirePermissions(context.session, ["users:read"]);
  },
});
```

- **Thrown before any loader runs**, so nothing the reader may not see is ever requested.
- **A layout route guards everything below it**: the permission every page of a section needs goes in
  the section's `route.tsx`, and a page that changes something adds its own on top (`users:create` on
  the create page, `users:update` on the edit page).
- **A page requires every permission its reads need**, so the API refusing one of them means the
  session changed since the page opened, not that the page forgot a check.

### The component

```typescript
const canCreateUsers = useHasPermissions(["users:create"]);
```

```tsx
{canCreateUsers && <Link to="/users/new" className={buttonVariants()}>{t("list.create")}</Link>}
```

- **What the reader may not use is not rendered** — not disabled, not shown with a lock. A button that
  cannot be pressed explains nothing; its absence is the explanation.
- **A navigation entry appears only to who may open its page.** A link that leads to "no access" is a
  dead end, so the entry is a component of its feature that renders `null` without the permission,
  and the shell receives it as a prop (see `project-bootstrap` for why the shell takes it that way).
- **`useHasPermissions` tolerates a session that is `null`**, answering `false`: signing out empties
  the session a moment before the page is left.

## Refused

**A route the reader may not open shows the forbidden screen in its place, and the URL stays.** It is
not a redirect home and not a not-found page in disguise: the backend answers the same request `403`,
and a reader who knows they lack a permission knows whom to ask for it. The route's error component
renders it for a `ForbiddenError` and for an `APIError` with status `403` alike, with no retry — asking
again changes nothing (see `error-handling`).

`ForbiddenError` lives in `common/`, because the error component that shows it is shared, and it is
an expected failure: the error reporter leaves it out, like a failed request (see `observability`).

**403 against 404 is the backend's call.** A resource the reader may not see, answered `404` so its
existence is not revealed, is shown as not found; one answered `403` is shown as forbidden. The front
shows what the status says and never guesses which the backend meant.

## When permissions change

The permissions in the session are the access token's, so an administrator's change reaches the
reader at the next refresh — when the access token is renewed, the session is read again (see
`authentication`). Until then the browser may show a button the API will refuse; the API's refusal is
the answer, and the refresh brings the screen in line.

## Checklist

- [ ] Every permission named in code is a member of the generated catalog.
- [ ] No check on a role and no bypass; every check requires all the permissions it names.
- [ ] Every route that needs a permission throws `ForbiddenError` from its `beforeLoad`, or sits under
      a layout route that does, before any loader.
- [ ] Every button, link, column and navigation entry that needs a permission is not rendered without
      it.
- [ ] A refusal shows the forbidden screen in place, keeping the URL, with no retry.
- [ ] Every endpoint behind a hidden control is also refused by the API.
