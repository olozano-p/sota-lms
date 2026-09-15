# Production image: build with Vite, serve with scripts/serve.mjs. Migrations run at start when
# MIGRATE=true (default) so a single `docker compose up` gets a working instance.
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY --from=build /app/dist ./dist
COPY drizzle ./drizzle
COPY scripts ./scripts
COPY src/db ./src/db
COPY src/config ./src/config
COPY src/lib ./src/lib
COPY src/i18n ./src/i18n
COPY src/server/services ./src/server/services
COPY lms.config.ts ./lms.config.ts
# The only runtime write is STORAGE_DIR (local storage driver); logs go to stdout. The directory
# exists in the image so a named volume mounted there inherits node's ownership.
RUN mkdir -p /app/data/uploads && chown node:node /app/data/uploads
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3003}/api/health || exit 1
CMD ["sh", "-c", "if [ \"${MIGRATE:-true}\" = true ]; then node src/db/migrate.ts; fi && if [ \"${SEED:-false}\" = true ]; then node scripts/seed.ts; fi && node scripts/serve.mjs"]
