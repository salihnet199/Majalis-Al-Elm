# ADR-013: Media Storage — S3-Compatible Object Storage (Cloudflare R2 / Backblaze B2 / self-hosted MinIO) over Local Filesystem / PostgreSQL BLOBs

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: DevOps Lead, Media Pipeline SMEs, Backend Lead, Cost Owner
- **Date:** 2026-08-07 (Revised & accepted 2026-08-09)
- **Supersedes:** None (foundational media architecture decision)
- **Related:** ADR-001 (Modular Monolith), ADR-005 (PostgreSQL 16), ADR-007 (IaC — Docker Compose), ADR-011 (Observability — Lightweight Monitoring), ADR-012 (Mobile Isar — metadata cache only)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform stores, serves, and processes **4 content types with large binary payloads** that impose strict architectural requirements on the media storage subsystem:

- **4 Content Types with distinct size distributions:**
  1. **AUDIO (Islamic recitations, lectures, audiobooks):** 30–200 MB per file (320 kbps MP3 / 256 kbps AAC). Phase-1 library ~3,000–5,000 files ≈ **300–500 GB**.
  2. **PDF / BOOK (mushafs, textbooks, worksheets):** 1–50 MB per file. Color textbooks with embedded fonts = 20–100 MB. Phase-1 library ~2,000–4,000 files ≈ 100–150 GB.
  3. **TEXT content:** Bodies stored in PostgreSQL. **Cover images + inline IMAGE attachments:** 0.2–5 MB each.
  4. **IMAGE (covers, infographics, thumbnails, author avatars):** 0.1–5 MB each. Phase-1 ~10,000–20,000 files ≈ 10–20 GB.
  - **Total Phase 1 (first-year) estimate: ~0.5 TB**, growing steadily as the content library expands. The architecture must scale to **tens of TB over several years without a storage-layer rewrite** (Charter §2 — "path to hundreds of thousands of users without rewrite"). Storage headroom is *enabled by design*, not provisioned on day one.
- **Right-sized Phase 1 scale (per Charter / ADR-003):** **1,000–5,000 users in the first 6 months.** At this user count, monthly media egress is on the order of **~1–2 TB/month** (each active user downloading a handful of audio/PDF items). Egress pricing is still the #1 cost driver and remains a top criterion, but the absolute numbers are modest — which makes the wrong choice (a surprise egress bill) all the more wasteful.
- **Mobile offline download mandate (ADR-012):** Users download audio + PDF to device over HTTPS. Media must be served via CDN edge locations close to MENA users (Riyadh, Dubai, Cairo, Casablanca, Lahore, Kuala Lumpur). Round-trip time from the Hostinger VPS (default EU location) to rural MENA is 250–600 ms. Without CDN edge caching, a 100 MB audio download takes 45–120 seconds → the user cancels and uninstalls.
- **3 Upload flows:** (1) **Editors** via the React Admin AntD drag-and-drop uploader; (2) **Admin** bulk import (ZIP archive, hundreds of files at once); (3) a future mobile author/editor direct-upload app. All uploads MUST use **presigned URLs** — media binaries NEVER traverse the NestJS backend server. The backend only signs URLs with metadata; the upload goes client → object storage directly. This prevents backend OOM crashes on 200 MB audio uploads.
- **Media pipeline processing:** Audio → automatic loudness normalization (EBU R128), silence-trim intro/outro, 3-tier transcoding (128/192/320 kbps), waveform preview PNG. PDF → invisible DRM-free watermark (user-ID hash per page), thumbnail, linearization for fast web view. Images → WebP conversion, 5 responsive breakpoints (240w/480w/768w/1024w/1440w), AVIF for modern browsers. Output artifacts stored as derived objects keyed by source `media_id` + transformation ID.
- **Lifecycle policies mandate:** Orphaned media (uploaded but `ContentMeta` row deleted) → deleted after 14 days. Derived files older than 2 years with zero CDN access → deleted (recompute on demand). Original master audio → cold/Deep-Archive storage class after 5 years. All policies automated, no manual cleanup.
- **Budget Constraint Phase 1: Hostinger VPS (~4 GB RAM / 2 vCPU, ~200 GB NVMe SSD per ADR-007).** The entire VPS disk is insufficient to store even the ~0.5 TB first-year media library. **Local filesystem fails on Day 1 on capacity alone.** We need external pay-as-you-go storage AND/OR a self-hosted MinIO on a dedicated cheap storage box.
- **Vendor-Lock-in Intolerant:** Backblaze B2 is cheapest per GB; Cloudflare R2 has zero egress fees; AWS S3 is most ubiquitous. We must be able to SWITCH between any S3-compatible vendor with ZERO application-code changes — only config/env-var changes (endpoint + keys + bucket name).
- **Data Residency (Phase 2 MENA):** A Phase 2 KSA/UAE deployment requires media binaries stored within national borders. S3-compatible storage lets us use (a) AWS me-central-1, (b) a local MENA S3-compatible cloud (STC Cloud Saudi, du UAE Cloud), or (c) self-hosted MinIO on a KSA VPS. Local filesystem = physically impossible to migrate jurisdictions without a full copy/download.
- **Billing-model awareness:** Even at Phase-1's ~1–2 TB/month egress, AWS S3 egress ($0.09/GB) = ~$90–180/month for egress **alone**; Backblaze B2 ($0.01/GB) = ~$10–20/month; Cloudflare R2 ($0/GB egress) = **$0**. Egress pricing must be a top criterion because it is the one line item that scales with success.

A wrong choice means: (a) the Hostinger VPS disk fills within months → production outage; (b) a surprise AWS egress bill; (c) backend crashes during bulk upload because 200 MB files traverse NestJS; (d) Phase 2 KSA data residency requires a full download + re-upload with days of downtime; (e) CDN caching is impossible → MENA users wait 60+ seconds for audio to start.

---

## 2. Decision

**✅ WE WILL ADOPT S3-COMPATIBLE OBJECT STORAGE for all media binaries. Media pipeline = (a) presigned-URL direct client uploads to the bucket, (b) NestJS backend does metadata + signing only (no binary passthrough), (c) event notifications → BullMQ worker pipeline for audio/PDF/image transformations → derived objects written back to the same bucket, (d) a CDN edge-caching layer in front of the bucket for downloads/streaming, (e) automated lifecycle policies. The S3 interface is the ONLY contract between application code and the storage backend.**

**Phase 1 Launch Vendor Choice:** Start with **Cloudflare R2** for its zero-egress-fee pricing (unbeatable even at Phase-1 egress volumes). If R2 MENA availability/performance does not meet benchmarks within 60 days post-launch → seamlessly migrate to **Backblaze B2** or **self-hosted MinIO**. All migrations use the S3 API → zero application code touched.

Concrete actions implementing this decision:
1. **S3 API only — no vendor-specific SDK imports.** Backend uses the **AWS SDK v3 `S3Client`** exclusively. Constructor config `{ region, endpoint, credentials, forcePathStyle: true }` — ALL read from environment variables (`S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_BUCKET_NAME`, `S3_REGION`). **No imports of `@minio/*`, `@cloudflare/*`, or `backblaze-b2` packages in application code.** If the S3 client can connect → the provider works. *(The active provider is a placeholder/config choice, never hardcoded — consistent with the project-wide env-configurable-endpoints rule.)*
2. **Bucket Layout (flat key structure, no pseudo-folders):**
   ```
   s3://<bucket-name>/
     originals/<media_id>/<sha256>.<ext>                 # Raw master upload, never modified
     derived/<media_id>/<transform_id>/<quality>.<ext>   # Post-processing artifacts
       e.g. derived/audio-abc123/transcode/audio-192kbps.mp3
            derived/image-def456/responsive/thumb-480w.webp
     temp/<upload_session_id>/<chunk_index>              # Multipart staging, lifecycle-delete after 24h
     public-thumbnails/<media_id>/cover.webp             # CDN-cacheable, no signed URL needed
   ```
   Every key includes `media_id` (UUID v4 from the PostgreSQL `media` table). Object access = CDN-origin-only via bucket policy.
3. **Upload Flow (MANDATORY — presigned URL direct, NO backend binary passthrough):**
   - **Small files (<100 MB):** client calls `POST /api/v1/media/init-upload` → NestJS inserts a `media` row (status=UPLOADING), generates a 5-minute `putObject` presigned URL with a `content-length-range` condition → returns the URL + `media_id`.
   - Client uploads the binary DIRECTLY to the S3 endpoint. Bytes NEVER traverse NestJS, the Node.js event loop, or the VPS network interface.
   - Client calls `POST /api/v1/media/<id>/complete` → NestJS `headObject` verifies `content-length` + checksum → sets `media.status=UPLOADED` → emits `MediaUploadedEvent` on the BullMQ bus → the MediaPipelineWorker starts transformations.
   - **Large files (audio >100 MB):** `POST /api/v1/media/init-multipart-upload` → array of 15 MB chunk presigned URLs + `upload_id`. Client uploads chunks in parallel → `POST /api/v1/media/<id>/complete-multipart` with the ETag list → NestJS calls `CompleteMultipartUploadCommand`.
   - **Anti-pattern forbidden by lint:** any `@Controller()` handler accepting a media `Buffer`/`MultipartFile` in `@Body()`. Upload endpoints return 406 if a binary >16 MB is sent to NestJS directly.
4. **CDN Edge Caching Layer (MANDATORY — performance for MENA users):**
   - **Phase 1 CDN: Cloudflare CDN** (free tier easily covers Phase-1 egress; 275+ PoPs including Dubai, Riyadh, Cairo, Johannesburg, Mumbai, Jakarta). The R2 bucket is a Cloudflare origin → **zero egress fees on R2 → Cloudflare traffic** (the combination that makes R2 financially unbeatable).
   - Cache rules: `derived/*` → `Cache-Control: public, max-age=31536000, immutable` (transform_id hash changes on re-process). `originals/*` → `private` (signed URLs, never cached). `public-thumbnails/*` → 1-year immutable.
   - Cache-key varies by `Accept-Encoding` and `Accept` (WebP vs AVIF vs JPEG negotiation).
   - **Cache HIT target:** ≥90% HIT ratio for popular content within 30 days of release. Monitored via Cloudflare Analytics + a `cdn_hit_ratio` field in the app's **structured JSON logs** (per ADR-011).
5. **Media Lifecycle Policies (bucket-level config, checked into IaC):**
   - Rule L1: `temp/` → `AbortIncompleteMultipartUpload` + `Expiration` after 1 day.
   - Rule L2: `originals/` + 1825 days (5 years) + no access for 365 days → transition to a Deep-Archive storage class (masters retained forever per IP policy, just moved to cold storage).
   - Rule L3: `derived/` + 730 days (2 years) + `tag:Accessed=false` → `Expiration` delete (regenerated on demand).
   - Rule L4: objects with `tag:Orphaned=true` (set by the weekly GC cron) → `Expiration` after 14 days.
   - Weekly `MediaGarbageCollectionWorker`: reconciles the PostgreSQL `media` table vs the bucket inventory → tags DB-less objects `Orphaned=true`; deletion is delayed 14 days for safety.
6. **Transformation Pipeline Output Objects:**
   - Audio: 3 quality tiers (128/192/320 kbps) + waveform PNG (1000×80) → 4 derived objects per master.
   - PDF: watermarked (invisible per-page user-ID hash) → linearized → page-1 thumbnail → 2 derived objects per master.
   - Images: 5 responsive sizes (240w/480w/768w/1024w/1440w) in WebP + AVIF → 10 derived objects per master.
   - All derived keys = SHA-256 of (master SHA-256 + transform-spec JSON) → deterministic; the same transformation twice = the same key → no duplicated storage.
7. **Provider Migration Playbook (kept current in docs/):**
   - Switch R2 → B2 or MinIO: (1) update the `S3_*` env vars; (2) `rclone sync s3-old:old-bucket s3-new:new-bucket` on a high-bandwidth staging box; (3) point the CDN origin at the new bucket; (4) QA-verify 50 random URLs; (5) cut over (24h "orange-to-orange" origin fallback for stragglers). **Zero application-code changes; no NestJS redeploy — env-var update + `docker compose` restart of media workers.**
8. **Phase 2 Data Residency Playbook:**
   - KSA-only bucket: `s3-stc-saudi-riyadh` endpoint + new env vars. `media` gets a `jurisdiction` column. CDN rule: users in KSA (`CF-IPCountry: SA`) → KSA bucket signed URL; all others → global bucket. Legal signs off the cross-border cache policy.
9. **Monitoring + Cost Alerts (per ADR-011 — lightweight monitoring, NOT Prometheus/Grafana):**
   - Bucket size, object count, and PUT/GET/HEAD request counts are emitted as **structured JSON log** metrics by a small scheduled job; a monthly-cost estimate is logged alongside.
   - **Cost alert:** if the projected monthly media storage + CDN spend exceeds 120% of the approved budget, the scheduled job trips an **Uptime Kuma push monitor** → email/Telegram notification to DevOps + the Cost Owner.
   - **CDN HIT-ratio alert:** if the audio/PDF HIT ratio drops below 80% for 24h, the same mechanism raises an alert → cache-rules audit. *(No Prometheus TSDB, no Grafana dashboards in Phase 1; these arrive only if/when ADR-011's LGTM-upgrade triggers fire.)*

---

## 3. Alternatives Considered

### Alternative A: Local Filesystem on the Hostinger VPS + Nginx static file server
Upload → NestJS saves to `/var/media/` on the VPS SSD. Download → Nginx serves static files. No object storage, no CDN, no extra accounts.

- ✅ **Pro:** Simplest possible; works for a 10-file dev demo.
- ✅ **Pro:** Zero extra cost — no storage fees, no CDN fees, no signup.
- ❌ **Con:** **FATAL CAPACITY FAILURE — DAY 1 OF PRODUCTION.** The VPS SSD is ~200 GB; the first-year library alone is ~0.5 TB and grows. The disk fills within the first months. **Decision-killer.** Repeatedly upgrading VPS tiers for disk is 3–5× more expensive than R2/B2 + Cloudflare CDN and still hits ceilings.
- ❌ **Con:** **EGRESS BOTTLENECK + FAIR-USE CAP.** The VPS's monthly transfer allowance is finite; even Phase-1's ~1–2 TB/month of media egress competes with all other app traffic and risks throttling/suspension under fair-use terms.
- ❌ **Con:** **GLOBAL CDN CACHING IMPOSSIBLE.** URLs point at `https://vps-ip/files/x.mp3`. A KSA user downloading from an EU VPS → 600 ms RTT × 100 MB → **45–120 second** start time. Unacceptable for the MENA market.
- ❌ **Con:** **PRESIGNED URLS + BULK UPLOAD ANTI-PATTERN.** No presigned-URL concept → all uploads traverse NestJS → 200 MB audio → Node worker memory bloat → OOM. A bulk ZIP import of hundreds of files takes the app down for hours.
- ❌ **Con:** **DATA RESIDENCY PHASE 2 = DAYS OF DOWNTIME.** The whole library must be rsync'd to a KSA VPS; during transfer, media URLs 404. Zero-downtime migration is impossible without the S3 abstraction.
- ❌ **Con:** **NO LIFECYCLE POLICIES, NO PIPELINE STORAGE, NO CHECKSUMS/METADATA.** Manual cron + shell scripts → orphan bloat, ad-hoc derived-file keying, silent corruption without DB-stored SHA-256.

### Alternative B: PostgreSQL BLOBs (BYTEA columns / Large Objects)
Media binaries stored in PostgreSQL as `BYTEA`/`pg_largeobject`.

- ✅ **Pro:** ACID transactions → no orphaned BLOBs by design (cascading FK delete).
- ✅ **Pro:** One system to manage; `pg_dump` includes media.
- ❌ **Con:** **POSTGRESQL PERFORMANCE COLLAPSES ON LARGE BLOBS.** A 200 MB BYTEA = 25,600 8 KB pages read into `shared_buffers` → evicts everything else → OLTP query latency (auth, engagement, admin) drops **5–20× for minutes** after a single media read. This is the #1 documented PostgreSQL anti-pattern — a production outage for every other DB user. **Decision-killer.**
- ❌ **Con:** **STORAGE OVERHEAD = 2–3× vs object storage** (TOAST + WAL + base backups + replication). The first-year library balloons PostgreSQL size, and `pg_dump` / PITR grow from minutes to many hours.
- ❌ **Con:** **PRESIGNED URLS + DIRECT UPLOADS IMPOSSIBLE.** No HTTP interface → every binary traverses NestJS → PostgreSQL COPY → double-copy memory → OOM at scale.
- ❌ **Con:** **CDN CACHING STILL IMPOSSIBLE** — each cache miss = a 200 MB PostgreSQL read.
- ❌ **Con:** **NO LIFECYCLE / TIERED STORAGE without weeks of PL/pgSQL DBA work.**
- ❌ **Con:** **UNANIMOUS 15-YEAR INDUSTRY ANTI-PATTERN** — the PostgreSQL docs themselves recommend object/file storage for anything >10 MB. Migration out later = 2+ weeks of engineering.

### Alternative C: Vendor-Locked Non-S3 Object Storage APIs (Google Cloud Storage native, Azure Blob native)
Excellent services, priced similarly to AWS S3, with good MENA regions.

- ✅ **Pro:** Strong MENA regional availability (GCP Dammam, Azure UAE North); GCS `autoclass` auto-tiering.
- ❌ **Con:** **EGRESS FEES STILL EXPENSIVE** (~$0.08–0.12/GB) → the same bill-shock as AWS S3, just from a different logo.
- ❌ **Con:** **VENDOR-LOCKED SDKs → MIGRATION REQUIRES CODE CHANGES.** `@google-cloud/storage` `bucket.file().save()` → Backblaze = rewriting every storage call → 1–2 weeks + regression risk. S3 compatibility avoids this entirely.
- ❌ **Con:** **NO CLOUDFLARE R2 ZERO-EGRESS OPTION** — vendor-locked APIs forfeit the price arbitrage that the S3 abstraction unlocks.
- ❌ **Con:** **DATA RESIDENCY still needs vendor-specific setup** with less flexibility to pick a national cloud partner (STC/du are S3-compatible).

### Alternative D: S3-Compatible Object Storage + CDN (Our Decision)
Standardize on the S3 REST API + AWS SDK v3 client; provider is pluggable via env vars; served via CDN edge cache; presigned direct uploads; zero binary passthrough.

- ✅ **Pro:** **STORAGE + EGRESS COST — UNBEATABLE, WITH ARBITRAGE FREEDOM.** Cloudflare R2 zero-egress means the whole ~1–2 TB/month Phase-1 egress costs **$0**. First-year net media cost estimate:
  - R2 storage ~0.5 TB × $0.015/GB/mo ≈ **~$7.50/month storage.**
  - Cloudflare CDN (free tier): **$0.**
  - **Total ≈ $7–10/month** vs Local-FS VPS upgrades (~$150/mo and still capacity-capped), AWS S3 + egress (~$100–200/mo), or B2 + CDN (~$15–25/mo). If R2 raises prices → a 15-minute env-var change + `rclone` copy → Backblaze B2. **Cost optimization is a config edit, not a migration project.**
- ✅ **Pro:** **PRESIGNED DIRECT UPLOADS = BACKEND NEVER SEES MEDIA BYTES.** A 200 MB upload goes React Admin → bucket; NestJS sees only ~500-byte JSON init/complete calls. Backend memory stays flat. A bulk import = hundreds of presigned URLs in seconds, client-parallel — no OOM, no upload outages. Industry standard for user-media SaaS in 2026.
- ✅ **Pro:** **CLOUDFLARE CDN EDGE CACHING — 275+ PoPs INCLUDING MENA.** A 100 MB audio cached in Dubai (DXB) → a KSA/Jordan/Egypt user at 30–50 ms RTT → playback starts in **<1 SECOND** (vs 45–120 s VPS-only). This directly drives app-store reviews and retention.
- ✅ **Pro:** **PROVIDER MIGRATION WITH ZERO APP CODE CHANGES** across self-hosted MinIO (OVH/Hetzner/STC Saudi), Backblaze B2, Cloudflare R2, AWS S3 (me-central-1), STC Cloud Saudi / du UAE Cloud. One `S3Client` + env vars; migration = env-var update + `rclone sync`. Immense option value: we never bet on a single provider's multi-year pricing.
- ✅ **Pro:** **LIFECYCLE POLICIES + BUCKET INVENTORY = DECLARATIVE, ~10 LINES OF CONFIG** (orphan cleanup, derived cleanup, cold archive, abandoned-multipart cleanup). No cron shell scripts, no storage-bloat surprises.
- ✅ **Pro:** **DATA RESIDENCY (PHASE 2+) = TRIVIAL** — pick an S3-compatible KSA bucket, change env vars. No multi-day rsync, no code changes. Compliance becomes a 1-day DevOps task.
- ✅ **Pro:** **EVENT-DRIVEN PIPELINE** — bucket PUT → event → BullMQ worker → transforms → derived objects. No polling, no cron scanning.
- ✅ **Pro:** **DETERMINISTIC DERIVED KEYS = NO WASTED STORAGE** — same master + same transform spec → same key → no duplicate transcodes.
- ⚠️ **Trade-off:** One more infrastructure system (SDK config, bucket policies, presigned TTLs, CORS). **Mitigation:** a MinIO container for local dev with a pre-provisioned bucket + CORS; a staging R2 bucket identical to prod; a single centralized `S3Client` provider in the NestJS media module, covered by testcontainers-MinIO integration tests.
- ⚠️ **Trade-off:** Eventually-consistent semantics on overwrite/list. **Mitigation:** deterministic, immutable, hash-keyed derived objects (we never overwrite); a `/status` poll + "processing" spinner before exposing a download button.
- ⚠️ **Trade-off:** Presigned-URL signature gotchas (`forcePathStyle`, region, URL encoding). **Mitigation:** MinIO-testcontainer round-trip tests on every CI run; a QA checklist covering 1 MB / 100 MB / 250 MB uploads before each release.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alt A — Local FS + Nginx (VPS disk) | Alt B — PostgreSQL BYTEA / Large Objects | Alt C — Vendor-Locked Cloud (GCS/Azure native) | Alt D — S3-Compatible Object Storage + CDN ✅ CHOSEN |
|-----------|-------------------------------------|------------------------------------------|-------------------------------------------------|-------------------------------------------------------|
| **First-year cost — storage + egress (~0.5 TB, ~1–2 TB/mo egress)** | ⚠️ ~$150/mo VPS upgrades (still fills) | ⚠️ ~$100+/mo PostgreSQL SSD + backups | ❌ ~$100–200/mo (8–12¢/GB egress) | ✅ **~$7–10/mo Cloudflare R2 + free CDN** |
| **VPS disk capacity (200 GB vs ~0.5 TB+ needed)** | ❌ **FATAL FAIL — disk fills in months** | ❌ **CAPACITY + PERFORMANCE disaster** (library × 2–3 in PostgreSQL) | ✅ Virtually unlimited | ✅ Virtually unlimited |
| **MENA audio start latency (100 MB, KSA user)** | ❌ **45–120 s** (no CDN, 250–600 ms RTT) | ❌ Same as A + TOAST fetch delay | ⚠️ 5–15 s (regional, no zero-egress CDN) | ✅ **<1 s** (Cloudflare Dubai/Riyadh PoP) |
| **Upload architecture — backend binary passthrough?** | ❌ **Mandatory passthrough → OOM** | ❌ **Mandatory double-copy → worst perf** | ⚠️ Possible but not provider-portable | ✅ **100% presigned direct — binary NEVER hits NestJS** |
| **Phase 2 data residency (media inside KSA/UAE)** | ❌ **Days of downtime** (full rsync) | ❌ Worse (PostgreSQL replication weeks) | ⚠️ SDK region change + cross-region copy (1–2 wks) | ✅ **1-day DevOps task** (env vars + CDN country rule) |
| **Provider portability / lock-in** | ❌ Impossible without full copy | ❌ Impossible without BLOB export | ❌ SDK-locked → 1–2 wk rewrite per migration | ✅ **Zero code changes** (S3 API + env vars, 15-min switch) |
| **Lifecycle policies (orphan cleanup, cold tier)** | ❌ Shell cron → bug-prone bloat | ❌ PL/pgSQL DBA scripts (weeks) | ✅ Good but vendor-locked syntax | ✅ **~10 lines config**, auto-enforced, auditable |
| **CDN integration + cache-hit optimization** | ⚠️ Orange-cloud only; origin issues remain | ❌ Each miss = PostgreSQL BLOB read | ⚠️ Works, but no zero-egress R2 | ✅ **Native R2 + Cloudflare** → $0 egress, 90%+ HIT |
| **PostgreSQL OLTP performance** | ⚠️ Neutral (media off-DB) | ❌ **Catastrophic — 5–20× slower after each BLOB read** | ✅ Neutral | ✅ Neutral — media never touches PostgreSQL |
| **Backup + PITR** | ⚠️ Rsync/tar, no media PITR | ❌ Multi-hour `pg_dump`; slow PITR | ✅ Provider snapshots + versioning | ✅ **Bucket versioning + replication** → point-in-time restore |
| **Deterministic derived keying (no dupes)** | ❌ Manual → duplication | ❌ Same as A | ⚠️ Possible via naming convention | ✅ **Built-in** (SHA-256 of master + transform spec) |
| **Delivery time + rework** | ⚠️ Fast start → disk crisis → +weeks | ❌ Fast start → perf collapse → 4-wk crisis | ✅ Good → vendor-lock cost surfaces later | ✅ **Fastest overall** — ~3 days to implement, no rework |
| **CSA/DBA due-diligence standard** | ❌ Below standard for this volume | ❌ **Unanimous anti-pattern** | ⚠️ Acceptable but suboptimal | ✅ **Industry best practice 2020–2026** (Netflix/Spotify/Coursera-class media pipelines) |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Media storage is a rounding-error line item (~$7–10/month)** instead of the #1 infrastructure cost — and it stays cheap as the library and user base grow, because R2 egress is free and the S3 abstraction lets us arbitrage providers.
2. **MENA users get instant audio playback (<1 second start).** The single most impactful UX improvement for the target market; app-store ratings for audio-education apps correlate directly with media start-up time.
3. **Zero app crashes from large uploads.** Presigned URLs eliminate the entire "forgotten 200 MB upload → Node OOM" outage class; backend memory stays flat regardless of upload size/concurrency.
4. **Phase 2 MENA data residency = a 1-day DevOps task** with a ready playbook (new KSA bucket, env vars, `CF-IPCountry` CDN split). No migration project, no downtime.
5. **S3 API standard = immense provider-portability option value.** An R2 outage → cut to B2 in 15 minutes; a future KSA-cloud discount → switch providers with zero engineering. Conservatively worth tens of thousands over 5 years.
6. **PostgreSQL performance is protected** — our most critical component never has its `shared_buffers` evicted by media reads; OLTP latency stays stable by design.
7. **Lifecycle policies eliminate storage waste** — no orphan bloat, no duplicate transcodes; storage cost grows with content, not with accumulated cruft.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **S3 signature + CORS debugging = 2–3 frustrating days during initial implementation.** **Mitigation:** MinIO-testcontainer integration tests exercise the full init→sign→PUT→complete→download round-trip on every CI run; a QA manual checklist for 1 MB / 100 MB / 250 MB uploads before launch; a single centralized `S3Client` provider.
2. **Eventual consistency on overwrite (rare edge case).** **Mitigation:** deterministic keying means a new upload = a new `media_id` (we never overwrite); CDN purge-by-URL on replace; a "new version processing…" spinner for ~30 s.
3. **One more vendor account + credentials to manage/rotate.** **Mitigation:** secrets in Vault (or git-crypt-encrypted `.env` for Phase 1); 90-day key rotation; bucket policy restricts listing to the NestJS + worker IPs; no public bucket listing.
4. **Event-notification cold-start delays.** **Mitigation:** notifications to a BullMQ queue via an SQS-compatible adapter; a 15-minute "orphan unprocessed uploads" cron catches anything missed.

### Neutral / Unknown (risks to monitor)
1. **R2 MENA-region performance pre-launch.** DevOps runs a 1-week benchmark 30 days before launch (Riyadh/Dubai HIT ratio + TTFB). If R2 <85% HIT or TTFB >200 ms → migrate storage to B2 + Cloudflare CDN (15-minute switch).
2. **Multipart part-size tuning** for low-end armeabi-v7a devices with HTTP/2 connection limits.
3. **`rclone` migration rollback plan** — a 48-hour dual-write period with the old bucket retained as fallback.
4. **Cost-anomaly detection** — the ADR-011 cost-estimate log + Uptime Kuma alert at 120% of budget; a Cloudflare WAF rate-limit for crawler egress spikes.

---

## 6. Reversal / Exit Criteria (When to Re-Open This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (S3 API Ecosystem Failure):** Every S3-compatible provider (R2, B2, MinIO, S3, STC Saudi) suffers a structural, non-workaroundable bug breaking our pipeline for >5% of users, with no workaround found within 30 days. Extremely unlikely given 15+ years of S3 API compatibility.
   - **Action:** Full architecture review; likely migrate to GCS/Azure native with a full SDK rewrite, accepting 5–10× cost for restored reliability.

2. **TRIGGER 2 (Cost Explosion — no affordable S3-compatible option):** All S3-compatible providers raise prices simultaneously such that Year-3 storage + egress exceeds the budget line by >200%, AND self-hosted MinIO is also infeasible (bandwidth caps).
   - **Action:** Evaluate hybrid local-cache / infrequent-access models. New ADR required.

3. **TRIGGER 3 (Regulatory Mandate for On-Prem Non-S3 Storage):** A GCC regulator mandates on-premises non-cloud storage at a certified data center that does not support S3-compatible appliances (unlikely — StorageGRID, Dell EMC ECS, Scality are all S3-compatible).
   - **Action:** Add a `LocalFsStorageService` behind the existing `IStorageService` interface; presigned URLs become local signed tokens + Nginx `auth_request`. ~2-week project.

4. **TRIGGER 4 (Media DRM Mandate — S3 Unsuitable):** Phase 3 introduces strict Widevine/FairPlay DRM where per-session key rotation needs a custom streaming origin and S3 byte-range latency exceeds the license deadline.
   - **Action:** Evaluate self-hosted MinIO with an NVMe tier + a DRM streaming origin, or a MediaConvert/Packager pair with an S3 origin. A new DRM ADR supersedes the relevant portions here.

We **explicitly do NOT revisit** this decision:
- Because a new DevOps hire "likes GCS better".
- Because of a single Cloudflare/R2 outage <4 hours (covered by the B2 fallback playbook).
- Because of signature/CORS bugs during initial implementation (normal, not architectural).
- Before 12 months of production cost + performance metrics, and without CSA + DevOps Lead + Cost-Owner co-signatures.

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §6 Phase 1 Deployment (Hostinger VPS), §12 Media Content Requirements, §14 Data Residency GCC/MENA, §15 Cost-Center Budget
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §8 Media Pipeline & Processing Architecture, §9 Offline-First (mobile download flows), §11 Data Residency & Privacy
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §11 Cost Management & Budget Alerting, §13 Architectural Compliance (storage lint rule)
- [ADR-001 Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md)
- [ADR-005 Primary DB: PostgreSQL 16](ADR-005-primary-database-postgresql-16.md) — PostgreSQL stores ONLY media metadata, never BLOBs (this ADR forbids the BLOB anti-pattern).
- [ADR-007 IaC: Docker Compose](ADR-007-iac-phase-1-docker-compose-shell-scripts.md) — local-dev MinIO container + production bucket lifecycle config.
- [ADR-011 Observability — Lightweight Monitoring](ADR-011-observability-lightweight-monitoring.md) — cost + HIT-ratio alerts via structured JSON logs + Uptime Kuma (no Prometheus/Grafana in Phase 1).
- [ADR-012 Mobile Local Storage: Isar DB](ADR-012-mobile-local-storage-isar-db.md) — Isar stores metadata; actual media binaries downloaded per this ADR's CDN flow.
- External: AWS SDK v3 `S3Client` — docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/client/s3/
- External: Cloudflare R2 Pricing + Zero-Egress (2026) — cloudflare.com/products/r2
- External: Backblaze B2 S3-Compatible API — backblaze.com/b2/docs/s3_compatible_api.html
- External: MinIO Official Docs — min.io/docs/minio/linux/index.html
- External: rclone "S3 to S3 Server-Side Copy" — rclone.org/s3/#server-side-copy
- External: PostgreSQL Wiki — "Binary Files in the Database: Don't"
- External: KSA PDPL Article 12 + Implementing Regulation Article 9 — cross-border data-transfer restrictions
- External: 2025 MENA CDN Latency Benchmark (Cloudflare vs CloudFront vs Akamai) — Riyadh/Dubai RTT data

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Sent for DevOps Lead + Media Lead + Sponsor (cost owner) + Legal review.
- 2026-08-09: ACCEPTED (revised) — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; capacity/egress right-sized to the 1,000–5,000-user Phase-1 scale (~0.5 TB first-year library, ~1–2 TB/month egress) with a documented rewrite-free path to tens of TB; upload roles Instructor → **Editor/author**; monitoring aligned to ADR-011 **lightweight** stack (Uptime Kuma + structured JSON logs, no Prometheus/Grafana); ADR-011 reference updated to the lightweight-monitoring file; relative doc links; active storage provider treated as an env-configurable placeholder, never hardcoded.
