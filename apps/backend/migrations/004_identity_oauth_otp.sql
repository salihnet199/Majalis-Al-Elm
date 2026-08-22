-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 004 — BC01: Identity OAuth + OTP
-- DB-SCHEMA.md v1.1.0 · Tables: id_social_identities, id_otp_challenges
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE id_social_identities (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     UUID         NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  provider    VARCHAR(20)  NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
  provider_id VARCHAR(255) NOT NULL,
  email       CITEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);

CREATE INDEX idx_id_social_user ON id_social_identities(user_id);

CREATE TABLE id_otp_challenges (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_e164   VARCHAR(20) NOT NULL,
  otp_hash     VARCHAR(64) NOT NULL,
  purpose      VARCHAR(30) NOT NULL CHECK (purpose IN ('login', 'register', 'reset_password')),
  attempts     SMALLINT    NOT NULL DEFAULT 0,
  max_attempts SMALLINT    NOT NULL DEFAULT 3,
  is_used      BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_id_otp_attempts CHECK (attempts >= 0 AND attempts <= max_attempts)
);

CREATE INDEX idx_id_otp_phone_expires ON id_otp_challenges(phone_e164, expires_at) WHERE NOT is_used;
