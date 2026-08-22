-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 032 — BC04: Notifications — User Preferences
-- DB-SCHEMA.md v1.1.0 §BC04
-- Table: nt_notification_preferences
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE nt_notification_preferences (
  user_id    UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  channel    nt_channel  NOT NULL,
  category   VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel, category)
);

-- DOWN:
-- DROP TABLE IF EXISTS nt_notification_preferences;
