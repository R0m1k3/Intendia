# syntax=docker/dockerfile:1.7
# Intendia: one container, web UI on 3000 (behind your reverse proxy), MCP on 3001 (agents' network only).

FROM node:24-bookworm-slim AS build
WORKDIR /src
RUN corepack enable
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY apps/fake-hermes/package.json apps/fake-hermes/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @intendia/web build \
 && pnpm --filter @intendia/server build \
 && pnpm --filter @intendia/server deploy --prod /out

FROM node:24-bookworm-slim
ARG VERSION=dev
LABEL org.opencontainers.image.title="Intendia" \
      org.opencontainers.image.description="Web UI to work with and administer Hermes Agent through its HTTP APIs" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="${VERSION}"
WORKDIR /app
COPY --from=build /out/node_modules ./node_modules
COPY --from=build /out/package.json ./package.json
COPY --from=build /src/apps/server/dist ./dist
COPY --from=build /src/apps/web/dist ./web
ENV NODE_ENV=production \
    INTENDIA_VERSION=${VERSION} \
    INTENDIA_WEB_DIR=/app/web \
    INTENDIA_DATA_DIR=/data
# Default uid/gid 10000 (same as the official Hermes image). Override with `user:` in compose.
RUN mkdir -p /data && chown 10000:10000 /data
USER 10000:10000
EXPOSE 3000 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["node", "/app/dist/healthcheck.js"]
CMD ["node", "/app/dist/index.js"]
