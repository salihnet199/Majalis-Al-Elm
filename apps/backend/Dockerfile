FROM node:20-alpine AS base
WORKDIR /app

# ─────────────────────── Development Stage ───────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY package*.json ./
COPY nx.json ./
COPY tsconfig.base.json ./
COPY apps/backend ./apps/backend
COPY apps/admin ./apps/admin
COPY scripts ./scripts

RUN npm ci

EXPOSE 3000

CMD ["npx", "nx", "serve", "backend", "--configuration=development"]

# ─────────────────────── Build Stage ─────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=production

COPY package*.json ./
COPY nx.json ./
COPY tsconfig.base.json ./
COPY eslint.config.mjs ./
COPY apps/backend ./apps/backend
COPY apps/admin ./apps/admin
COPY scripts ./scripts

# This repository is an Nx monorepo, not an npm workspace monorepo.
RUN npm ci
RUN npx nx build backend --configuration=production

# Keep only runtime dependencies in the final image. The Nx webpack build emits
# a self-contained dist tree and package metadata; pruning here keeps the image
# substantially smaller without relying on a workspace that does not exist.
RUN npm prune --omit=dev

# ─────────────────────── Production Stage ────────────────────────────────────
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

RUN apk add --no-cache dumb-init

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist/apps/backend ./dist/apps/backend
COPY --from=builder /app/apps/backend/migrations ./apps/backend/migrations
COPY --from=builder /app/scripts/migrate.mjs ./scripts/migrate.mjs

RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
USER nestjs

EXPOSE 3000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/backend/main.js"]
