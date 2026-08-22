-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 001 — BC01: Identity Users
-- DB-SCHEMA.md v1.1.0 · Table: id_users
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE id_users (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  full_name     VARCHAR(200) NOT NULL,
  email         CITEXT       UNIQUE,
  phone_e164    VARCHAR(20)  UNIQUE,
  password_hash VARCHAR(255),
  avatar_url    TEXT,
  bio           TEXT,
  locale        VARCHAR(10)  NOT NULL DEFAULT 'ar',
  theme         VARCHAR(20)  NOT NULL DEFAULT 'system',
  audio_speed   DECIMAL(3,2) NOT NULL DEFAULT 1.00
                             CHECK (audio_speed BETWEEN 0.5 AND 2.0),
  is_suspended  BOOLEAN      NOT NULL DEFAULT FALSE,
  suspended_at  TIMESTAMPTZ,
  suspended_by  UUID         REFERENCES id_users(id),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_id_users_contact
    CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CONSTRAINT chk_id_users_suspension
    CHECK (is_suspended = FALSE OR suspended_at IS NOT NULL)
);

CREATE UNIQUE INDEX idx_id_users_email_active  ON id_users(email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_id_users_phone_active  ON id_users(phone_e164) WHERE deleted_at IS NULL;
