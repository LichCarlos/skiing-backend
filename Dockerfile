# Node 22 official multi-platform index, resolved 2026-11-02.
ARG NODE_IMAGE=node:22-bookworm-slim@sha256:4b150b48b4116e2a22f2c39cc27025fbf4f153e2078fd3b14d159fdb5c7279da
FROM ${NODE_IMAGE} AS base
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS dependencies
RUN npm install --global pnpm@11.25.0
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=linji-api-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store --network-concurrency=4

FROM dependencies AS build
COPY nest-cli.json tsconfig.json tsconfig.build.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN DATABASE_URL=postgresql://unused:unused@127.0.0.1:1/build_only pnpm db:generate \
    && pnpm build

# Explicit, one-off administrative image. Never used as the API entrypoint.
FROM build AS tools
COPY scripts ./scripts
ENV NODE_ENV=production
USER node
CMD ["pnpm", "db:deploy"]

FROM build AS production-dependencies
RUN --mount=type=cache,id=linji-api-pnpm,target=/pnpm/store \
    npm_config_store_dir=/pnpm/store pnpm prune --prod

FROM base AS runtime
ENV NODE_ENV=production PORT=8080
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/dist ./dist
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
# Process liveness only; this does not establish database/broker readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "const r = await fetch('http://127.0.0.1:' + (process.env.PORT || 8080) + '/api/v1/health', {signal: AbortSignal.timeout(4000)}); if (!r.ok) process.exit(1)"]
CMD ["node", "dist/main.js"]
