-- Migration: 043_engagement_questions_moderation_audit.sql
--
-- eg_questions never got the moderation audit columns that eg_comments has
-- (021_engagement_comments.sql). The application code always accepted a
-- moderatorId when moderating a question, but had nowhere to persist it —
-- question.service.ts#moderate() silently discarded it. This closes that
-- gap for consistency and accountability across both moderation flows.

ALTER TABLE eg_questions
  ADD COLUMN moderated_by UUID REFERENCES id_users(id),
  ADD COLUMN moderated_at TIMESTAMPTZ;

ALTER TABLE eg_questions
  ADD CONSTRAINT chk_eg_questions_moderation
    CHECK (status = 'PENDING' OR moderated_by IS NOT NULL);
