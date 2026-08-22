-- Migration: 014_content_translations.sql
-- BC02: Centralized i18n translations table
-- DB-SCHEMA.md v1.1.0 §BC02
--
-- TEXT type content: body stored directly in ct_translations.content
-- (field_name='body') — supports ILIKE search (DB-002)
-- Supported locales: ar | en | fr | ur | ms

CREATE TABLE ct_translations (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  entity_type VARCHAR(50)  NOT NULL,
  entity_id   UUID         NOT NULL,
  locale      VARCHAR(10)  NOT NULL CHECK (locale IN ('ar', 'en', 'fr', 'ur', 'ms')),
  field_name  VARCHAR(100) NOT NULL,
  content     TEXT         NOT NULL,
  created_by  UUID         REFERENCES id_users(id),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, locale, field_name)
);

CREATE INDEX idx_ct_translations_lookup ON ct_translations(entity_type, entity_id, locale);
