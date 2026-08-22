-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 031 — BC04: Notifications — User Devices
-- DB-SCHEMA.md v1.1.0 §BC04
-- Table: nt_user_devices
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE nt_user_devices (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  fcm_token    TEXT        NOT NULL,
  device_name  VARCHAR(200),
  platform     VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios')),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, fcm_token)
);

CREATE INDEX idx_nt_devices_user_active ON nt_user_devices(user_id) WHERE is_active = TRUE;

-- DOWN:
-- DROP TABLE IF EXISTS nt_user_devices;
