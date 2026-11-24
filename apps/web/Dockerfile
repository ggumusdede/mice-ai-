# syntax=docker/dockerfile:1
# MICE AI Operations OS — web PWA: vite build → nginx (non-root, :8080) serving the SPA and proxying /api to the API.
#   docker build -f apps/web/Dockerfile -t mice-web .
#   docker run -e API_UPSTREAM=api:3001 -p 8080:8080 mice-web
ARG NODE_VERSION=22

FROM node:${NODE_VERSION}-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/domain/package.json packages/domain/
COPY packages/ai/package.json packages/ai/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund --include-workspace-root --workspace @mice/shared --workspace @mice/domain --workspace @mice/web
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/domain ./packages/domain
COPY apps/web ./apps/web
RUN npx tsc --noEmit -p apps/web && npm run build -w @mice/web

FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime
ENV API_UPSTREAM=api:3001 \
    NGINX_ENVSUBST_FILTER=^API_UPSTREAM$
COPY docker/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY docker/nginx/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=15s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
