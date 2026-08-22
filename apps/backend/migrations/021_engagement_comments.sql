-- Migration: 021_engagement_comments.sql
-- BC03: Engagement — Comments & Votes
-- DB-SCHEMA.md §BC03

CREATE TABLE eg_comments (
  id            UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  content_id    UUID                 NOT NULL,   -- Cross-BC: ct_content_items.id — بدون FK (DB-SCHEMA §Cross-BC)
  user_id       UUID                 NOT NULL REFERENCES id_users(id),
  parent_id     UUID                 REFERENCES eg_comments(id),
  body          TEXT                 NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  upvotes_count INTEGER              NOT NULL DEFAULT 0 CHECK (upvotes_count >= 0),
  status        eg_moderation_status NOT NULL DEFAULT 'PENDING',
  moderated_by  UUID                 REFERENCES id_users(id),
  moderated_at  TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_eg_comments_moderation
    CHECK (status = 'PENDING' OR moderated_by IS NOT NULL)
);

CREATE TABLE eg_comment_votes (
  user_id    UUID        NOT NULL REFERENCES id_users(id),
  comment_id UUID        NOT NULL REFERENCES eg_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, comment_id)
);

-- Indexes — DB-SCHEMA.md §BC03
CREATE INDEX idx_eg_comments_content_approved ON eg_comments(content_id, created_at DESC)
  WHERE status = 'APPROVED' AND deleted_at IS NULL;
CREATE INDEX idx_eg_comments_pending          ON eg_comments(status, created_at) WHERE status = 'PENDING';
CREATE INDEX idx_eg_comments_user             ON eg_comments(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_eg_comments_parent           ON eg_comments(parent_id)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;

-- DOWN:
-- DROP TABLE IF EXISTS eg_comment_votes;
-- DROP TABLE IF EXISTS eg_comments;
