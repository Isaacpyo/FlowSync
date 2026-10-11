# syntax=docker/dockerfile:1
# FlowSync API image. Build context: the repository root (see docker-compose.yml).

FROM node:22-alpine AS base
# Prisma's engines need OpenSSL; pnpm comes from corepack (version pinned in package.json).
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/

FROM base AS build
RUN pnpm install --frozen-lockfile --filter @flowsync/api...
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @flowsync/api build

FROM base AS prod-deps
RUN pnpm install --frozen-lockfile --prod --filter @flowsync/api...
COPY apps/api/prisma apps/api/prisma
RUN cd apps/api && pnpm exec prisma generate

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production PORT=4000
WORKDIR /repo
COPY --from=prod-deps /repo/node_modules ./node_modules
COPY --from=prod-deps /repo/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY apps/api/prisma ./apps/api/prisma
COPY apps/api/package.json ./apps/api/package.json
WORKDIR /repo/apps/api
USER node
EXPOSE 4000
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:4000/health || exit 1
# Apply pending migrations, then start. The demo workspace is seeded on boot.
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && exec node --enable-source-maps dist/index.js"]
