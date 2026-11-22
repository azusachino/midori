# midori container image — single local-first image (API + web shell + MCP, all Bun).
#
# Build/import through the repo Make target only (`make image-app`); the target
# encapsulates the canonical image namespace (azusachino.com), SOURCE_REVISION
# and the containerd import flags. Local-only: not pushed to any registry;
# in-cluster the workload pins imagePullPolicy: Never.

# --- build stage: full toolchain, produce web/dist --------------------------------
FROM docker.io/oven/bun:1.4.4-slim AS build
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY tsconfig.json ./
COPY web ./web
# web imports the shared DTOs/registry from src/domain via the @midori/domain alias
COPY src/domain ./src/domain
RUN bun run build

# --- deps stage: production node_modules only -------------------------------------
FROM docker.io/oven/bun:1.4.4-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

# --- runtime ----------------------------------------------------------------------
FROM docker.io/oven/bun:1.4.4-slim
ARG SOURCE_REVISION
ARG MIDORI_VERSION=dev
RUN test -n "$SOURCE_REVISION"
LABEL org.opencontainers.image.title=midori
LABEL org.opencontainers.image.revision=$SOURCE_REVISION
LABEL org.opencontainers.image.description="Personal Apple Health analyst"
WORKDIR /app
ENV NODE_ENV=production
# midori runs as the image's existing uid-1000 `bun` user; the k8s workload uses
# runAsUser/runAsGroup/fsGroup 1000 with a local-path PVC, mirroring the daphne
# pattern (1000:1000).
RUN mkdir -p /data && chown bun:bun /data
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/web/dist ./web/dist
COPY package.json bun.lock ./
COPY migrations ./migrations
COPY src ./src
USER bun
# /data is the PVC mount point: db, backups, archive and upload spool live there.
ENV MIDORI_HOST=0.0.0.0 \
    MIDORI_PORT=8080 \
    MIDORI_VERSION=$MIDORI_VERSION \
    MIDORI_REVISION=$SOURCE_REVISION \
    MIDORI_DB=/data/midori.db \
    MIDORI_BACKUP_DIR=/data/backups \
    MIDORI_ARCHIVE_DIR=/data/archive \
    MIDORI_SPOOL_DIR=/data/spool
EXPOSE 8080
CMD ["bun", "src/server.ts"]
