# ── build ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

# pnpm, at the version package.json pins in `packageManager`.
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# ── runtime ───────────────────────────────────────────────────────────
FROM node:24-alpine AS runtime

WORKDIR /app

ENV NODE_ENV=production

RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# --ignore-scripts: lifecycle scripts belong to the build stage. `prepare` usually calls a dev tool that
# is not installed here, so without the flag the install exits 127; and no dependency gets to run code
# while the production image is assembled. A native module still loads when it ships prebuilt binaries
# for this image's libc — check that once, when the dependency is added. node_modules links its files
# out of pnpm's store, so the store's own entries go once the install is done, and corepack's copy of
# pnpm with them: nothing at runtime calls pnpm.
RUN pnpm install --prod --frozen-lockfile --ignore-scripts \
  && rm -rf "$(pnpm store path)" /root/.cache

# The build output with its copied assets beside it; a layout that moved fails at the first start.
COPY --from=build /app/dist ./dist

USER node

# Documentation, not configuration: EXPOSE publishes nothing and does not reach the application, which
# listens on its required PORT variable. Keep the two in step, or change this to what the platform
# expects.
EXPOSE 3000

# Liveness only: whether the process answers, not whether its dependencies do. A container restarted
# because the database blinked only adds a second outage to the first. fetch rather than wget or curl,
# which the image may not carry, and PORT because that is where the application listens.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + process.env.PORT + '/health/live').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"]

# node itself, not pnpm: the process that receives SIGTERM is the server. The instrumentation is always
# loaded ahead of it, and traces only when the deployment sets its variables. The deploy's other
# commands — migrations, the seed — run from this same image with their own command.
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main"]
