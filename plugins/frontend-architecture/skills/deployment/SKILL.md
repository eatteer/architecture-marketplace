---
name: deployment
description: "Shipping the application — the multi-stage `Dockerfile` that builds the bundle with Node and serves it from unprivileged nginx, the API's address as a required build argument written into the bundle and the policy, the nginx config as the whole server (the SPA fallback, assets that fail as 404, caching a year only for a hashed asset that was found, `index.html` revalidated on every load, compression), every header sent from the server block and never a location, the healthcheck, `.dockerignore`, and the image's size."
when_to_use: "Trigger on — writing or editing a `Dockerfile`, `nginx.conf` or `.dockerignore`, `docker build` or `docker run`, a deep link that 404s on reload, a page that keeps loading an old deployment after a release, `Cache-Control`, a CDN caching a 404, a chunk served as HTML, `add_header` headers missing on some paths, `try_files`, a container running as root, port 80 against 8080, `HEALTHCHECK`, `EXPOSE`, `server_tokens`, gzip, HSTS, or serving the build from a bucket or another host."
---

# Deployment

What ships is one image: the bundle, built once, served as static files by nginx. The platform that
runs it is the project's choice; what the image must be for any platform to serve the application
correctly is below.

**Copy [assets/Dockerfile](assets/Dockerfile), [assets/nginx.conf](assets/nginx.conf) and
[assets/.dockerignore](assets/.dockerignore) to the repository root** when the project has no image
yet; when it has one, hold it against them. The rules below are what they encode.

## The image

Two stages: one with Node to build, one with nginx and the built files only.

- **The build stage installs from the lockfile** (`npm ci`) and runs `npm run build`. It is the only
  stage with Node, the dependencies or the source.
- **The API's address is a build argument, and required.** Vite compiles it into the bundle, so it is
  fixed when the image is built and each environment gets its own image (see `configuration`). A
  build without it fails with a sentence saying how to pass it, instead of producing a bundle that
  calls `undefined/api/v1`:

  ```dockerfile
  ARG VITE_API_URL
  RUN test -n "$VITE_API_URL" || { echo "Build with --build-arg VITE_API_URL=<the API's origin>" >&2; exit 1; }
  ENV VITE_API_URL=$VITE_API_URL
  ```

- **The same value is written into the nginx config**, in place of a placeholder in the
  Content-Security-Policy's `connect-src`, so the page may call that API and nothing else (the policy
  is `security`'s).
- **The runtime is nginx built to run unprivileged** — uid 101, listening on 8080, since only root may
  bind a port below 1024 — pinned to an exact release of the stable branch. A server broken into as
  root owns the container.
- **`EXPOSE` is documentation** of the port the config listens on; it publishes nothing.
- **The healthcheck asks nginx for `/`.** There is nothing else in the container to be unhealthy, and
  the API's health is the API's to report.
- **The Node version of the build stage agrees with the project's** (see `project-bootstrap`).
- **`.dockerignore` keeps the build context to the source**: no `node_modules`, no local build or
  coverage, no end-to-end output, no `.git`, and no `.env` — the build argument is the only way a
  value reaches the bundle, so a developer's local file never does.

**Measure the image when the base image changes** and write the size down where the project documents
its deploy; a figure nobody updates is how an image doubles unnoticed.

## The server

The nginx config is the whole server, and every line is there for a reason the application depends
on.

### Every path is the application, except the assets

```nginx
location /assets/ {
  try_files $uri =404;
}

location / {
  try_files $uri /index.html;
}
```

- **Any path that is not a file gets `index.html`**, because routes are resolved in the browser. A
  deep link or a reload on `/users/42` works, and a path no route matches gets the router's own
  not-found page (see `routing`).
- **A missing asset is a `404`, never `index.html`.** A page left open across a deployment asks for
  chunks that no longer exist; a `404` is what makes it notice and reload (see `routing`), while HTML
  served in their place would be parsed as JavaScript and fail with a syntax error nobody can act on.

### Caching

```nginx
map "$status:$uri" $cache_control {
  ~^200:/assets/ "public, max-age=31536000, immutable";
  default        "no-cache";
}
```

- **A file under `/assets/` is cached for a year**, because the bundler names it after a hash of its
  content: a changed file is a new name, so a cached one is never stale.
- **Only a `200` is**: the map keys on the status and the path together. A `404` for an asset cached
  for a year would outlive the deployment that fixes it, in every browser and every CDN in between.
- **Everything else — `index.html` above all — is `no-cache`**: kept, but revalidated on every load.
  `index.html` keeps its name across deployments and names the current assets, so a browser that
  skipped asking would go on loading a deployment that no longer exists.
- **Text is compressed** (`gzip` for scripts, styles, JSON and SVG).

### Headers belong to the server block

```nginx
add_header Cache-Control $cache_control always;
add_header Content-Security-Policy "default-src 'self'; …" always;
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
```

- **Every `add_header` is in the `server` block, none in a `location`.** A location that adds a header
  of its own drops every header inherited from the server, silently, for exactly the paths it
  matches.
- **`always`**, so the headers are also sent with an error response.
- **`server_tokens off`**: the version is nobody's business.
- **HSTS is sent by whatever terminates TLS in front of the container**; over the plain HTTP this
  server speaks, browsers ignore it.

Serving the build from somewhere else — a bucket, a CDN — means reproducing all of the above there:
the fallback, the `404` for assets, the two cache policies and the headers.

## Checklist

- [ ] The image builds with `npm ci` and `npm run build` in a Node stage, and runs unprivileged nginx
      on 8080 with only the built files.
- [ ] The API's address is a required build argument, and the same value is written into the policy.
- [ ] `.dockerignore` keeps `.env`, `node_modules`, build and test output and `.git` out.
- [ ] Every path that is not a file serves `index.html`, and a missing asset is a `404`.
- [ ] Only a `200` under `/assets/` is cached immutably; everything else is `no-cache`.
- [ ] Every header is added in the `server` block with `always`, and `server_tokens` is off.
- [ ] The image's size is measured and written down.
