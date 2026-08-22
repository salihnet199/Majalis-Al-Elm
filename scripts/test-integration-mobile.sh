#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/test-integration-mobile.sh
# End-to-End Orchestrator for Majlis Al-Alim Integration Suite
# 
# 1. Start Docker PostgreSQL (with pg_uuidv7)
# 2. Wait for pg_isready
# 3. Apply all migrations (000 to 042) + Seed Data (seed_integration_test.sql)
# 4. Generate RS256 JWT keys (if not present)
# 5. Start NestJS Backend
# 6. Run Flutter Integration Test Suite (8 Real Scenarios)
# 7. Run Existing Flutter Unit & Widget Tests (37 tests)
# 8. Clean up & Exit
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT_DIR"

CONTAINER_NAME="majlis-alim-postgres-test"
IMAGE_NAME="majlis-alim/postgres:dev"
DB_NAME="majlisalim"
DB_USER="majlisalim"
DB_PASS="majlisalim_test_pass_2026"
DB_PORT="5432"

RESET_DB=false
for arg in "$@"; do
  if [ "$arg" == "--reset-db" ]; then
    RESET_DB=true
  fi
done

echo "================================================================="
echo "  Majlis Al-Alim — Mobile Integration & PostgreSQL Test Pipeline "
echo "================================================================="

# 1. Ensure JWT keys exist
if [ ! -f "secrets/jwt_private_key.pem" ] || [ ! -f "secrets/jwt_public_key.pem" ]; then
  echo ">>> [1/7] Generating RS256 JWT keys in secrets/..."
  node -e "const crypto = require('crypto'); const fs = require('fs'); fs.mkdirSync('secrets', { recursive: true }); const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 4096, publicKeyEncoding: { type: 'spki', format: 'pem' }, privateKeyEncoding: { type: 'pkcs8', format: 'pem' } }); fs.writeFileSync('secrets/jwt_private_key.pem', privateKey); fs.writeFileSync('secrets/jwt_public_key.pem', publicKey);"
else
  echo ">>> [1/7] JWT RS256 keys found in secrets/."
fi

# 2. Start PostgreSQL Container
if [ "$RESET_DB" = true ]; then
  echo ">>> [2/7] Resetting PostgreSQL container (--reset-db)..."
  docker rm -f "$CONTAINER_NAME" al-fajr-postgres majlis-alim-postgres 2>/dev/null || true
fi

if ! docker ps --format '{{.Names}}' | grep -q "^${CONTAINER_NAME}$"; then
  echo ">>> [2/7] Starting PostgreSQL container ($CONTAINER_NAME)..."
  docker rm -f "$CONTAINER_NAME" al-fajr-postgres majlis-alim-postgres 2>/dev/null || true
  docker run -d \
    --name "$CONTAINER_NAME" \
    -e POSTGRES_DB="$DB_NAME" \
    -e POSTGRES_USER="$DB_USER" \
    -e POSTGRES_PASSWORD="$DB_PASS" \
    -p "${DB_PORT}:5432" \
    "$IMAGE_NAME"
fi

# 3. Wait for PostgreSQL readiness
echo ">>> [3/7] Waiting for PostgreSQL to be ready on port $DB_PORT..."
for i in $(seq 1 30); do
  if docker exec "$CONTAINER_NAME" pg_isready -U "$DB_USER" -d "$DB_NAME" -q 2>/dev/null; then
    echo "    PostgreSQL is ready."
    break
  fi
  sleep 1
done

# 4. Apply Migrations and Seed Data
echo ">>> [4/7] Applying SQL Migrations (000 to 042) & Seed Data..."
MIGRATIONS_DIR="apps/backend/migrations"
for f in $(ls -1 "$MIGRATIONS_DIR"/*.sql | sort); do
  if [[ "$f" == *"seed_integration_test.sql"* ]]; then
    continue
  fi
  echo "    Executing $(basename "$f")..."
  docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$f" >/dev/null 2>&1 || true
done

echo "    Executing seed_integration_test.sql..."
docker exec -i "$CONTAINER_NAME" psql -U "$DB_USER" -d "$DB_NAME" < "$MIGRATIONS_DIR/seed_integration_test.sql" >/dev/null 2>&1

# 5. Start Backend Server
echo ">>> [5/7] Starting NestJS Backend Server..."
export NODE_ENV=development
export PORT=3000
export DATABASE_HOST=localhost
export DATABASE_PORT=$DB_PORT
export DATABASE_NAME=$DB_NAME
export DATABASE_USER=$DB_USER
export DATABASE_PASSWORD=$DB_PASS
export DATABASE_SSL=false
export JWT_PRIVATE_KEY_PATH="./secrets/jwt_private_key.pem"
export JWT_PUBLIC_KEY_PATH="./secrets/jwt_public_key.pem"
export JWT_ACCESS_TOKEN_TTL=900
export JWT_REFRESH_TOKEN_TTL=604800
export CORS_ORIGIN="http://localhost,http://127.0.0.1"
export LOG_LEVEL=warn

# Build backend bundle
echo "    Building NestJS backend bundle..."
npx nx build backend >/dev/null 2>&1

# Kill existing node backend if running on 3000
npx kill-port 3000 2>/dev/null || true

# Start backend in background
node dist/apps/backend/main.js &
BACKEND_PID=$!

cleanup() {
  echo ">>> Cleaning up backend process (PID: $BACKEND_PID)..."
  kill $BACKEND_PID 2>/dev/null || true
  npx kill-port 3000 2>/dev/null || true
}
trap cleanup EXIT

# Wait for backend health check
echo "    Waiting for Backend health check (http://localhost:3000/api/v1/health)..."
for i in $(seq 1 45); do
  if curl -sf http://localhost:3000/api/v1/health >/dev/null 2>&1; then
    echo "    Backend is healthy and listening on port 3000!"
    break
  fi
  sleep 1
done

# 6. Run Flutter Integration Test Suite (8 Real Scenarios)
echo ">>> [6/7] Running Flutter Real Backend Integration Tests (8 Scenarios)..."
cd apps/mobile
flutter test test/integration/real_backend_integration_test.dart

# 7. Run All Existing Flutter Tests (37 Tests)
echo ">>> [7/7] Verifying all existing Flutter Unit & Widget tests (37 tests)..."
flutter test

echo ""
echo "================================================================="
echo "  ✅ ALL INTEGRATION & REGRESSION TESTS PASSED SUCCESSFULLY!    "
echo "================================================================="
