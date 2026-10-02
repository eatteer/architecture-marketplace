---
name: deployment
description: "The deployable image and the steps a deploy runs from it — the multi-stage Dockerfile, production dependencies installed without lifecycle scripts, the non-root user, what never goes into the image, the container healthcheck, the process that receives the termination signal, one image for the server and every deploy command, migrations as a deploy step and their order against the rollout, the start command that always loads the instrumentation, and watching the image's size."
when_to_use: "Trigger on — writing or editing a `Dockerfile` or `.dockerignore`, `docker build` failing on the lockfile install, an install exiting 127 because a dev tool is missing, a container running as root, adding a `HEALTHCHECK`, a container restarted when the database blinks, a server that never receives SIGTERM because a parent process holds it, `CMD pnpm start`, running migrations or the seed as deploy steps, the order of a migration against the rollout, a `.env` or a secret baked into an image, or an image that grew after a dependency change."
---

# Deployment

What ships is one image, built from the repository by a `Dockerfile` at its root. The platform that
runs it is the project's choice; what the image must be for any platform to run it correctly is
below.

## The image

Two stages: one that has everything needed to build, one that has only what is needed to run.

**Copy [assets/Dockerfile](assets/Dockerfile) and [assets/.dockerignore](assets/.dockerignore) to
the repository root** when the project has no image yet; when it has one, hold it against them. The
rules below are what they encode.

- **Both stages install with the pnpm `packageManager` pins**, through `corepack enable`, from the
  frozen lockfile (see `project-bootstrap`). The runtime stage removes pnpm's store once
  `node_modules` is linked: nothing at runtime calls pnpm.
- **The runtime installs from the lockfile, production dependencies only, with `--ignore-scripts`.**
  Lifecycle scripts belong to the build stage. The project's own `prepare` usually calls a dev tool
  — the git hook installer — that is not installed here, so without the flag the install exits 127
  and the image does not build; and with it, no dependency gets to run code while the production
  image is assembled. A native module still loads when it ships prebuilt binaries for the image's
  libc, as the password hashing library does: check that once, when the dependency is added.
- **`NODE_ENV` is set by the image**, which is the process stating which environment it is (see the
  `configuration` skill). Nothing else in the image states configuration: there is no `.env` in it,
  and every variable is supplied by the platform. `.dockerignore` keeps `.env`, `.git`,
  `node_modules`, `dist` and the coverage output out of the build context, so neither a secret nor a
  local build reaches a layer.
- **It runs as `node`, not root.** The official Node image ships the user; a process that is broken
  into as root owns the container.
- **The build output is checked once**: `dist/main.js` at the top and the copied assets beside it
  (see the `project-bootstrap` skill). A layout that moved is found at the image's first start
  otherwise.
- **`EXPOSE` is documentation.** It publishes nothing and does not reach the application, which
  listens on its required port variable; keep the two in step or change it to what the platform
  expects.

## The healthcheck and the signal

- **The container healthcheck points at liveness**, never at readiness: a container restarted
  because the database blinked adds a second outage to the first. It uses `fetch` from the runtime
  itself, because the image may carry neither `curl` nor `wget`, and the port variable, because that
  is where the application listens. Readiness is the orchestrator's probe, and the `observability`
  skill owns both routes.
- **The server is the process that receives the signal.** `CMD ["node", "--import",
  "./dist/instrumentation.js", "dist/main"]`, in exec form, makes it PID 1 and hands it the platform's SIGTERM directly. `pnpm start` or a shell form puts a
  parent in between that does not forward the signal, so the drain window never opens and every
  deploy ends with a kill (see the `observability` skill for what the process does with the signal).

## One image, every step

The server and every command a deploy runs come from the same build — never a second copy of the
code, never a script run from a developer's machine against production:

```text
node dist/cli/migrate up      # a deploy step, before the new version takes traffic
node dist/cli/migrate down    # reverts the last one
node dist/cli/seed            # once, with the seed's own variables for that run only
```

That is why a command a deployment runs lives in the source tree and compiles with the application:
a script kept outside the build is excluded from it, and the image cannot run what it does not
contain (see the `project-bootstrap` skill for the tree).

**Migrations are a deploy step with an order**, owned by the `persistence-layer` skill:

- One that adds something runs **before** the rollout; one that removes something runs **after** the
  last instance of the old version has stopped. Each migration says which it is.
- The step's exit code gates the rollout: a failed migration fails the deploy before any instance of
  the new version takes traffic.
- Two deploys starting at once both run the step. The migration command takes a lock, so the second
  one refuses instead of applying the same migration twice.

**The start command always loads the instrumentation**, before the application, and the deployment's
variables decide whether it traces (see the `observability` skill). The image and its command are
the same in an environment with a collector and one without; turning tracing on is setting two
variables, not building or starting anything differently.

## Size

**Measure the image when a dependency changes**, and write the number down where the next change can
compare against it — the README's section on the image, or a comment beside the `Dockerfile`, with
the date it was measured. A library can carry its own tooling as runtime dependencies — a template
library whose package also holds its preview server brings a bundler, a compiler and a websocket
server into the production install — and nothing but the size says so. The answer is sometimes to
accept it; it is never to find out a year later.

## Checklist

- [ ] The image is multi-stage, and the runtime stage installs production dependencies from the
      lockfile with `--ignore-scripts`.
- [ ] Every native dependency loads in the runtime image without an install script.
- [ ] The image sets `NODE_ENV` and nothing else: no `.env`, no secret, and `.dockerignore` excludes
      them.
- [ ] The container runs as a non-root user.
- [ ] The healthcheck points at liveness, with the runtime's own HTTP client and the port variable.
- [ ] `CMD` runs the server directly in exec form, so it receives the termination signal, with the
      instrumentation loaded ahead of it.
- [ ] Every command a deploy runs — migrations, the seed — runs from the same image.
- [ ] Migrations run as a gated deploy step, locked against a concurrent run, before or after the
      rollout as each one states.
- [ ] The image's size is measured after every dependency change and recorded in the README's
      image section or beside the `Dockerfile`.
