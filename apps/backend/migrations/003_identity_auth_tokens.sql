-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 003 — BC01: Identity Auth Tokens
-- DB-SCHEMA.md v1.1.0 · Tables: id_refresh_tokens, id_password_reset_tokens
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE id_refresh_tokens (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID         NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64)  NOT NULL UNIQUE,
  token_family UUID         NOT NULL,
  device_name  VARCHAR(200),
  device_ip    INET,
  user_agent   TEXT,
  is_revoked   BOOLEAN      NOT NULL DEFAULT FALSE,
  revoked_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_id_refresh_revocation
    CHECK (is_revoked = FALSE OR revoked_at IS NOT NULL)
);

CREATE INDEX idx_id_refresh_user_active ON id_refresh_tokens(user_id) WHERE NOT is_revoked;
CREATE INDEX idx_id_refresh_family      ON id_refresh_tokens(token_family);
CREATE INDEX idx_id_refresh_expires     ON id_refresh_tokens(expires_at) WHERE NOT is_revoked;

CREATE TABLE id_password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  is_used    BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
