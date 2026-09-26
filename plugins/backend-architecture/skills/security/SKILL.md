---
name: security
description: "Hardening the request surface — rejecting undeclared body fields, body and array limits, escaping user text in a regex, uploads validated by content, presigned uploads confirmed before serving, downloads as attachments, rate limiting per address and per account, CSRF for cookie-authenticated requests, CORS with credentials, the trust proxy hop count, response headers, secrets, and classifying personal data."
when_to_use: "Trigger on — configuring the validation pipe, an undeclared field that reached the database, an unbounded array in a request, building a search filter from user text, accepting or signing an upload, serving a stored file back, an upload that was never completed, adding a rate limit, setting the trust proxy hop count, a limiter that does not hold across replicas, guessing passwords for one account from many addresses, enabling CORS, a forged cross-site request, a secret reaching code, a log or a response, classifying a field as personal data, a secret compared with ===, or a cookie setting that quietly disables SameSite."
---

# Security

This skill is about the surface: what arrives, what is allowed through, and what leaves. Who the
caller is belongs to `authentication`; what they may do belongs to `authorization`.

## Reject what was not declared

The global validation pipe is the translating one (the `i18n` skill names the class and
`project-bootstrap` registers it), and it runs with three options on:

```typescript
new I18nValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true })
```

`whitelist` strips properties no DTO declared; `forbidNonWhitelisted` rejects the request instead;
`transform` turns the payload into an instance of the DTO so its decorators and types apply.

Without them, an undeclared field travels wherever the body is spread — and the shape that gets
exploited is a create or update that copies the payload onward, letting a caller set `role`,
`status`, `tenantId` or `balance` on an entity no endpoint ever meant to expose. Rejecting rather
than stripping is the stricter choice and the right default: a client sending a field the API does
not accept has a bug, and silence lets that bug ship.

**Body size is limited** at the framework level, **with the limit written down** in the shared
request pipeline rather than inherited from the parser's default. An endpoint that accepts arbitrary
JSON accepts an arbitrarily large allocation, which is a denial of service anyone can send, and a
ceiling nobody wrote is one nobody reviews.

**Every collection in a request is bounded**, and so is every element in it: `ArrayMaxSize` on the
list, `MaxLength` with `each: true` on its strings, `MaxLength` on a single id in a query. A list of
ids becomes a lookup per element — often inside the transaction that writes — so an unbounded one is
the caller deciding how much work the database does while holding a session.

## User input in a regular expression

A search term interpolated into a pattern lets the caller write the pattern. Two things follow: they
can match far more than intended, and they can send a pattern whose backtracking never terminates —
one request that pins a core until the timeout.

Escape it, always. Where the runtime has `RegExp.escape` (Node 24 and later, with the matching
TypeScript `lib`), that is the escape; on an older runtime it is one shared helper, never an inline
character class written at each call site:

```typescript
// ❌ the caller controls the pattern
filter.name = { $regex: search, $options: "i" };

// ✅ the caller controls only the text
filter.name = { $regex: RegExp.escape(search), $options: "i" };
```

Anchor the pattern where the query allows it, and cap the term's length at the DTO.

## File uploads

Every one of these, every time:

- **A size limit**, declared per endpoint.
- **An allowlist of types, checked against the file's actual content**, not its extension and not
  the client-supplied content type. Both are caller-controlled strings.
- **A generated storage name.** Never the uploaded filename: it can carry path separators, traversal
  sequences, or a second extension.
- **Storage outside anything that serves files**, retrieved through an endpoint that applies the
  same authorization as any other read.
- **No execution, ever** — nothing derived from an upload is a path passed to a shell, a template,
  or an image library invoked with caller-supplied options.

### When the bytes never reach the API

A presigned upload sends the file straight to the storage provider. That removes a whole class of
problem — no request body to exhaust, no temporary file — and takes the content check away with it:
there is nothing here to inspect.

So the constraints move into the signature. The key, the content type and the size are signed, the
provider enforces them at the moment of upload, and a caller presenting anything else is rejected
before a byte is stored — it cannot widen what it was granted by editing its own request. **Signing
the length pins it exactly, not as a ceiling**: the caller declares the size in advance and must
then send precisely that.

What is *not* recovered is the content check, and pretending otherwise is the mistake. The stored
type is **declared, never verified**, so anything that depends on it being true — rendering it
inline, handing it to an image library — verifies the bytes when it reads the object.

**A download is served as an attachment, under the type the record was accepted with.** Both go into
the signed link — `ResponseContentDisposition` set to `attachment` with the name, and a fixed
`ResponseContentType` — so the browser saves the file instead of rendering it, and never sniffs
declared-PDF bytes into markup that runs on the storage origin. The filename is caller text: encode
it in the RFC 5987 `filename*` form and give a plain `filename` fallback with quotes, backslashes
and control characters replaced, or a name carrying a line break writes the next header. A record
whose type has since left the allowlist is refused, not relabelled — a PDF header on something that
is not one is a lie told to whatever opens it.

**An upload is not a file until something has seen it.** The record exists from the moment the URL
is signed, and the bytes may never follow. So the record starts **pending**; the client confirms
once it has uploaded, and the API asks storage for the object's real size and type (a `HEAD`) and
compares them with what was declared before marking it uploaded. Nothing is served while pending. A
sweep with a lock removes the pending records past a threshold far beyond the URL's lifetime — the
object first, then the record, so an interrupted run leaves a record the next run finds rather than
an object nothing points at (see the `background-jobs` skill).

The record of the upload is written before the URL is signed, and the URL is signed outside the
transaction: a link handed out for a record that then rolled back points at a file nothing knows
about.

## Rate limiting

Two layers with different jobs:

- A **global** limit per address, absorbing unauthenticated noise.
- A **per-identity** limit on the routes that deserve one: login (keyed by the account, below),
  anything that sends a message or costs money, anything expensive to compute. Refresh is keyed by
  an unguessable token, so there is nothing worth counting per identity before it verifies; the
  per-address limit is what applies there.

**A shared counter is what makes the number mean something.** An in-process counter is per replica:
four instances allow four times the configured limit, because each keeps its own count of the same
caller. It also resets on every deploy, so a limit measured in hours is a limit a release lifts.

A single-replica deployment can live with that, and a project may reasonably decline to run a shared
store for it — that store is a service to operate, back up and monitor. What it may not do is leave
the limitation implicit. **Write it where the limiter is configured**, in the terms that matter:
what it still bounds (one client hammering one instance — the accidental loop, the crude scraper)
and what it does not (anything distributed or patient). The danger is not the weak limit; it is the
belief that a control exists.

Then it is one swap when the deployment grows: the storage changes and nothing else in the
configuration does.

**A per-address limit on credentials is tuned against a fact about addresses.** Offices, schools,
universities and mobile carriers put thousands of people behind one egress address, so a limit of a
handful per minute locks out people who did nothing wrong. Pick a number that is not a viable
guessing rate against a password hashed at your configured cost — which is a far higher number than
instinct suggests — and put the tight per-identity limit where you have an identity to key on.

**Login has an identity to key on: the account.** A second limit counts attempts per email, from
anywhere — ten in fifteen minutes is nothing to a person who mistyped and everything to somebody
working through a list. Three details decide whether it holds:

- **The key is normalized exactly as the value object normalizes it.** It runs in a guard, before
  validation, so it reads the raw body; if it did not lowercase and trim the same way, every change
  of case would be a fresh allowance. Share the normalization function rather than restating it.
- **The key is hashed** before it reaches the counter store, which then holds no addresses.
- **It shares the storage of every other limit**, so the per-replica caveat applies to it as well
  and one storage swap fixes both.

It is also the one limit a stranger can spend on somebody else's behalf: ten bad passwords for an
address lock its owner out for the rest of the window. Keep the window short, and make it a delay
rather than an account lock.

A rejected request answers 429 with `Retry-After`, and CORS exposes it. A client with no idea when
to retry retries immediately — and a browser hides every response header CORS does not name, so a
front end on another origin sees the 429 and never the header.

**Rate limiting is defense in depth, never the correctness fix.** It narrows the window; it does not
close it. Two simultaneous requests still get through, so the endpoint's real guarantees —
idempotency, serialization — belong in the use case. See the `transactions-and-consistency` skill.

A limiter that is wired correctly but never rejects looks exactly like one that is never reached, so
verify it with a real burst rather than by reading it.

## The client address behind a proxy

Behind a load balancer the socket address is the proxy's, and the client's is in `X-Forwarded-For`.
The framework's `trust proxy` setting says how many hops of that header to believe, and **the hop
count is validated configuration** — the number of proxies the deployment actually puts in front of
the process (see `configuration`; `project-bootstrap` shows the line that applies it).

Both wrong directions fail silently. Too high, and the framework reads an entry the client wrote
itself: any caller forges its address, which defeats every per-address limit and puts fiction into
the audit trail's addresses. Too low, and every request carries the proxy's address, so one caller
exhausting the limit locks out everybody.

## CSRF

Cookie authentication means the browser attaches the credential to requests the user did not
knowingly make. Another site cannot read the cookie, and does not need to: it only has to make the
browser send one.

`SameSite` is what stops that, and the value is **`strict`, written in code, not in configuration**:

```typescript
// The whole CSRF defense of the cookie transport. A setting that may only ever hold one value is
// not a setting — it is a way to turn the defense off with no error and no log line.
const SAME_SITE: CookieOptions["sameSite"] = "strict";
```

The other two values are worth knowing in order to refuse them:

- **`lax`** withholds the cookie from POST, PATCH, PUT and DELETE, and still attaches it to
  top-level GET navigations. That is safe exactly as long as **no GET changes state** — which makes
  that REST convention a security property rather than a style preference, and a promise about every
  endpoint anybody adds later.
- **`none`** attaches it always. That is the attack.

`strict` costs one thing, and it belongs in the comment next to it: a link followed from outside —
an email, a chat message — lands on the application without the cookie on that first request. An app
that fetches from its own origin is unaffected, because everything after the first load is
same-site. A server-rendered page that must appear signed in on arrival is the case for `lax`, and
that is a decision somebody makes deliberately.

**Ports do not count.** The browser compares *sites*, not origins: scheme plus registrable domain.
`localhost:5173` calling `localhost:3000`, or `app.example.com` calling `api.example.com`, are
same-site and work under `strict` with nothing configured. Only a different registrable domain is
cross-site — and that is the case cookies do not serve.

**A client on another site uses the header transport.** Nothing attaches an `Authorization` header
automatically, so it has no CSRF surface at all. That is the answer, and it needs no mechanism.

A project that genuinely needs cookies across sites adds a check first, and then relaxes the value.
Double-submit is about forty lines over the standard crypto library: a non-`HttpOnly` cookie holding
a random value, the client echoing it in a header, and a guard comparing the two in constant time.
The obvious library in the Express ecosystem, `csurf`, has been unmaintained since 2022 — reaching
for it adds a dependency and a false sense of currency at once.

Keep that as a recipe next to the cookie policy, not as code shipped switched off. A mechanism
nobody exercises is the one that fails on the day it is turned on — see the stub rules in
`module-wiring`.

## CORS

Origins are listed explicitly. **A wildcard origin is incompatible with credentials** and the
browser will refuse the combination, which is where "it works with the header and not with cookies"
comes from.

- Enumerate allowed origins from configuration, never reflect the request's `Origin` back.
- Validate each entry at startup as an origin — scheme, host and port, no path, no trailing slash.
  The browser compares the `Origin` header exactly, so `https://app.example.com/` matches nothing
  and CORS refuses the front end it was written for, naming nothing.
- Enable credentials only when cookie authentication is in use.
- List the methods and the allowed request headers explicitly — only what the API's routes accept,
  so a method no route serves is not in the list — and expose only the response headers a client
  needs to read.

## Response headers

Set the standard hardening headers once, globally: strict transport security, deny framing, no MIME
sniffing, a referrer policy, and a content security policy on anything that serves markup. An API
that serves only JSON still benefits — the browser's protections apply to whatever ends up being
rendered.

Remove the headers that advertise the framework and its version. `X-Powered-By` changes no
behavior and tells anybody scanning which stack to look up known issues for — information with no
upside.

Both are two lines at bootstrap, before the routes are registered:

```typescript
app.use(helmet());
app.disable("x-powered-by");
```

**The strict content policy breaks the one page an API does serve.** A JSON API renders no markup,
so `script-src 'self'` costs nothing — until the documentation viewer, which loads its bundle from a
CDN and boots with an inline script. It renders blank, in the console, and no test sees it: every
other route answers JSON.

Relax it **on that path**, with a second middleware that runs after the global one and replaces the
header for those requests only:

```typescript
app.use(DOCS_PATH, helmet({ contentSecurityPolicy: { useDefaults: true, directives: { /* … */ } } }));
```

Loosening `script-src` application-wide to render a developer tool trades the protection on every
endpoint for a page, and the endpoints are what an attacker is aiming at. Keep the exception narrow
— this origin and the one CDN — and remember what bounds `unsafe-inline` there: the page renders no
caller-supplied content, and an allowlist already decides who reaches it.

## Comparing a secret

A secret presented by a caller — an API key, a webhook signature, a reset token — is never compared
with `===`:

```typescript
// ❌ returns as soon as two characters differ, and that difference is measurable
if (presented !== expected) { throw new UnauthorizedException(); }

// ✅ fixed-length inputs, one comparison time
timingSafeEqual(sha256(presented), sha256(expected));
```

The timing of a short-circuiting comparison leaks the secret one character at a time to anybody who
can send enough requests. Hashing both sides first is what makes the comparison length-independent
as well — otherwise the length leaks, and `timingSafeEqual` throws outright on a length mismatch.

The operator key that protects a maintenance endpoint is the standing case — `authorization` says
when an endpoint uses one.

Belt and braces on a guard nothing uses yet is still worth it: a building block is copied into the
route that needs it, and the copy is what ships.

## Secrets

- **Never in the repository.** Not in code, not in a committed env file, not in a fixture, not in a
  test. A secret in git history is compromised from the moment it is pushed, and rewriting history
  does not un-leak it.
- Injected by the platform as environment variables, required at startup with no default (see the
  `configuration` skill).
- **Never logged, never returned, never in an error message.** Masking is a safety net for what
  slips through, not a substitute for not putting it there.
- Rotatable without a code change, which means nothing derives a second value from a secret at build
  time.

## Personal data

Classify each stored field once: is it personal data or not. **Request metadata counts**: the
address and the user agent recorded on every audit entry, and the address on every request log line,
identify a person as surely as a name does. The classification drives three decisions, and having it
written down is what makes those decisions consistent:

- **What is masked** in logs and error output (see the `observability` skill).
- **What is returned** by an endpoint, and to whom — a field only its owner may see is a
  resource-level rule, not a field to omit sometimes.
- **What an erasure request has to reach**, including copies in the audit trail (see the `audit-log`
  skill) and any denormalized copies (see `pagination`).

Do not store what the product does not need. The safest handling of a field is not having it.

## Checklist

- [ ] The validation pipe rejects undeclared properties, and the body limit is set explicitly.
- [ ] Every array in a request DTO has a maximum size, and every string in it a maximum length.
- [ ] No user string reaches a regular expression unescaped, and the escape is `RegExp.escape` where
      the runtime has it.
- [ ] An upload whose bytes bypass the API carries its constraints in the signature, and nothing
      downstream treats the declared type as verified.
- [ ] An upload is served only after storage confirmed its size and type, as an attachment under
      the recorded type; pending uploads past a threshold are swept, object first.
- [ ] Every upload is size-limited, type-checked by content, renamed, and stored where nothing
      executes it.
- [ ] Rate limits exist per identity on sensitive routes and share their counter across replicas, or
      the limiter's configuration states what a per-replica counter does and does not bound.
- [ ] The trust proxy hop count comes from validated configuration and matches the proxies in front
      of the process.
- [ ] Login is limited per account as well as per address, keyed on the normalized, hashed email.
- [ ] Rejections answer 429 with `Retry-After`, and CORS exposes the header.
- [ ] Auth cookies are `SameSite=strict` in code, with no setting able to weaken it.
- [ ] CORS origins are enumerated from configuration, validated as exact origins at startup, and
      never reflected.
- [ ] Hardening headers are set globally and framework version headers removed.
- [ ] Every secret presented by a caller is compared in constant time, over digests.
- [ ] No secret is in the repository, in a log, or in a response.
- [ ] Every stored field is classified as personal data or not.
