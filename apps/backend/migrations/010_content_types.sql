-- Migration: 010_content_types.sql
-- BC02: Content & Media Library — ENUMs
-- DB-SCHEMA.md v1.1.0 §BC02

-- Content type: AUDIO | PDF | TEXT | IMAGE — NO VIDEO (Charter §3.2)
CREATE TYPE ct_content_type AS ENUM ('AUDIO', 'PDF', 'TEXT', 'IMAGE');

-- Workflow status
CREATE TYPE ct_content_status AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');

-- Media transcode pipeline status
CREATE TYPE ct_transcode_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');
