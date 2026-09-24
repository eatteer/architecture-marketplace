---
name: authentication
description: "Proving who a caller is — password hashing behind a port, issuing access and refresh tokens, what belongs in the token versus what is looked up, an HttpOnly cookie by default with a bearer header for non-browser clients, the token's resolution order, mirroring the transport in the login and refresh responses, refresh rotation and reuse detection, logout and revocation, the authentication guard and the principal it attaches, and marking a route public."
when_to_use: "Trigger on — writing login/refresh/logout, hashing or verifying a password, signing or verifying a token, choosing token claims or lifetimes, setting or clearing an auth cookie, writing the authentication guard or `@CurrentUser()`, a mobile or service client that cannot use cookies, a session that cannot be revoked, a stolen refresh token rotated forever, a session that survives a password change or a suspension, two simultaneous refreshes that both succeed, a logout that answers 401, or a password with no maximum length."
---

# Authentication

This skill answers *who is calling*. What they are allowed to do belongs to the `authorization`
skill; hardening the surface around both belongs to `security`.

## Passwords

Hashing is a port (see the `application-layer` skill), so the algorithm is an infrastructure
decision and the use case never names it:

```typescript
export interface IPasswordHasher {
  hash(plainPassword: string): Promise<string>;
  verify(plainPassword: string, hashedPassword: string): Promise<boolean>;
  placeholderHash(): string;
  needsRehash(hashedPassword: string): boolean;
}
```

- Use an adaptive algorithm with a configurable cost. The cost factor is an environment variable, so
  it can be raised without a code change as hardware gets faster.
- **Verify even when the account does not exist.** Skipping the hash comparison on an unknown email
  makes the response measurably faster, which turns login into an account-enumeration oracle. Run
  the comparison against a placeholder hash and answer the same error either way.
- **The placeholder hash is built at the configured cost**, behind the hashing port, from a random
  value. A hardcoded one carries whatever cost it was generated with, so the moment the configured
  cost differs the two comparisons take measurably different times again — and the oracle is back,
  now hidden behind code that looks like it closed it.
- **The failure message never says which half was wrong.** "Invalid credentials", for both an
  unknown email and a wrong password.
- **Bound the password's length, in the algorithm's units.** bcrypt hashes the first 72 BYTES and
  ignores the rest without a word, so with no upper bound two passwords sharing that prefix
  authenticate each other and the 100-character passphrase somebody chose for safety is a 72-byte
  one. A character-counting rule is nearly right, which is worse than wrong here: 72 accented
  letters pass it and are 144 bytes. Count bytes, and reject rather than truncate.
- A password hash never leaves the domain: not in a DTO, not in a log, not in an event payload.
- When the cost factor changes, rehash on the next successful login — the only moment the plaintext
  is available. Raising the cost otherwise protects only the accounts created after the change, and
  nothing says so.
- **Rehashing is not a password change.** Routing it through the same entity method appends an audit
  entry nobody performed and publishes the event that revokes the user's sessions — signing them out
  for successfully signing in. It needs a method of its own that records nothing: the secret did not
  change, only its encoding.

## Tokens

Two tokens, with different jobs and different lifetimes:

- **Access token** — short-lived, sent with every request, carries the claims the guards need.
- **Refresh token** — long-lived, sent only to the refresh endpoint, carries almost nothing.

```typescript
export type JWTPayload = {
  sub: string;
  type: ActorTypeValue;
  permissions: PermissionValue[];
  jti: string;
};
```

`iat` and `exp` are not part of the type: the signing library adds them from the configured
lifetime, and nothing past the verifier reads them.

**What belongs in the token is what a guard needs to reject a request without a database read.**
Identity, kind of principal, and permissions qualify. Anything a use case will load the entity for
anyway does not — a name, an email, a status: they bloat every request, and they are a copy that is
stale from the moment it is signed.

`jti` is what makes a specific token addressable, which is what revocation needs. The access
token's `jti` is the id of the refresh record issued with it, which is what lets logout identify the
session from the access token alone when no refresh token is presented.

The signing secrets and both lifetimes are environment variables, and the access and refresh tokens
are signed with **different** secrets — so a leaked access-token secret cannot be used to mint
refresh tokens.

## Transport: cookie by default, header as the alternative

One scheme, two transports. Not two designs.

**The default is an `HttpOnly` cookie.** The browser cannot read it, which removes token theft by
cross-site scripting from the threat model entirely — the one class of attack a token in JavaScript
storage cannot be defended against from the server.

```typescript
const options: CookieOptions = {
  httpOnly: true,
  secure: configService.get("COOKIE_SECURE", { infer: true }),
  sameSite: "strict",
};

response.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, { ...options, path: "/" });

response.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
  ...options,
  path: REFRESH_COOKIE_PATH, // `/${API_PREFIX}/v${DEFAULT_API_VERSION}/auth`
  expires: tokens.expiresAt,
});
```

**The secure flag is configuration** only so local development works over plain HTTP; every
deployment sets it true (see the `configuration` skill). `sameSite` is not configurable — see CSRF
below.

**Each cookie lives as long as what it carries.** The access cookie is a session cookie: the token
inside it expires on its own schedule, and a cookie outliving it only sends a dead credential. The
refresh cookie expires at the refresh record's expiry — an absolute instant from the same value the
record stores, so the two cannot drift apart.

The refresh cookie's `path` covers the routes that consume it — refresh and logout — and nothing
else. It is the more valuable of the two, so it never reaches the rest of the API. It is built from
the same prefix and version the routes are: a cookie whose path stops matching is never sent, and
the only symptom is every refresh answering 401.

Scoping it to the refresh endpoint alone looks tighter and breaks logout: a browser cannot read an
`HttpOnly` cookie to put it in a request body, so a cookie client ends up with no way to tell logout
which session to end.

**`Authorization: Bearer` remains valid** for callers that are not a browser — a mobile app, a
service, a script. Same token, same signature, same guard, same claims.

**The token resolves in one fixed order: cookie first, then header.** Written once, in one function
the guard and logout share — logout is public, so it resolves the token without the guard, and a
second copy of the order is a second answer to "which credential is this request using". An empty
cookie counts as absent: `cookie ?? header` would pick `""` over a valid header.

```typescript
export function extractAccessToken(request: Request): string | undefined {
  const fromCookie = request.cookies?.[ACCESS_TOKEN_COOKIE];

  if (typeof fromCookie === "string" && fromCookie.length > 0) {
    return fromCookie;
  }

  const header = request.headers.authorization;

  if (header !== undefined && header.startsWith(BEARER_PREFIX)) {
    return header.slice(BEARER_PREFIX.length);
  }

  return undefined;
}
```

### The response mirrors how the request arrived

A caller that authenticated by cookie gets `Set-Cookie` and a body with no tokens in it. A caller
that used the header gets the tokens in the body.

Returning the tokens in the body to everyone throws away the entire benefit: the value becomes
readable from JavaScript again, which is the thing `HttpOnly` exists to prevent.

For the first login there is no prior transport to mirror, so the client states which it wants — a
field on the login request, defaulting to cookies.

**One condition decides both the token and the transport.** Two conditions that nearly agree are a
bug waiting for an odd client:

```typescript
// ❌ "non-empty string" chooses the token, "is a string" chooses the transport — an empty cookie on
//    a header client gets Set-Cookie and nulls in the body
const presented = typeof cookie === "string" && cookie.length > 0 ? cookie : dto.refreshToken;
const transport = typeof cookie === "string" ? "cookie" : "header";

// ✅
const fromCookie = refreshTokenCookie(request);
const presented = fromCookie ?? dto.refreshToken;
const transport = fromCookie !== undefined ? "cookie" : "header";
```

### What cookies bring with them

- **CSRF becomes real.** A cookie is attached by the browser automatically, so a request forged by
  another site carries it. `SameSite=strict` is the defense, written in code rather than left
  configurable — a front end on a different **site** (ports and subdomains do not count) uses the
  header transport instead. The `security` skill owns the reasoning and the recipe for the case that
  genuinely needs cookies across sites.
- **CORS must allow credentials from listed origins** — the `security` skill owns the configuration.
- **Logout can actually clear the credential**, which a header-only design cannot do. See below.

## Refresh

The refresh endpoint verifies the refresh token, issues a new pair, and **invalidates the one it was
given**. Rotation is what bounds the damage of a stolen refresh token to a single use.

Rotation with reuse detection follows RFC 9700 (the OAuth 2.0 Security Best Current Practice),
§4.14.

**A rotating credential needs a ceiling on the chain, not only on each link.** Every rotation issues
a replacement expiring a full lifetime from now, so the expiry slides forever and a family that is
used never ends. For a person that is the point — they are not asked to sign in again while they
keep using the product. For a stolen token it is the whole problem: the thief rotates on a schedule,
the sliding expiry never arrives, and reuse detection never fires because only one party is
presenting anything. Carry the instant the family began on every record, never recomputed —
recomputing it is the same as having no ceiling — and refuse a rotation past it. Reaching the
ceiling revokes the family rather than only refusing it, so raising the setting later cannot bring
the family back.

Two configuration values, and the difference between them is the bug: one bounds a single token, the
other bounds the family. A cap written on the first while the comment beside it describes the second
is a control that does not exist. Where both are configured, startup refuses a family ceiling
shorter than the token lifetime — each is valid alone, and together no refresh can ever succeed.

**A refresh token presented twice means something is wrong.** Either it was stolen and both parties
are now using it, or a client replayed it. Either way the honest response is to invalidate the whole
family of tokens descended from that login and force a fresh sign-in. Detecting this needs the
issued tokens' identifiers stored, which is the same store revocation uses.

**Rotation is a claim, not a read followed by a save.** Reading the token, finding it usable and
then saving it revoked is the textbook lost update: two refreshes presenting the same token both
read it as usable, both save, and both receive a working replacement — so the reuse that should have
burned the family is never noticed. Exactly the case rotation exists for.

The condition travels with the write, and the answer decides the outcome:

```typescript
// repository — the filter is the guard
const result = await this._model
  .updateOne(
    { _id: token.id, revokedAt: null },
    { $set: { revokedAt: token.revokedAt, replacedById: token.replacedById } },
  )
  .session(sessionOf(transaction))
  .exec();

return result.matchedCount === 1;
```

```typescript
// use case — a refresh that lost the race is indistinguishable from reuse, so it is treated as reuse
const claimed = await this._refreshTokensRepository.claimRotation(stored, transaction);

if (!claimed) {
  return { kind: "reused", familyId: stored.familyId };
}

await this._refreshTokensRepository.save(replacement, transaction);
```

The replacement is written **after** the claim. Written before, it survives as a usable token
belonging to a rotation that never happened.

The reuse reaction cannot be thrown from inside that unit of work: revoking the family and then
throwing rolls the revocation back. The transaction returns what it decided, and the caller acts on
it afterwards — see the `transactions-and-consistency` skill.

Refresh is the one endpoint where a 401 is routine, so the client must treat it as "sign in again",
not as an error to retry.

## Logout and revocation

A signed token is valid until it expires; nothing about verifying it consults a database. So
revocation is a deliberate mechanism, not a property you get for free:

- **Logout is public, always answers 204 with no body, and always clears the cookies.** Behind the
  global guard an expired access token — the ordinary state of a tab left open overnight — answers
  401, so the cookies are never cleared and the refresh token stays valid. Signing out is a request
  to end up signed out: every way of failing to identify the session still leaves the caller signed
  out, and an error only makes a client retry with the credential it is trying to drop.
- **Logout revokes the family, not the record it was handed.** Revoking one token leaves every other
  token descended from that sign-in usable — including the replacement from the last rotation, which
  is the one an attacker would be holding.
- **Identifying the session tolerates an expired token but never a bad signature.** Verify with
  `ignoreExpiration`, and never by decoding: without the signature check, naming somebody's token id
  is enough to end their session.
- **Revoking a session** — an administrator ending someone's access, a password change — records the
  revocation and, if it must take effect before the access token expires, requires the access token
  to be checked against the revocation store too.

**A password change revokes every refresh token the user holds.** This is the one that gets
forgotten, because the revocation method exists and nothing calls it. Verifying a refresh token
consults nothing about the password, so a token issued before the change keeps working after it —
and somebody changing their password is usually doing it *because* they believe a credential is
compromised. The session the thief holds is precisely the one that has to die.

**A suspension revokes them too, and so does a deletion.** The refresh endpoint re-checks the
account and refuses a suspended one, which looks like enough — until the account is reactivated, and
every family issued before the suspension works again. An operator suspending an account means the
sessions end now; reactivating gives back the account, not the sessions. A deletion is the same
argument with nothing left to protect: without the revocation the only thing refusing those tokens
is a soft-delete filter in a repository two features away.

When the feature owning passwords may not depend on the feature owning tokens — the dependency
usually runs the other way already — a domain event carries it, and the auth feature subscribes (see
the `event-driven` skill). Revocation then lands just after the commit rather than inside it: state
the trade, and log a failed revocation at `error`, because what failed is a security action.

**The event is the fast path, not the guarantee.** The in-process bus loses an event when the
process dies between the commit and the handler, and a session that outlives a suspension is exactly
what a person would notice missing. So a scheduled sweep, under a lock, pages through the users who
still hold a live session and revokes every one whose account is suspended, deleted or gone (see the
`background-jobs` skill for the job's shape). A run that revokes anything logs it at `warn`: each
one is an event that did not do its job.

That last point is the real trade, and it is worth stating explicitly rather than discovering: a
short access-token lifetime keeps verification free and accepts a window; checking every request
against a store closes the window and adds a lookup to every request. Pick one per project, and say
which.

## The guard and the principal

The authentication guard runs globally, verifies the token, and attaches a principal:

```typescript
export type Principal = {
  sub: string;
  type: ActorTypeValue;
  permissions: string[];
  jti: string;
};
```

It is declared in the shared presentation code, because the error filter, the decorators and the
audit trail all read it. `permissions` is `string[]` there so shared code does not depend on the
authorization feature's catalog.

`@CurrentUser()` reads it. Controllers convert it into an `Actor` and pass nothing else inward (see
the `presentation-layer` skill).

Routes that must be reachable without a token — login, refresh, health — are marked with an explicit
decorator the guard checks. **Opt out per route, never opt in**: with a global guard, a forgotten
decorator on a public route is a 401 somebody reports immediately, while a forgotten guard on a
protected route is an open endpoint nobody notices.

Login and refresh are rate limited; that belongs to the `security` skill.

## Checklist

- [ ] Hashing is behind a port, with the cost factor in configuration.
- [ ] An unknown email and a wrong password cost the same time and return the same error.
- [ ] No hash appears in a DTO, a log, or an event.
- [ ] Access and refresh tokens use different secrets and different lifetimes.
- [ ] The token carries only what a guard needs, plus a `jti`.
- [ ] Auth cookies are `HttpOnly`, the secure flag comes from configuration and is true in every
      deployment, and the refresh cookie is scoped to its own path.
- [ ] One function resolves the access token, cookie first then header, treating an empty cookie as
      absent, and both the guard and logout call it.
- [ ] Login and refresh return tokens in the body only to header clients.
- [ ] Refresh rotates the token with a conditional write, treats a rotation that is not claimed as
      reuse, and revokes the whole family on reuse.
- [ ] Every refresh record carries the instant its family began, copied on rotation; a rotation
      past the family ceiling is refused and revokes the family; startup refuses a ceiling shorter
      than the refresh token lifetime.
- [ ] A password change, a suspension and a deletion each revoke every refresh token the user
      holds, and reactivating restores none of them.
- [ ] A locked, scheduled sweep revokes the live sessions of every suspended or deleted account,
      catching what a lost revocation event left behind.
- [ ] Logout is public, answers 204, always clears the cookies, and revokes the whole family.
- [ ] One condition decides both which token is read and which transport answers.
- [ ] Public routes are marked explicitly against a global guard.
