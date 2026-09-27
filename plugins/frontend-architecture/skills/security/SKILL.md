---
name: security
description: "Browser security — what React escapes and the few ways around it (raw HTML, `javascript:` URLs, code built from strings), a URL from data rendered as a link or opened, the Content-Security-Policy the server sends and what each directive allows, inline styles and scripts it refuses and the one library element turned off for it, adding an origin a provider needs, framing, tokens out of every script's reach, and dependencies as code that runs with the page's privileges."
when_to_use: "Trigger on — `dangerouslySetInnerHTML`, rendering HTML or Markdown that came from the API or a user, `innerHTML`, `eval`, `new Function` or a string passed to `setTimeout`, a link whose `href` comes from data, a `javascript:` URL, `window.open` or `target=\"_blank\"`, editing the `Content-Security-Policy`, a CSP violation in the console, 'Refused to apply inline style' or 'Refused to load the script', adding a third-party script or loading one from a CDN, an `<iframe>` or embedding the application in another site, `npm audit`, or adding a dependency."
---

# Security

The page runs whatever script reaches it with the reader's session. The defences are layered: React
escapes what it renders, the page avoids the few ways around that, and the server sends a policy that
refuses scripts, styles and connections from anywhere it did not name — so an injection that gets
through has nothing to load and nowhere to send what it reads.

## What React escapes, and what it does not

React escapes every string it renders as text or as an attribute, so data from the API shown in
`{…}` is text, whatever it contains. What bypasses that is always explicit:

- **`dangerouslySetInnerHTML` is not used.** HTML from the API or from a user is rendered as text. A
  feature that must render rich text renders it from a structured format with components — never
  sanitized HTML, whose sanitizer is one more dependency to trust and to keep patched.
- **No `innerHTML`, `outerHTML` or `document.write`**, and no reaching around React to the DOM to set
  one.
- **No code built from strings**: `eval`, `new Function`, and `setTimeout` or `setInterval` given a
  string. The Content-Security-Policy refuses them too.

## A URL from data

React renders an `href` as given, and a `javascript:` URL in it runs when clicked. **A URL that comes
from data is checked before it becomes a link**: parsed, and kept only when its protocol is one the
page means to follow.

```typescript
const SAFE_LINK_PROTOCOLS = new Set(["https:", "http:", "mailto:"]);

export function toSafeHref(url: string): string | undefined {
  try {
    return SAFE_LINK_PROTOCOLS.has(new URL(url).protocol) ? url : undefined;
  } catch {
    // Not an absolute URL, so not a link this page follows.
    return undefined;
  }
}
```

A link to another site opened in a new tab takes `rel="noopener noreferrer"`, so the opened page
cannot reach back into this one. A path inside the application goes through the router's `Link`,
typed against the route tree; where a path arrives from the URL itself — the redirect after
sign-in — which ones are followed is `authentication`'s.

## Tokens out of reach

The session lives in HttpOnly cookies that no script can read, and the page stores no token of its
own (see `authentication`). That is what keeps an injected script from carrying the session away:
it can still act as the reader while the page is open, which is what the policy below narrows.

## The Content-Security-Policy

The server sends it with every response (where headers are sent from is `deployment`'s):

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self';
connect-src 'self' <the API's origin>; object-src 'none'; base-uri 'self'; form-action 'self';
frame-ancestors 'none'
```

- **Scripts, styles and fonts come from this origin only**, and no inline script or inline `<style>`
  runs. The bundle is files on this origin, so the application needs nothing else. The positions a
  component writes to an element's `style` go through the DOM, which the policy does not govern.
- **`connect-src` names the API and nothing else**, so a script that reads the page has nowhere to
  send it. The API's origin is written into the policy when the image is built, from the same build
  argument the bundle compiles in (see `configuration`).
- **`frame-ancestors 'none'`**: no site may frame this one, which is the defence against clickjacking.
- **`object-src 'none'`, `base-uri 'self'`, `form-action 'self'`** close the plugin, base-tag and
  form-hijack routes.

**The policy holds the application to it, not the other way round.** When a library injects an inline
`<style>` element, the library is told not to — the component library is configured without its style
elements, and its one rule carried in the stylesheet (see `ui-components`) — rather than adding
`'unsafe-inline'`. A catalog file that renders one itself is changed the same way: the chart's color
rules go into a constructed stylesheet instead of an inline `<style>` (see `ui-components`).

**Adding a provider that talks to another origin** — an error reporter, a Web Vitals collector (see
`observability`) — adds exactly that origin to `connect-src`, and to `script-src` only if its script
cannot be bundled. A policy that fails in production and passes locally is caught by running the
end-to-end suite against the served image, which sends the real policy (see `testing`).

The policy is the last layer, not the first: every rule above still applies with it in place.

## Dependencies

Every package runs with the page's privileges, so adding one is a decision:

- **The lockfile is committed and installs are reproducible** (`npm ci` in the image).
- **Before adding a package**, check it is maintained, what it pulls in, and what it adds to the bundle
  — the build reports each chunk's size. A few lines the project owns beat a package for them.
- **`npm audit` findings are read, not silenced**: one that reaches code the page runs is fixed by
  upgrading; one confined to development tooling is judged as such. A dependency kept past its
  declared peer range is kept with its reason (see `project-bootstrap`).

## Checklist

- [ ] No `dangerouslySetInnerHTML`, `innerHTML`, `eval`, `new Function` or string timer.
- [ ] Every `href` built from data passes a protocol check; every external link opened in a new tab
      has `rel="noopener noreferrer"`.
- [ ] No token is stored or readable by a script.
- [ ] The server sends the policy above, with `connect-src` naming only this origin, the API and each
      provider the application reports to.
- [ ] No `'unsafe-inline'` or `'unsafe-eval'`; a library that injects inline content is configured not
      to.
- [ ] The lockfile is committed, and every new dependency was weighed before it was added.
