-- Migration: 015_content_media_upload.sql
-- BC02: Real presigned-URL upload lifecycle for ct_media_assets (ADR-013 Stage A)
--
-- WHY THIS MIGRATION EXISTS
-- ─────────────────────────
-- Before ADR-013 Stage A, ct_media_assets had exactly one status column,
-- `transcode_status`, and the upload endpoints were stubs: POST .../upload/complete
-- called markDone() and set transcode_status='DONE' WITHOUT EVER CHECKING that a
-- byte had reached storage. That is POLICY-SEC-001 category 3+4 (fabricating
-- success / fabricating readiness) and is registered as TECH-DEBT-014.
--
-- Upload and transcoding are two INDEPENDENT lifecycles, and ADR-013 §3 already
-- describes them as such ("media row status=UPLOADING" ... "status=UPLOADED",
-- separate from the transformation pipeline). Collapsing them into one column made
-- it impossible to express the truth "the file really is in the bucket, and no
-- transcoding has happened yet" — so the code lied instead.
--
-- Stage B (BullMQ + ffmpeg/sharp) is NOT implemented. Therefore transcode_status
-- MUST remain 'PENDING' for every asset: there is no pipeline, so nothing may
-- claim DONE. This migration deliberately does not touch transcode_status.

-- ── Upload lifecycle states ──────────────────────────────────────────────────
--   PENDING_UPLOAD : row created, presigned URL issued, bytes NOT yet verified
--   UPLOADED       : headObject succeeded — object exists with the expected size
--   ABORTED        : verification failed or the editor cancelled; key is garbage
CREATE TYPE ct_upload_status AS ENUM ('PENDING_UPLOAD', 'UPLOADED', 'ABORTED');

ALTER TABLE ct_media_assets
  -- Existing rows predate the presigned flow. They were created by the stub, so
  -- their bytes were never verified: ABORTED is the only honest backfill value.
  -- (Marking them UPLOADED would re-commit the exact fabrication this migration
  -- exists to remove.)
  ADD COLUMN upload_status    ct_upload_status NOT NULL DEFAULT 'PENDING_UPLOAD',

  -- Hex SHA-256 of the file, declared by the client at initiate and used as the
  -- immutable object key (ADR-013 §2: originals/<media_id>/<sha256>.<ext>).
  -- Also sent as a signed x-amz-checksum-sha256 header so the STORAGE ITSELF
  -- rejects a body that does not hash to this value.
  ADD COLUMN sha256           CHAR(64),

  -- Authoritative size read back from storage via headObject at complete time.
  -- size_bytes is what the CLIENT CLAIMED; this is what storage actually holds.
  -- They must match or the asset is rejected. Never trust the declared value.
  ADD COLUMN verified_bytes   BIGINT,

  -- When headObject confirmed the object. NULL ⇒ never verified, full stop.
  ADD COLUMN uploaded_at      TIMESTAMPTZ,

  -- S3 multipart upload id, for files above the single-PUT threshold.
  ADD COLUMN multipart_upload_id TEXT,

  -- Why an upload was aborted — shown to the editor instead of a fake success.
  ADD COLUMN upload_error     TEXT;

-- sha256 must be lowercase hex when present (the key is built from it).
ALTER TABLE ct_media_assets
  ADD CONSTRAINT ct_media_sha256_hex
  CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$');

ALTER TABLE ct_media_assets
  ADD CONSTRAINT ct_media_verified_bytes_positive
  CHECK (verified_bytes IS NULL OR verified_bytes > 0);

-- The core integrity invariant, enforced by the DATABASE and not only by NestJS:
-- an asset may not be marked UPLOADED without the two facts that prove it was.
-- Any future code path that tries to fabricate UPLOADED without verifying gets a
-- constraint violation rather than a silent lie.
ALTER TABLE ct_media_assets
  ADD CONSTRAINT ct_media_uploaded_requires_verification
  CHECK (
    upload_status <> 'UPLOADED'
    OR (verified_bytes IS NOT NULL AND uploaded_at IS NOT NULL AND sha256 IS NOT NULL)
  );

-- Backfill: stub-era rows were never verified. ABORTED is the truthful value.
UPDATE ct_media_assets
   SET upload_status = 'ABORTED',
       upload_error  = 'Created by the pre-ADR-013 upload stub; bytes were never verified (TECH-DEBT-014).'
 WHERE upload_status = 'PENDING_UPLOAD';

-- Finding abandoned uploads for the Stage C garbage collector (ADR-013 §5 rule L4).
CREATE INDEX idx_ct_media_upload_status
  ON ct_media_assets(upload_status, created_at)
  WHERE deleted_at IS NULL;

-- One object per content hash: the same file uploaded twice reuses the same key,
-- which storage_key UNIQUE already enforces. This index makes the dedupe lookup
-- cheap and documents the intent (ADR-013: deterministic keying, no duplicates).
CREATE INDEX idx_ct_media_sha256
  ON ct_media_assets(sha256)
  WHERE deleted_at IS NULL AND sha256 IS NOT NULL;

COMMENT ON COLUMN ct_media_assets.upload_status IS
  'Upload lifecycle — independent of transcode_status. UPLOADED is set ONLY after a successful headObject (POLICY-SEC-001 / TECH-DEBT-014).';
COMMENT ON COLUMN ct_media_assets.verified_bytes IS
  'Size read back FROM STORAGE. size_bytes is the client-declared value; a mismatch aborts the upload.';
COMMENT ON COLUMN ct_media_assets.transcode_status IS
  'Transformation pipeline state. ADR-013 Stage B is not implemented, so this stays PENDING — no DONE without a real pipeline.';
