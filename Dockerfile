# syntax=docker/dockerfile:1
#
# Sandpiper GRC application image.
#   Build:  docker build -t sandpiper-grc .
#   Run:    docker compose up -d        (compose.yaml; see docs/docker.md)
# Published for linux/amd64 and linux/arm64 as ghcr.io/mdcrowley/sandpiper-grc.
#
# Stages: build the web application with every package; install production packages only;
# copy both into a small runtime image that runs as the unprivileged "node" user (uid 1000).
# Everything the application writes is in two volumes, so the root filesystem can be read-only:
#   /var/lib/sandpiper       data (embedded database, attached files) and backups
#   /var/lib/sandpiper-key   the secret key file, kept apart so a copy of the data holds no key

# Keep in step with tools/node-version.txt (continuous integration passes it in).
ARG NODE_MAJOR=24

# --- 1. web build -----------------------------------------------------------------------------
# Static files, the same for every platform: built once on the builder's own platform, which
# keeps multi-platform builds fast (no emulation for this stage).
FROM --platform=$BUILDPLATFORM node:${NODE_MAJOR}-bookworm-slim AS web
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
LABEL org.opencontainers.image.title="Sandpiper GRC" \
      org.opencontainers.image.description="Governance, risk and compliance for transit organizations" \
      org.opencontainers.image.source="https://github.com/mdcrowley/sandpiper-grc" \
      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production \
    GRC_HOST=0.0.0.0 \
    GRC_PORT=8080 \
    GRC_DATA_DIR=/var/lib/sandpiper/data \
    GRC_BACKUP_DIR=/var/lib/sandpiper/backups \
    GRC_SEED_DIR=/var/lib/sandpiper/seed \
    GRC_SECRET_KEY_FILE=/var/lib/sandpiper-key/secret.key \
    GRC_WEB_DIST=/app/dist/web
WORKDIR /app

# Application files belong to root and are read-only to the process.
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY server ./server
COPY --from=web /app/dist/web ./dist/web
COPY deploy/healthcheck.mjs ./deploy/healthcheck.mjs
# `grc <command>`: the operations commands (status, seed, backup, restore, export-all, ...).
COPY --chmod=0755 deploy/grc /usr/local/bin/grc

# The writable places. A new named volume takes this ownership, so the process can write to it.
RUN mkdir -p /var/lib/sandpiper /var/lib/sandpiper-key \
 && chown node:node /var/lib/sandpiper /var/lib/sandpiper-key \
 && chmod 700 /var/lib/sandpiper-key
VOLUME ["/var/lib/sandpiper", "/var/lib/sandpiper-key"]

USER node
EXPOSE 8080

# Plain HTTP on 0.0.0.0 is refused unless GRC_TLS_CERT/GRC_TLS_KEY are set, or GRC_ALLOW_INSECURE=1
# says a proxy that terminates HTTPS sits in front (compose.yaml sets it and publishes on 127.0.0.1 only).
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
  CMD ["node", "deploy/healthcheck.mjs"]

STOPSIGNAL SIGTERM
# The server is TypeScript run by Node's built-in type transformation: no compiler and no
# development packages in the image, and nothing written outside the volumes.
CMD ["node", "--experimental-transform-types", "--disable-warning=ExperimentalWarning", "server/src/main.ts"]
