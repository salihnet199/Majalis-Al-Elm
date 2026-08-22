-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 041 — BC05: System Configuration Key-Value Store
-- DB-SCHEMA.md v1.1.0 §BC05
-- Table: ad_system_config
--
-- String PRIMARY KEY (not UUID) — keys are stable, human-readable identifiers.
-- Pre-seeded with 4 keys that control runtime behaviour without redeployment.
-- SystemConfigService.onModuleInit() reads all rows on startup and warms the
-- in-memory cache — so values are available from the very first request.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE ad_system_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB        NOT NULL,
  description TEXT,
  updated_by  UUID,                          -- Cross-BC: UUID-only ref to id_users (no FK)
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Seed: 4 runtime-configurable keys —————————————————————————————————————————
-- Values are JSONB, so booleans/numbers are stored without quotes.
INSERT INTO ad_system_config (key, value, description) VALUES
  ('maintenance_mode',            'false',  'إذا true: API يُعيد 503 لغير-admin'),
  ('max_upload_size_mb',          '500',    'الحجم الأقصى لرفع الملفات بالميغابايت'),
  ('feature_flag.qa',             'true',   'تفعيل نظام الأسئلة والأجوبة'),
  ('comment.edit_window_minutes', '15',     'النافذة الزمنية بالدقائق التي يُسمح فيها لصاحب التعليق بتعديله');
