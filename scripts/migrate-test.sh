#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# migrate-test.sh — تشغيل كل الـ migrations (000→042) على PostgreSQL حقيقي
# يُستخدَم للتحقق من صحة SQL قبل إغلاق Phase 1
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

CONTAINER="majalis-elm-migrate-test"
IMAGE="majalis-elm/postgres:dev"
DB="majaliselm"
USER="majaliselm"
PASSWORD="testpassword123"
MIGRATIONS_DIR="$(cd "$(dirname "$0")/../apps/backend/migrations" && pwd)"

echo "=== Majalis Al-Elm Migration Test ==="
echo "Migrations dir: $MIGRATIONS_DIR"
echo ""

# ── 1. بناء صورة PostgreSQL المخصصة (مع pg_uuidv7) ───────────────────────
echo ">>> Building custom PostgreSQL image (with pg_uuidv7)..."
docker build -t "$IMAGE" ./infra/docker/postgres/

# ── 2. تشغيل container مؤقت ──────────────────────────────────────────────
echo ">>> Starting temporary PostgreSQL container..."
docker rm -f "$CONTAINER" 2>/dev/null || true
docker run -d \
  --name "$CONTAINER" \
  -e POSTGRES_DB="$DB" \
  -e POSTGRES_USER="$USER" \
  -e POSTGRES_PASSWORD="$PASSWORD" \
  "$IMAGE"

# ── 3. انتظار جاهزية PostgreSQL ───────────────────────────────────────────
echo ">>> Waiting for PostgreSQL to be ready..."
for i in {1..30}; do
  if docker exec "$CONTAINER" pg_isready -U "$USER" -d "$DB" -q 2>/dev/null; then
    echo "    PostgreSQL ready after ${i}s"
    break
  fi
  sleep 1
done

# ── 4. تشغيل كل الـ migrations بالترتيب ──────────────────────────────────
MIGRATIONS=(
  "000_bootstrap.sql"
  "001_identity_users.sql"
  "002_identity_roles.sql"
  "003_identity_auth_tokens.sql"
  "004_identity_oauth_otp.sql"
  "010_content_types.sql"
  "011_content_taxonomy.sql"
  "012_content_media.sql"
  "013_content_items.sql"
  "014_content_translations.sql"
  "020_engagement_types.sql"
  "021_engagement_comments.sql"
  "022_engagement_qa.sql"
  "030_notifications_types.sql"
  "031_notifications_devices.sql"
  "032_notifications_preferences.sql"
  "033_notifications_log.sql"
  "040_admin_audit_log.sql"
  "041_admin_system_config.sql"
  "042_admin_analytics.sql"
)

PASS=0
FAIL=0

echo ""
echo ">>> Running ${#MIGRATIONS[@]} migrations..."
echo ""

for migration in "${MIGRATIONS[@]}"; do
  FILEPATH="$MIGRATIONS_DIR/$migration"
  printf "  %-45s" "$migration"

  if [ ! -f "$FILEPATH" ]; then
    echo "❌ FILE NOT FOUND"
    FAIL=$((FAIL + 1))
    continue
  fi

  # نسخ الملف إلى container ثم تشغيله
  docker cp "$FILEPATH" "$CONTAINER:/tmp/$migration"
  OUTPUT=$(docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -f "/tmp/$migration" 2>&1)
  EXIT_CODE=$?

  if [ $EXIT_CODE -eq 0 ]; then
    echo "✅ OK"
    PASS=$((PASS + 1))
  else
    echo "❌ FAILED"
    echo "   ERROR: $OUTPUT"
    FAIL=$((FAIL + 1))
  fi
done

echo ""
echo "─────────────────────────────────────────────────────"
echo "Results: $PASS passed, $FAIL failed (out of ${#MIGRATIONS[@]} migrations)"

# ── 5. التحقق من الجداول المُنشأة ──────────────────────────────────────────
echo ""
echo ">>> Verifying created tables..."
TABLES=$(docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -t -c \
  "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;")
echo "$TABLES"

TABLE_COUNT=$(echo "$TABLES" | grep -c '[a-z]' || true)
echo ""
echo "Total tables created: $TABLE_COUNT"

# ── 6. التحقق من الـ ENUMs المُنشأة ──────────────────────────────────────
echo ""
echo ">>> Verifying created ENUMs..."
docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -t -c \
  "SELECT typname, array_agg(enumlabel ORDER BY enumsortorder) AS values
   FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid
   GROUP BY typname ORDER BY typname;"

# ── 7. تنظيف ──────────────────────────────────────────────────────────────
echo ""
echo ">>> Cleaning up..."
docker rm -f "$CONTAINER" >/dev/null

echo ""
if [ $FAIL -eq 0 ]; then
  echo "✅ ALL $PASS MIGRATIONS PASSED — PostgreSQL schema is valid"
  exit 0
else
  echo "❌ $FAIL MIGRATION(S) FAILED — see errors above"
  exit 1
fi
