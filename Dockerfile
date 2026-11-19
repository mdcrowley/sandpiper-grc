# syntax=docker/dockerfile:1
#
# Sandpiper GRC application image. Build:   docker build -t sandpiper-grc .
# Run it with compose.yaml (see docs/installation.md, "Containers").
#
# Stages: build the web application with every package; install production packages only;
# copy both into a small runtime image that runs as the unprivileged "node" user. All state
# lives under /var/lib/sandpiper (a volume), so the root filesystem can be read-only.

# Keep in step with tools/node-version.txt.
ARG NODE_MAJOR=24

# --- 1. web build -----------------------------------------------------------------------------
FROM node:${NODE_MAJOR}-bookworm-slim AS web
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY vite.config.ts ./
COPY web ./web
# The Help pages are bundled from the user guide.
COPY docs/user ./docs/user
RUN npm run build

# --- 2. production packages -------------------------------------------------------------------
FROM node:${NODE_MAJOR}-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force

# --- 3. runtime -------------------------------------------------------------------------------
FROM node:${NODE_MAJOR}-bookworm-slim AS runtime
ENV NODE_ENV=production \
    GRC_HOST=0.0.0.0 \
    GRC_PORT=8080 \
    GRC_DATA_DIR=/var/lib/sandpiper/data \
    GRC_BACKUP_DIR=/var/lib/sandpiper/backups \
    GRC_SEED_DIR=/var/lib/sandpiper/seed \
    GRC_WEB_DIST=/app/dist/web
WORKDIR /app

# Application files belong to root and are read-only to the process.
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY --from=web /app/dist/web ./dist/web
COPY deploy/healthcheck.mjs ./deploy/healthcheck.mjs

# The one writable place: database (embedded mode), attached files, the generated key file and backups.
RUN mkdir -p /var/lib/sandpiper && chown node:node /var/lib/sandpiper
VOLUME ["/var/lib/sandpiper"]

USER node
EXPOSE 8080

# Plain HTTP on 0.0.0.0 is refused unless GRC_TLS_CERT/GRC_TLS_KEY are set, or GRC_ALLOW_INSECURE=1
# says a proxy that terminates HTTPS sits in front (compose.yaml sets it and publishes on 127.0.0.1 only).
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "deploy/healthcheck.mjs"]

STOPSIGNAL SIGTERM
# The server is TypeScript run by Node's built-in type transformation: no compiler and no
# development packages in the image, and nothing written outside the volume.
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
