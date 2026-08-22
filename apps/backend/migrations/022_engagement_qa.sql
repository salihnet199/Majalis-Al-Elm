-- Migration: 022_engagement_qa.sql
-- BC03: Engagement — Questions & Answers
-- DB-SCHEMA.md §BC03

CREATE TABLE eg_questions (
  id          UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  content_id  UUID,                -- Cross-BC — اختياري (ct_content_items.id — بدون FK)
  user_id     UUID                 NOT NULL REFERENCES id_users(id),
  title       VARCHAR(500)         NOT NULL CHECK (char_length(title) BETWEEN 5 AND 500),
  body        TEXT                 CHECK (body IS NULL OR char_length(body) <= 5000),
  status      eg_moderation_status NOT NULL DEFAULT 'PENDING',
  is_answered BOOLEAN              NOT NULL DEFAULT FALSE,
  deleted_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

CREATE TABLE eg_answers (
  id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  question_id      UUID                 NOT NULL REFERENCES eg_questions(id) ON DELETE CASCADE,
  user_id          UUID                 NOT NULL REFERENCES id_users(id),
  body             TEXT                 NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  is_accepted      BOOLEAN              NOT NULL DEFAULT FALSE,
  answered_by_role VARCHAR(50)          NOT NULL DEFAULT 'User',
  status           eg_moderation_status NOT NULL DEFAULT 'PENDING',
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);

-- Indexes — DB-SCHEMA.md §BC03
CREATE INDEX idx_eg_questions_content ON eg_questions(content_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_eg_questions_pending ON eg_questions(status) WHERE status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX idx_eg_answers_question  ON eg_answers(question_id) WHERE deleted_at IS NULL;

-- DOWN:
-- DROP TABLE IF EXISTS eg_answers;
-- DROP TABLE IF EXISTS eg_questions;
