# ── build ─────────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Vite compiles every VITE_* variable into the bundle, so the API's address is fixed when the image is
# built, not when it runs: one image per environment. Required, like every VITE_* variable in .env.example —
# an image built without it would call `undefined/api/v1`.
ARG VITE_API_URL
RUN test -n "$VITE_API_URL" || { echo "Build with --build-arg VITE_API_URL=<the API's origin>" >&2; exit 1; }
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# The same value goes into the Content-Security-Policy's connect-src, so the page may call that API
# and nothing else.
RUN sed "s|__VITE_API_URL__|${VITE_API_URL}|g" nginx.conf > default.conf

# ── runtime ───────────────────────────────────────────────────────────
# nginx built to run as an unprivileged user (uid 101), listening on 8080 rather than 80, which only
# root may bind. Stable branch, pinned to the exact release.
FROM nginxinc/nginx-unprivileged:1.30.5-alpine AS runtime

COPY --from=build /app/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Documentation, not configuration: the port nginx.conf listens on.
EXPOSE 8080

# Whether nginx answers. There is nothing else in the container to be unhealthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD ["wget", "--quiet", "--spider", "http://127.0.0.1:8080/"]
