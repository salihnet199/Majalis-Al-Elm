-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 033 — BC04: Notifications — Log + Announcements
-- DB-SCHEMA.md v1.1.0 §BC04
-- Tables: nt_notifications, nt_announcements
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE nt_notifications (
  id         UUID       PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    UUID       NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  channel    nt_channel NOT NULL,
  category   VARCHAR(50) NOT NULL,
  title      VARCHAR(255),
  body       TEXT        NOT NULL,
  data       JSONB,
  status     nt_status   NOT NULL DEFAULT 'QUEUED',
  sent_at    TIMESTAMPTZ,
  read_at    TIMESTAMPTZ,
  error_msg  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_nt_sent CHECK (status != 'SENT' OR sent_at IS NOT NULL),
  CONSTRAINT chk_nt_read CHECK (status != 'READ' OR read_at IS NOT NULL)
);

CREATE TABLE nt_announcements (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  title      VARCHAR(255) NOT NULL,
  body       TEXT         NOT NULL,
  target     VARCHAR(50)  NOT NULL DEFAULT 'ALL',
  sent_at    TIMESTAMPTZ,
  created_by UUID         NOT NULL REFERENCES id_users(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_nt_notifications_user_unread ON nt_notifications(user_id, created_at DESC)
  WHERE status IN ('QUEUED', 'SENT');
CREATE INDEX idx_nt_notifications_queued ON nt_notifications(status, created_at) WHERE status = 'QUEUED';

-- DOWN:
-- DROP TABLE IF EXISTS nt_announcements;
-- DROP TABLE IF EXISTS nt_notifications;
