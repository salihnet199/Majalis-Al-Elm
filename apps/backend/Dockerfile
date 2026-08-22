FROM node:20-alpine AS base
WORKDIR /app

# ─────────────────────── Development Stage ───────────────────────────────────
FROM base AS development
ENV NODE_ENV=development

COPY package*.json ./
COPY nx.json ./
COPY tsconfig.base.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY apps/backend/tsconfig*.json ./apps/backend/
COPY libs/ ./libs/

RUN npm ci --workspace=apps/backend

COPY apps/backend/src ./apps/backend/src
COPY apps/backend/migrations ./apps/backend/migrations

EXPOSE 3000

CMD ["npm", "run", "start:dev", "--workspace=apps/backend"]

# ─────────────────────── Build Stage ─────────────────────────────────────────
FROM base AS builder
ENV NODE_ENV=production

COPY package*.json ./
COPY nx.json ./
COPY tsconfig.base.json ./
COPY apps/backend/package*.json ./apps/backend/
COPY apps/backend/tsconfig*.json ./apps/backend/
COPY libs/ ./libs/

RUN npm ci --workspace=apps/backend --omit=dev

COPY apps/backend/src ./apps/backend/src
COPY apps/backend/migrations ./apps/backend/migrations

RUN npm run build --workspace=apps/backend

# ─────────────────────── Production Stage ────────────────────────────────────
FROM node:20-alpine AS production
ENV NODE_ENV=production
WORKDIR /app

# Install dumb-init for proper PID 1 signal handling inside Docker
RUN apk add --no-cache dumb-init

# Copy only what's needed at runtime
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/apps/backend/dist ./dist
COPY --from=builder /app/apps/backend/migrations ./migrations

# Non-root user for security (P-07: Secure by Default)
RUN addgroup -g 1001 -S nodejs && adduser -S nestjs -u 1001
USER nestjs

EXPOSE 3000

# dumb-init handles SIGTERM → graceful shutdown → NestJS lifecycle hooks
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/backend/src/main.js"]
