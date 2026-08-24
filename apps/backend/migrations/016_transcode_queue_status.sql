-- Migration: 016_transcode_queue_status.sql
-- BC02: ADR-013 Stage B — BullMQ transcode queue status values
--
-- WHY THIS MIGRATION EXISTS
-- ─────────────────────────
-- Migration 015 left transcode_status as an enum with values from the old
-- two-column design: PENDING | PROCESSING | DONE | FAILED. Stage B introduces
-- a queue-based pipeline with distinct states:
--
--   QUEUED          : job inserted into BullMQ, waiting for a worker slot
--   TRANSCODING     : a worker has picked up the job and is running ffmpeg
--   TRANSCODED      : ffmpeg succeeded, processed file uploaded to R2
--   TRANSCODE_FAILED: all retry attempts exhausted, error stored
--
-- PENDING stays as the initial state for newly uploaded assets — the moment a
-- UPLOADED asset enters the queue, the worker transitions it to QUEUED.
-- PROCESSING / DONE / FAILED are kept for backwards compatibility (existing rows)
-- but new code will only set the new values.
--
-- NOTE: PostgreSQL ALTER TYPE ... ADD VALUE cannot run inside a transaction
-- that also modifies the enum or its columns. Run this migration on its own
-- or wrap ONLY the ALTER TYPE statements outside BEGIN/COMMIT.

-- Add Stage B queue states to the existing transcode_status enum.
-- IF NOT EXISTS prevents re-runs from failing (idempotent).
ALTER TYPE ct_transcode_status ADD VALUE IF NOT EXISTS 'QUEUED'           AFTER 'PENDING';
ALTER TYPE ct_transcode_status ADD VALUE IF NOT EXISTS 'TRANSCODING'      AFTER 'QUEUED';
ALTER TYPE ct_transcode_status ADD VALUE IF NOT EXISTS 'TRANSCODED'       AFTER 'TRANSCODING';
ALTER TYPE ct_transcode_status ADD VALUE IF NOT EXISTS 'TRANSCODE_FAILED' AFTER 'TRANSCODED';

-- Add transcode_error column for storing failure reasons (already present in
-- the entity; this ensures the DB matches).
-- ALTER TABLE is idempotent via column existence check.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'ct_media_assets'
       AND column_name = 'transcode_error'
  ) THEN
    ALTER TABLE ct_media_assets ADD COLUMN transcode_error TEXT;
  END IF;
END;
$$;

-- Index for monitoring: quickly find all assets in a given transcode state.
-- Useful for dashboards and the Stage C garbage collector.
CREATE INDEX IF NOT EXISTS idx_ct_media_transcode_status
  ON ct_media_assets(transcode_status, created_at)
  WHERE deleted_at IS NULL;

COMMENT ON COLUMN ct_media_assets.transcode_status IS
  'Transformation pipeline state (ADR-013 Stage B). QUEUED→TRANSCODING→TRANSCODED|TRANSCODE_FAILED. PENDING = not yet queued.';

COMMENT ON COLUMN ct_media_assets.transcode_error IS
  'Last transcode failure reason (from BullMQ worker). NULL when status is not TRANSCODE_FAILED.';
