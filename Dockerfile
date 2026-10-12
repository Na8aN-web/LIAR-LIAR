# Production image: game server + web app + proxy on one port (tools/start-prod.mjs).
# Railway builds this automatically; locally: docker build -t wtc . && docker run -p 8080:8080 wtc

FROM node:22-slim AS build
WORKDIR /app
ENV CI=1 NEXT_TELEMETRY_DISABLED=1
RUN corepack enable
# Browser error reports: Railway passes service variables to the build as build args.
ARG NEXT_PUBLIC_SENTRY_DSN
ENV NEXT_PUBLIC_SENTRY_DSN=$NEXT_PUBLIC_SENTRY_DSN
COPY . .
# Only what the two apps need (skips the asset and trailer tooling at the repo root).
RUN pnpm install --frozen-lockfile --filter "@wtc/server..." --filter "@wtc/web..."
RUN pnpm --filter @wtc/server build && pnpm --filter @wtc/web build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080
COPY --from=build /app /app
# The only places the apps write at runtime: the file store (if not using Postgres) and Next's cache.
RUN mkdir -p apps/server/logs apps/web/.next/cache && chown -R node:node apps/server/logs apps/web/.next
EXPOSE 8080
USER node
CMD ["node", "tools/start-prod.mjs"]
