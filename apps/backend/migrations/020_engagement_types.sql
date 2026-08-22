-- Migration: 020_engagement_types.sql
-- BC03: Engagement — ENUM Types
-- DB-SCHEMA.md §BC03

CREATE TYPE eg_moderation_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');

-- DOWN:
-- DROP TYPE IF EXISTS eg_moderation_status;
