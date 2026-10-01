# Production image: build with Vite, serve with scripts/serve.mjs. Migrations run at start when
# MIGRATE=true (default) so a single `docker compose up` gets a working instance. Operator tasks:
# `docker compose exec app node scripts/sota.ts create-admin` (see docs/deploying.md).
FROM node:24-alpine AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
COPY . .
# Slots (theme/slots/*.tsx) are compiled into the bundle, so the theme a deployment ships with must
# be in the build context: ./theme by default, or another directory with --build-arg THEME_DIR=...
# An ARG reaches `pnpm build` as an environment variable; empty means "./theme if it exists".
ARG THEME_DIR=
RUN pnpm build
# What the image carries as /app/theme (a bind mount over it replaces everything but the slots).
RUN mkdir -p /out/theme && d="${THEME_DIR:-theme}"; if [ -d "$d" ]; then cp -R "$d/." /out/theme/; fi

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
COPY src/theme ./src/theme
COPY src/server/services ./src/server/services
# What `sota create-admin` and the sign-in hooks import under plain Node.
COPY src/server/auth ./src/server/auth
COPY src/server/access ./src/server/access
COPY src/server/audit.ts src/server/client-ip.ts ./src/server/
# `sota export` and `sota import` (ADR-021).
COPY src/server/mutations/content-import-core.ts ./src/server/mutations/
COPY src/server/queries/content-export-core.ts ./src/server/queries/
COPY lms.config.ts ./lms.config.ts
COPY --from=build /out/theme ./theme
# The only runtime write is STORAGE_DIR (local storage driver); logs go to stdout. The directory
# exists in the image so a named volume mounted there inherits node's ownership.
RUN mkdir -p /app/data/uploads && chown node:node /app/data/uploads
USER node
EXPOSE 3003
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:${PORT:-3003}/api/health || exit 1
CMD ["sh", "-c", "if [ \"${MIGRATE:-true}\" = true ]; then node scripts/sota.ts migrate; fi && if [ \"${SEED:-false}\" = true ]; then node scripts/sota.ts seed; fi && node scripts/serve.mjs"]
