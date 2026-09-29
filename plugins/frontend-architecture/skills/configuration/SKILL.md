---
name: configuration
description: "Build-time configuration — `VITE_*` variables compiled into the bundle and readable by anyone who loads the page, validated with Zod once when the bundle loads, required with no default or optional when absence switches a capability off, read only through the configuration module, `.env.example` as the list of what exists, one build per environment, the values the test runner uses, and the same-site origins the cookie session requires."
when_to_use: "Trigger on — `import.meta.env`, `process.env` in browser code, adding a `VITE_` variable, `.env` or `.env.example`, `env.ts`, an API key, token or secret in the frontend, a request to `undefined/api/v1`, a variable that works in dev and is missing from the build, a default or an empty value for a variable, pointing the application at another backend, `VITE_API_URL`, `--build-arg`, a runtime config file or `window.__CONFIG__`, or the frontend and the API on different domains."
---

# Configuration

Vite compiles every variable prefixed `VITE_` into the bundle when it builds. Configuration is
therefore **fixed at build time**, and **public**: anyone who loads the page can read every value in
it.

## Nothing secret, ever

**A `VITE_*` variable is configuration, never a secret.** An API key, a signing secret, a service
token — anything that must not be known — cannot live in the front end at all, however it is named or
obfuscated: the browser has to hold it to use it, so the reader holds it too. What needs a secret
happens in the backend, and the browser calls the backend.

`.env.example` says so at its top, because it is where the next variable gets added.

## Validated once, read through one module

```typescript
const envSchema = z.object({
  VITE_API_URL: z.url(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(source: Record<string, unknown>): Env {
  const result = envSchema.safeParse(source);

  if (!result.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(result.error)}`);
  }

  return result.data;
}

export const env = parseEnv(import.meta.env);
```

- **Validated when the bundle loads**, so a missing or malformed variable stops the application with
  a message naming it, rather than showing up later as a request to `undefined/api/v1/…`.
- **Every variable is required, and none has a default**, typed by its schema — a URL is `z.url()`,
  a number is coerced once here and never parsed again by its readers. A default is a second place
  the value can come from, and a build that forgot the variable ships quietly pointing at it.
- **`import.meta.env` is read in this module and nowhere else.** The lint config refuses it elsewhere
  (see `project-bootstrap`), so no reader gets a raw, unvalidated string. `process.env` is not in
  browser code at all: the application's compiler config has no Node types.
- **`parseEnv` takes its source as an argument**, so the tests exercise it with a literal.

## An optional variable is absent, or valid

A variable is **optional** only when its absence switches a capability off — an analytics or error
reporting endpoint an environment does not have yet — and never when its absence would stand for a
value. It is `.optional()` in the schema, and it has two states: absent, the reader gets `undefined`
and turns nothing on; present, it is validated in full. `""` is neither: `VITE_X=""` fails the schema,
because `.optional()` accepts only `undefined` and a blank line is one somebody meant to fill in.
Variables that only work together are optional together, checked as all or none with a refinement on
the schema.

**`.env.example` lists every variable**, with a comment saying what it is and an example value — an
optional one commented out, with what its absence means. A variable added to the schema is added
there in the same change. `.env` itself is git-ignored.

## One build per environment

Because the values are compiled in, **a different backend is a different build.** The image takes
the API's address as a build argument, and the same value writes the Content-Security-Policy's
`connect-src` (see `deployment` and `security`). There is no runtime config file fetched at startup:
it would be a second source of configuration, unvalidated until it arrived, and one more request
before the first render.

## The tests' own values

**The test runner sets the configuration the tests run with**, in its own config (`test.env`), so a
suite never depends on whoever's `.env` is on disk — `VITE_API_URL` points at a host that exists only
in the network mock (see `testing`).

## Same-site origins

The session cookies are `SameSite=strict`, and a browser does not send them on a request from another
*site* — so **the front end and the API must be same-site**, which the configured address has to
respect. `localhost:5173` calling `localhost:3000` is same-site; so is `app.example.com` calling
`api.example.com`. `app.example.com` calling `api.example.net` is not, and every request arrives with
no session. The API's CORS configuration must also list the front end's origin. The client's side of
it — asking for the cookies at all — is `api-client`'s.

## Checklist

- [ ] No secret in any `VITE_*` variable, and nothing in the bundle that must not be public.
- [ ] Every variable is declared in the schema, validated when the bundle loads, and listed in
      `.env.example`.
- [ ] No variable has a default; an optional one switches a capability off when absent, rejects
      `""`, and is listed commented out.
- [ ] `import.meta.env` appears only in the configuration module, and `process.env` not in browser
      code.
- [ ] The tests set their own configuration.
- [ ] The API's address is a build argument, and the deployed origins are same-site and allowed by
      the API's CORS.
