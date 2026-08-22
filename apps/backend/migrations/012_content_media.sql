-- Migration: 012_content_media.sql
-- BC02: Media Assets (AUDIO/PDF/IMAGE only — NO VIDEO per Charter §3.2)
-- DB-SCHEMA.md v1.1.0 §BC02

CREATE TABLE ct_media_assets (
  id               UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  original_name    VARCHAR(500)        NOT NULL,
  storage_key      TEXT                NOT NULL UNIQUE,
  -- cdn_url: public assets only (thumbnails/images). Protected content (AUDIO, PDF)
  -- uses Presigned URLs — NO permanent cdn_url (API-002 security rule)
  cdn_url          TEXT,
  mime_type        VARCHAR(100)        NOT NULL,
  size_bytes       BIGINT              NOT NULL CHECK (size_bytes > 0),
  duration_ms      INTEGER             CHECK (duration_ms IS NULL OR duration_ms > 0),
  page_count       INTEGER             CHECK (page_count IS NULL OR page_count > 0),
  width_px         INTEGER             CHECK (width_px IS NULL OR width_px > 0),
  height_px        INTEGER             CHECK (height_px IS NULL OR height_px > 0),
  thumbnail_key    TEXT,
  transcode_status ct_transcode_status NOT NULL DEFAULT 'PENDING',
  transcode_error  TEXT,
  uploaded_by      UUID                NOT NULL REFERENCES id_users(id),
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ct_media_transcode ON ct_media_assets(transcode_status) WHERE deleted_at IS NULL;
