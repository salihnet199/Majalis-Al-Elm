-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 000 — Bootstrap Extensions
-- Majalis Al-Elm Platform · DB-SCHEMA.md v1.1.0
-- ─────────────────────────────────────────────────────────────────────────────
-- pg_uuidv7 : مطلوب — يوفّر uuid_generate_v7() للـ Primary Keys
-- citext    : مطلوب — حقول email بلا حساسية لحالة الأحرف
-- pgcrypto  : مطلوب — gen_random_bytes() لتوليد رموز OTP/Reset بأمان
--
-- unaccent  : محذوف (YAGNI — Phase 1)
--   البحث في Phase 1 يعتمد ILIKE فقط (DB-002).
--   إضافة unaccent مُرجأة لحين الحاجة الفعلية لبحث عربي بلا تشكيل.
--   عند إضافته لاحقاً: CREATE EXTENSION IF NOT EXISTS "unaccent";
--   ثم استخدامه عبر: unaccent(field) ILIKE unaccent('%query%')
--
-- ملاحظة: CREATE EXTENSION IF NOT EXISTS يفشل تلقائياً إن لم تكن
-- المكتبة مثبّتة على النظام. إن فشل pg_uuidv7:
--   docker-compose: استخدم infra/docker/postgres/Dockerfile المخصص
-- ─────────────────────────────────────────────────────────────────────────────

CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
