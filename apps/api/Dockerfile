# syntax=docker/dockerfile:1
# MICE AI Operations OS — API (Fastify 5, run with tsx) + worker + migrations. Build context: repository root.
#   docker build -f apps/api/Dockerfile -t mice-api .
#   docker run … mice-api            → serve   (MIGRATE_ON_START=1 runs migrations first)
#   docker run … mice-api migrate    → migrations as the owner role (MIGRATION_DATABASE_URL) + optional APP_DB_PASSWORD
#   docker run … mice-api worker     → follow-up worker loop  (worker --once for one pass)
ARG NODE_VERSION=22

# ---------------------------------------------------------------- deps: only the workspaces the API needs (+ root: tsx)
FROM node:${NODE_VERSION}-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/ai/package.json packages/ai/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund --include-workspace-root \
      --workspace @mice/shared --workspace @mice/domain --workspace @mice/ai --workspace @mice/api \
 && npm cache clean --force

# ---------------------------------------------------------------- check: typecheck the sources that will ship
FROM deps AS check
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
RUN npx tsc --noEmit -p packages/shared && npx tsc --noEmit -p packages/domain && npx tsc --noEmit -p packages/ai \
 && npx tsc --noEmit -p apps/api

# ---------------------------------------------------------------- runtime
FROM node:${NODE_VERSION}-slim AS runtime
# tini: PID 1 signal forwarding (graceful shutdown); DejaVu: Turkish characters in generated PDFs
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini fonts-dejavu-core ca-certificates \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    PORT=3001 \
    HOST=0.0.0.0 \
    PDF_FONT_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf \
    PDF_FONT_BOLD_PATH=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
WORKDIR /app
COPY --from=deps --chown=root:root /app/node_modules ./node_modules
COPY --chown=root:root package.json tsconfig.base.json ./
COPY --chown=root:root packages ./packages
COPY --chown=root:root apps/api ./apps/api
# node_modules/@mice/* are workspace symlinks to ../../packages/* (copied above).
# The COPY from `check` makes BuildKit run the typecheck stage (unreferenced stages are skipped).
COPY --from=check /app/apps/api/package.json /tmp/typechecked
COPY --chown=root:root docker/api-entrypoint.sh /usr/local/bin/api-entrypoint
RUN chmod 0755 /usr/local/bin/api-entrypoint && rm -rf apps/api/test /tmp/typechecked
# non-root; the code is root-owned and read-only for this user. tsx caches transpilation in $TMPDIR.
USER node
ENV TMPDIR=/tmp
WORKDIR /app/apps/api
EXPOSE 3001
HEALTHCHECK --interval=15s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)+'/api/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/api-entrypoint"]
CMD ["serve"]
