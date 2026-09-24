---
name: authorization
description: "Deciding what a caller may do — the permission catalog as the single source, roles as named sets of permissions, the permission guard and its decorator, a superuser bypass, the staleness of permissions carried in the token, and resource-level access: ownership, tenant scoping, and answering not-found instead of forbidden."
when_to_use: "Trigger on — an ownership check on a back-office action, adding a permission, writing `@RequirePermissions` or the permission guard, adding a role or changing what a role grants, a caller who passes the route guard but is reading somebody else's record, scoping a query to a tenant, choosing between 403 and 404 for a record the caller may not see, a permission change that does not take effect until the user signs in again, an endpoint that checks the verb but not the row, a route open to every signed-in caller, registering the permission guard, a caller type invented to grant more access, a maintenance endpoint behind an API key, or a listing that returns records the by-id endpoint refuses."
---

# Authorization

Two questions, and both have to be answered. The route guard answers *may this kind of caller do
this kind of thing*. Only the use case can answer *may this caller do it to this record*.

An endpoint that asks the first and not the second is the most common real vulnerability in a CRUD
API: every authenticated user has `orders:read`, and one of them changes the id in the URL.

## The permission catalog

Every permission is declared once, in one file, as a `const` array plus its derived union:

```typescript
export const PERMISSION_VALUES = [
  "users:read",
  "users:create",
  "users:update",
  "orders:read",
  "orders:settle",
] as const;

export type PermissionValue = (typeof PERMISSION_VALUES)[number];
```

`resource:action`, lowercase, one entry per thing a caller can do. The array types the decorator,
the token claim, the role document and the administration endpoint, so a permission that does not
exist is a compile error rather than a silent denial.

Keep it flat. A hierarchy where one permission implies others means the effective set has to be
computed, and then two places compute it differently.

## Roles

A role is a named set of permissions, stored as data — created and edited through its own endpoints,
under its own permissions. Permissions are the catalog in code; roles are a product decision an
operator makes.

A principal's effective permissions are the union of its roles'. That resolution happens at sign-in
and at every refresh, and the result goes into the token.

## Carrying permissions in the token

The guard reads permissions straight off the verified token, so authorizing a request costs nothing
and needs no database.

**The cost is staleness.** A permission granted or revoked takes effect on the next token the
principal receives — so up to one access-token lifetime later. That is the trade, and it is usually
the right one.

Taking somebody's access away entirely is not a permission change: it is a suspension of the
account, which revokes its sessions rather than editing a role (see the `authentication` skill).

When a revocation must take effect immediately, the options are the same two the `authentication`
skill lays out for sessions: shorten the access-token lifetime, or check each request against a
store. Resolving permissions from the database on every request is the same choice wearing different
clothes — say which one the project makes rather than leaving it to be discovered.

## The route guard

```typescript
@RequirePermissions("orders:settle")
@Post(":id/settle")
public async settle(/* ... */): Promise<void> {}
```

The guard reads the required permissions from the decorator and compares them against the
principal's. Required permissions are **all** required; a route needing either of two is a route
whose permission has not been named yet.

Declaring `@RequirePermissions` at the class level covers every route, and a method-level
declaration replaces it. The guard runs after the authentication guard, which is what lets it assume
a principal exists; guard ordering belongs to the `presentation-layer` skill.

**It is registered globally, like the authentication guard, and reads the same `@Public()`
opt-out.** Mounted per controller with `@UseGuards`, authorization is opt-in while authentication is
opt-out — and the asymmetry decides what a mistake costs. A new controller that declares its
permissions and forgets the guard is authenticated and unauthorized: the decorator becomes metadata
nobody reads, every signed-in caller passes, and nothing says so. No 401, no 403, no log line, no
failing test. Forgetting the opt-out instead produces a 403 on the first request, which somebody
reports that day.

Reading `@Public()` is not optional once it is global: sign-in, refresh and the health check have no
principal and no way to hold a permission, so without it the application cannot be signed in to.

**The guard fails closed.** A route under it that declares no permission is refused, and the route
that genuinely needs none says so:

```typescript
// ❌ the common shape, and it is open by default
if (required === undefined || required.length === 0) {
  return true;
}

// ✅
if (required === undefined || required.length === 0) {
  throw new ForbiddenException();
}
```

```typescript
// Acting on your own account: being signed in is the whole requirement.
@AuthenticatedOnly()
@Post("me/password")
public async changePassword(/* ... */): Promise<void> {}
```

An undeclared route is a forgotten decorator far more often than a decision, and the two are
indistinguishable to the guard unless the decision is written down. Open-by-default means the
forgotten one ships as an endpoint available to every authenticated caller, and nothing reports it —
the tests pass, because the caller who runs them is allowed.

Refusing the empty list closes the second half of the same hole: the reflector takes the method's
value over the class's, so `@RequirePermissions()` with no arguments **cancels** the permissions
declared on the controller. Treated as "declares nothing", it is refused rather than obeyed.

**A superuser bypass**, if the project has one, is a single check at the top of the guard against an
explicit marker on the principal — not a role that happens to hold every permission, which silently
stops being every permission the moment a permission is added.

## A caller type is not an authorization mechanism

The principal carries a type, and the temptation is to answer "what may this caller do" with it.
Resist it: **two groups of people who sign in the same way are two sets of permissions**, not two
types. A type that exists to say "these ones may do more" duplicates the permission system next to
itself, and the duplicate is the one nobody maintains.

A second type is for a caller that arrives through a **different door**: its own identity store, its
own credentials, its own claims — a machine-to-machine integration, a separate self-service identity
that is not a row in the same table. That distinction is real and the code branches on it.

The catalog is a per-project decision, and copying one from another product is how a type ends up
with no authentication path behind it. What that produces is worse than an unused enum: every rule
written for that type is unreachable, so it is never exercised and never wrong — until the day the
type becomes real and every one of those rules is discovered at once. An audit can only file them as
latent, which is a polite word for untested.

Only `system` is universal — the platform acting on its own, with no id. The `audit-log` skill owns
the catalog's shape.

## Operator actions outside the permission system

A maintenance endpoint — a prune, a reindex — triggered by an operator or a scheduler rather than by
one of the product's users is not something a role grants. It is marked `@Public()`, which turns off
the token guard, and protected by a guard that checks an API key header compared in constant time
(the comparison belongs to the `security` skill). The key is a required setting with a minimum
length (see `configuration`), and no role grants it. Behind the guard the route calls a use case
like any other.

Use it when the caller is outside the user base — a cron, a runbook, an operator's script with no
account. When the caller is a signed-in person, even an administrator, the action is a permission:
a key shared among people cannot say who used it, and cannot be taken from one of them.

## Resource-level access

The route guard cannot do this. It runs before anything is loaded, so it has no idea whose record is
being addressed.

**The check goes in the use case, right after the load.**

```typescript
public async execute(command: GetOrderCommand): Promise<Order> {
  const order = await this._ordersRepository.getById(command.orderId);

  if (!order || !order.isVisibleTo(command.performedBy)) {
    throw new OrderNotFoundError(command.orderId);
  }

  return order;
}
```

**This is for what the owner does with their own record.** An ownership check answers one question —
is this the caller's own — so it belongs on reading, editing and cancelling one's own thing. It does
not belong on an action the business performs ON a record: settling a payment, approving,
suspending, refunding. Those are authorized by the permission the route requires, and nothing else.

Adding one there looks like defense in depth and is the opposite. `isVisibleTo` is false for every
operator, so the endpoint answers 404 to the only caller it exists for, while the customer — if the
permission ever reaches them — can settle their own order. The check does not narrow access, it
inverts it.

The trap is that the two use cases look identical. Cancelling and settling an order differ by one
line, and only one of them should have it. Ask whose action it is, not what the code next to it
does.

Three things make this shape work:

- **The rule lives on the aggregate.** `isVisibleTo` is a method over state the aggregate
  holds, so it cannot drift between the read endpoint and the update endpoint. When the decision
  needs another aggregate, it is a policy (see `application-layer`).
- **Not-found and not-yours give the same answer.** Answering 403 for a record that exists but is
  not yours confirms it exists — which turns a list of ids into an inventory of other people's data.
  Answer 404 whenever existence itself is sensitive. Reserve 403 for the case where the caller is
  *meant* to know the resource exists and simply cannot act on it.
- **It is in the use case, not the controller.** The controller has not loaded anything, and a rule
  placed there is skipped by every other caller of the same use case.

**A listing is scoped by the same rule**, in the query rather than after it. An endpoint that
refuses to show one record and then lists a page of them is the common shape of this bug, and it
happens because the two are written months apart:

```typescript
const scoped: GetOrdersQuery = requestedBy.isSystem()
  ? query
  : new GetOrdersQueryCommand({ ...query, customerId: requestedBy.id });
```

**The owner comes from the credential, never from the request body.** A caller that names the owner
of what it creates can fill somebody else's quota, and can create records it will never be allowed
to read back. Same rule as the tenant id below, for the same reason.

## Tenant scoping

When records belong to tenants, the scope goes into the query, not into a check after it:

```typescript
const filter: Record<string, unknown> = { deletedAt: null, tenantId: query.tenantId };
```

A filter cannot be forgotten by a later endpoint the way a post-load check can, and it makes a
cross-tenant read impossible rather than merely detected. Carry the tenant on the principal, take it
from the token, and **never from a request parameter** — a tenant id a caller can send is a tenant
id a caller can change. The use case copies the tenant from the actor onto the query; the repository
never sees the principal.

A list endpoint that forgets the scope leaks every tenant's data at once, which is why this belongs
in the repository rather than in each use case.

## Adding a permission

Adding an entry to the catalog is not the whole change. The permission has to be granted to some
role, or the endpoint it protects is unreachable by everyone — including the administrator who is
supposed to be able to grant it.

The seed reconciles the administrator role to the whole catalog on every run, which is how a new
permission reaches it (see the seeding note in the `configuration` skill).

Decide at the same time whether the endpoint also needs a resource-level rule. A permission named
`orders:read` grants the *ability* to read orders; it says nothing about which ones.

## Checklist

- [ ] Every permission is in the catalog array, and nothing is compared against a literal string.
- [ ] Roles are data; permissions are code.
- [ ] Every route that is not public declares its required permissions, or is explicitly marked
      as needing only authentication.
- [ ] The guard refuses a route that declares nothing, and refuses an empty permission list.
- [ ] Any superuser bypass is one explicit check, not a role holding every permission.
- [ ] Every endpoint through which a caller acts on their own record checks ownership after loading
      it, in the use case; no action the business performs on a record carries that check.
- [ ] The visibility rule lives on the aggregate or in a policy, not inlined per endpoint.
- [ ] A record the caller may not see answers 404 unless its existence is not sensitive.
- [ ] Tenant scope comes from the token and is applied in the repository filter.
- [ ] An operator action is `@Public()` behind the API-key guard, and no role or permission grants
      it.
- [ ] The project states whether a revoked permission takes effect immediately or at the next token.
