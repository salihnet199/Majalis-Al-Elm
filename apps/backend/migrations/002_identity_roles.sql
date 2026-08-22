-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 002 — BC01: Identity Roles
-- DB-SCHEMA.md v1.1.0 · Tables: id_roles, id_user_roles
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE id_roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  name        VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed: 5 system roles — immutable after insert (ARCHITECTURE_VISION §5)
INSERT INTO id_roles (name, description, is_system) VALUES
  ('SuperAdmin',  'Full platform access — immutable',           TRUE),
  ('Admin',       'Platform administration and user management', TRUE),
  ('Editor',      'Content CRUD, media library, publishing',    TRUE),
  ('Moderator',   'Comments/QA moderation, user suspension',    TRUE),
  ('User',        'Default authenticated end-user',             TRUE)
ON CONFLICT (name) DO NOTHING;


CREATE TABLE id_user_roles (
  user_id     UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  role_id     UUID        NOT NULL REFERENCES id_roles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID        REFERENCES id_users(id),
  PRIMARY KEY (user_id, role_id)
);
