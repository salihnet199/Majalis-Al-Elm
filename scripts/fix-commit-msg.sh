#!/usr/bin/env bash
# fix-commit-msg.sh
# Rewrites the commit message of e8ad3d4 using filter-branch (bash-native).

set -euo pipefail

BAD_HASH="e8ad3d4c356062ab62893249096f688da2602de1"
TMP=$(mktemp)

cat > "$TMP" << 'COMMIT_MSG'
feat(media): implement ADR-013 Stage A — presigned direct-upload pipeline

Full implementation of the server-verified direct-upload flow:

- Backend: MediaUploadService (initiate/complete/verify), presigned PUT + multipart
  support via S3StorageAdapter (MinIO-compatible, R2-ready)
- Backend: storage integrity guard (boot-time HeadBucket, NODE_ENV-aware credential
  validation) — the server refuses to start without a reachable bucket
- Backend: media-asset domain entity + UPLOADED/ABORTED state machine with DB CHECK
  constraint; no fabricated success state is possible
- Backend: admin-media.controller (POST /initiate, POST /complete, GET /:id/status,
  GET /:id/download-url) behind JwtAuthGuard + SuperAdmin gate
- Admin: MediaUploadField replacing the previous plain-URL text input; reports
  HASHING / UPLOADING / VERIFYING phases with abort; reads asset status from server
  on load — never assumes success on its own authority
- Admin: ContentModal + ContentListScreen updated to use mediaAssetId throughout
- Tests: anti-fabrication spec (23 scenarios), storage-integration spec (MinIO live),
  content-integration spec extended; failure_paths and media_upload admin specs added
- Migration 015: ct_media_assets table + UPLOADED/ABORTED/PENDING CHECK constraints
- .env.example: full S3/R2 configuration guide with switching instructions
- docker-compose: MinIO service + bucket bootstrap

Note: transcodeStatus stays PENDING (ADR-013 Stage B not yet implemented).
The response says so explicitly — no fabricated processing state anywhere.

Closes TECH-DEBT-014. Part of POLICY-SEC-001 remediation.
COMMIT_MSG

echo "Rewriting commit $BAD_HASH..."
FILTER_BRANCH_SQUELCH_WARNING=1 git filter-branch -f \
  --msg-filter "if [ \"\$GIT_COMMIT\" = \"$BAD_HASH\" ]; then cat \"$TMP\"; else cat; fi" \
  HEAD~1..HEAD

rm -f "$TMP"

echo ""
echo "=== Verifying result ==="
git log --oneline -3
echo ""
git show HEAD~1 --format="HASH: %H%nSUBJECT: %s" --no-patch
echo ""
echo "Full body:"
git log -1 HEAD~1 --format="%b"
