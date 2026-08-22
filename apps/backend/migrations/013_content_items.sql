-- Migration: 013_content_items.sql
-- BC02: Content Items + Content-Tag junction
-- DB-SCHEMA.md v1.1.0 §BC02

CREATE TABLE ct_content_items (
  id             UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug           VARCHAR(300)      NOT NULL UNIQUE,
  type           ct_content_type   NOT NULL,
  status         ct_content_status NOT NULL DEFAULT 'DRAFT',
  primary_locale VARCHAR(10)       NOT NULL DEFAULT 'ar',
  author_id      UUID              REFERENCES ct_authors(id),
  category_id    UUID              REFERENCES ct_categories(id),
  media_asset_id UUID              REFERENCES ct_media_assets(id),
  view_count     BIGINT            NOT NULL DEFAULT 0,
  sort_order     INTEGER           NOT NULL DEFAULT 0,
  is_featured    BOOLEAN           NOT NULL DEFAULT FALSE,
  published_at   TIMESTAMPTZ,
  scheduled_at   TIMESTAMPTZ,
  created_by     UUID              NOT NULL REFERENCES id_users(id),
  last_edited_by UUID              REFERENCES id_users(id),
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ct_items_published
    CHECK (status != 'PUBLISHED' OR published_at IS NOT NULL)
);

CREATE TABLE ct_content_tags (
  content_id UUID NOT NULL REFERENCES ct_content_items(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES ct_tags(id)          ON DELETE CASCADE,
  PRIMARY KEY (content_id, tag_id)
);

-- Indexes
CREATE INDEX idx_ct_items_status_type    ON ct_content_items(status, type)     WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_items_category       ON ct_content_items(category_id)      WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_items_author         ON ct_content_items(author_id)        WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_items_published_desc ON ct_content_items(published_at DESC)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX idx_ct_items_featured       ON ct_content_items(is_featured)
  WHERE is_featured = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_ct_items_scheduled      ON ct_content_items(scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'DRAFT';
