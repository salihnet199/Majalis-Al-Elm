-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 030 — BC04: Notifications — ENUM Types
-- DB-SCHEMA.md v1.1.0 §BC04
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TYPE nt_channel AS ENUM ('FCM_PUSH', 'EMAIL', 'SMS', 'IN_APP');
CREATE TYPE nt_status  AS ENUM ('QUEUED', 'SENT', 'FAILED', 'READ');

-- DOWN:
-- DROP TYPE IF EXISTS nt_status;
-- DROP TYPE IF EXISTS nt_channel;
