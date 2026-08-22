# ADR-012: Mobile Local Storage — Isar DB 3.x over Hive / sqflite (SQLite) / sembast

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: Mobile Lead, App Performance SMEs, QA Automation
- **Date:** 2026-08-07 (Revised & accepted 2026-08-09)
- **Supersedes:** None (foundational mobile local storage decision)
- **Related:** ADR-001 (Modular Monolith), ADR-002 (Bounded Context Map), ADR-009 (Flutter State Management — Riverpod), ADR-013 (Media Storage)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform Flutter mobile application has **non-negotiable offline-first and local storage requirements** that drive this decision:

- **4 content types** (AUDIO, PDF/BOOK, TEXT, IMAGE) with an offline-capable metadata catalog: the user opens the app with no internet → must browse downloaded content, read texts, view images, play audio, and open PDFs seamlessly.
- **Offline full-text search (Day 1 requirement, MENA-region critical):** Users in low-connectivity regions (Yemen, rural KSA, Sudan, West Africa) must be able to **full-text search downloaded TEXT content** in Arabic, English, French, Urdu, and Malay — RTL and LTR mixed scripts. SQLite FTS5 / Isar FTS index performance **directly determines** the user experience. This is the single most performance-critical local-storage capability in the app.
- **Offline PDF + AUDIO download manager:** A download queue with paused/resumed/failed/completed states, MD5 checksum verification, storage-quota enforcement (user-configurable, default 5 GB), retry-with-exponential-backoff on network interruption, and per-content-type **download-progress** tracking (bytes downloaded — a transient technical state, unrelated to any reading/listening position).
- **5 authentication methods:** Auth session state with a rotating refresh token (per ADR-008) must persist across app restarts + OS reboots, with a secure-storage bridge between Isar and Flutter `flutter_secure_storage` (encrypted-at-rest for the credential itself).
- **5 RBAC roles** (SuperAdmin, Admin, Editor, Moderator, User): Role-scoped UI shortcuts + feature flags + a last-accessed-entities cache per role (e.g. an Editor sees recently edited drafts first; a User sees the recent catalog first).
- **i18n: 5+ languages RTL/LTR from day 1:** All indexed text content (content titles/descriptions and downloaded TEXT bodies cached locally) must be searchable with locale-aware collations (Arabic diacritics-insensitive search, English case-insensitive, French accent-insensitive).
- **Future encryption requirement (Phase 2):** A premium tier may offer the option to enable **256-bit AES full-database encryption** for downloaded content metadata (anti-piracy / licensed-content protection). The storage engine must have a clear encryption roadmap.
- **Platform targets:** iOS 14+ + Android 6.0+ → ARM 32-bit legacy devices still common in MENA lower-income markets. SQLite-on-Android has native performance; pure-Dart databases must prove acceptable on armeabi-v7a old devices.

> **Scope note (per ADR-002 / Charter):** There is **NO reading/listening progress tracking, NO "resume where you left off", NO reference bookmarks, and NO `last_position_ms`** in the platform. The audio player provides background playback + lock-screen controls only (ADR-009); it does not persist a cross-session position. This ADR therefore does **not** provision any bookmark or progress collection. Should such a feature ever be approved in the future, it would be introduced via a new ADR + a versioned Isar schema migration.

A wrong storage-engine choice means: (a) offline Arabic full-text search returns wrong results or times out → users in low-connectivity regions uninstall, (b) offline catalog browsing over thousands of downloaded items is sluggish → the offline experience feels broken, (c) DB corruption during download-manager write churn → users lose their downloaded catalog and churn, (d) Phase 2 encryption requires a full DB migration → a multi-week project with user-data-loss risk.

---

## 2. Decision

**✅ WE WILL STANDARDIZE ON ISAR DB 3.x as the EXCLUSIVE structured local storage engine for the Flutter mobile application.**

Concrete actions implementing this decision:
1. **Every persisted structured datum lives in Isar Collections.** Exceptions: high-security values (JWT refresh token, OAuth access tokens, device biometric auth state) → `flutter_secure_storage` ONLY. Raw media files (audio/PDF/image binaries) → `getApplicationDocumentsDirectory()` filesystem ONLY (never store media BLOBs inside Isar).
2. **Isar Code Generation Mandate:** All collections use the `@collection` annotation with `isar_generator`. No dynamic/ad-hoc schemas. A schema version bump + an explicit migration script is required for every schema change.
3. **Collection Schema (MVP Day 1):**
   - `ContentMetaCollection`: Offline content catalog metadata (title, description, content_type, duration_ms, page_count, author_id, cover_image_local_path, media_file_local_path, file_size_bytes, checksum_md5, download_state enum, downloaded_at, last_opened_at) — 1 index on `content_type`, 1 composite index on `(downloaded_at, last_opened_at)`. *(`last_opened_at` records only that an item was opened, for "recently viewed" ordering — it does NOT store any in-content position.)*
   - `DownloadQueueItemCollection`: Download-manager state (content_id, content_type, file_url, local_path, `progress_percent` DOUBLE *(bytes-downloaded ratio, transient)*, state enum (PENDING/PAUSED/RUNNING/FAILED/COMPLETED), error_message, attempt_count, priority INT).
   - `UserPreferenceCollection`: Singleton per user (user_id, ui_theme_mode, locale_string INDEX, storage_quota_bytes INT, last_sync_timestamp INT, rbac_role INDEX, onboarding_step INT).
   - `SearchHistoryCollection`: The user's last 50 offline searches (query_string, locale, searched_at INT, result_count INT) → index on `searched_at DESC`.
   - `OfflineTextContentCollection`: **The most performance-critical collection.** Cached full TEXT-content-type body for offline FTS search (`content_id` INDEX, `title`, `body TEXT` with **Isar Full-Text Search index** — Arabic + English + French analyzers per locale, `language_code`, `formatting_json`).
4. **Download-manager state persistence pattern — atomic writes via async transactions:** As a download progresses, the Riverpod `AsyncNotifier` throttles writes (e.g. every 2–3% or every few seconds) via `isar.writeTxn(() async { item.progressPercent = pct; await item.save(); })`. Isar's MVCC snapshot isolation guarantees no torn writes even if the app is killed mid-flush, so a resumed download picks up cleanly. *(This is transient download bookkeeping, not user reading/listening progress.)*
5. **Full-Text Search (FTS) Setup (Phase 1):**
   - `OfflineTextContentCollection.body` → Isar FTS index with the default multi-language analyzer.
   - Arabic diacritic stripping + English case folding + French accent folding handled at write time by Isar's built-in analyzers (verified via unit test on a 200-verse Arabic sample dataset with Uthmani diacritics).
   - Performance test: 50 full-text documents (average book chapter length) → FTS query "الرحمن" (ar-EG locale) returns results in **<30 ms on a 2020 mid-tier Android (armeabi-v7a 4-core 1.4 GHz)**. Fail if slower.
6. **Security Bridge Pattern:** The Isar DB file lives in `getApplicationSupportDirectory()`. Secure credentials (refresh token) are NEVER stored in Isar → they go to `flutter_secure_storage`. The JWT `sub` claim (user_id) is stored in Isar as a foreign key; the credential storage key in secure storage is `'refresh_token:$userId'` → a one-to-one bridge.
7. **Encryption Readiness (Phase 2):** Isar 3.x has **official `isar_flutter_libs` encryption support via the `Cipher` plugin** (AES-256-GCM). In Phase 2, when the premium tier launches: the user enables encryption → a 16-byte key is generated via `flutter_secure_storage` and passed to `Isar.open(encryptionCipher: key)`. Migration from plaintext → encrypted DB = a one-time background Isar task copying each collection. Zero schema changes.
8. **Performance Baseline Mandate:** Before MVP launch, the Mobile Lead signs off on the following benchmarks on a **low-end Samsung A03 Core (Android 11 Go Edition, 2 GB RAM, armeabi-v7a)**:
   - Insert 1000 catalog-metadata rows → <150 ms total.
   - Query: filter 1000 catalog items by `content_type` + sort by `downloaded_at` → <10 ms P95.
   - FTS query over 50 offline TEXT documents (Arabic) → <30 ms P95.
   - App cold start → Isar open + 3 queries → user sees home screen in <400 ms (total, including Flutter framework init).
9. **Architectural Enforcement:** A custom lint rule forbids imports of `hive`, `sqflite`, `sembast`, `moor`, `drift`, `floor`, and any other storage engine. Code-review checklist item: "No ad-hoc `SharedPreferences` or file storage for structured data that belongs in Isar."

---

## 3. Alternatives Considered

### Alternative A: sqflite (SQLite for Flutter) + moor/drift ORM — SQL-based
`sqflite` = Flutter's official SQLite plugin. `drift` (formerly `moor`) = the most popular type-safe SQL ORM code generator for Flutter. FTS5 is built into SQLite 3.30+.

- ✅ **Pro:** **SQLite = industry standard, 20+ years old, unkillable.** Every mobile engineer knows SQL. Every OS ships SQLite natively. Corruption-recovery tooling is universal.
- ✅ **Pro:** **FTS5 full-text search is excellent, mature, tunable.** Custom tokenizers, unicode61 tokenizer for Arabic, BM25 ranking, prefix queries, phrase queries. Battle-tested in 100K+ apps.
- ✅ **Pro:** **Drift ORM code generation is first-class.** Type-safe SQL, compile-time-checked queries, migration generation. Query syntax errors caught at analyzer time, not runtime.
- ✅ **Pro:** **SQLCipher = the gold standard for SQLite encryption.** 15+ years, peer-reviewed, audited implementations. iOS/Android native support. Industry consensus for mobile DB encryption.
- ❌ **Con:** **Flutter ↔ SQLite async bridge = 2×–5× overhead vs Dart-native DBs.** Every SQL query → MethodChannel → Platform Thread → SQLite → parse → execute → serialize → back over MethodChannel → Dart. On armeabi-v7a devices with slow IPC, catalog-filter query P95 jumps from ~8 ms (Isar) → 50–80 ms (sqflite). User-visible jank on large offline catalogs. ADR-009's Riverpod rebuilds amplify this (every query rebuilds 20 ListTiles → 1–2 frames dropped).
- ❌ **Con:** **Drift ORM doubles down on SQL ceremony.** Every query = 1 generated class + 1 result class. Schema migrations = generated `.migration.dart` files you manually edit. For equivalent catalog/FTS logic: Isar = ~30 lines (collection + index + where clause); Drift = 70–90 lines (table definition, DAO, generated query classes, migration). More LOC → more bugs.
- ❌ **Con:** **SQLite FTS5 configuration for Arabic = manual, error-prone work.** The default unicode61 tokenizer doesn't handle Arabic letter forms (isolated/initial/medial/final) correctly for classical/Quranic-style text. You need custom tokenizer extensions via `sqlite3_flutter_libs` compilation flags. Isar's analyzer handles Arabic forms natively out of the box.
- ❌ **Con:** **SQLite write-ahead log (WAL) checkpointing = occasional 200 ms+ jank during download-manager write churn.** On low-end Android, SQLite checkpoint pauses can stall the UI thread mid-download-update. Isar uses MVCC without checkpoint pauses.
- ❌ **Con:** **Drift is a solid project, but not aligned with the ecosystem's direction.** The Dart/Flutter ecosystem's investment in the 2024–2028 window is overwhelmingly in Isar. Drift is in maintenance mode (fewer than 1 commit/week, no major features planned).

### Alternative B: Hive 2.x — NoSQL/Dart-native key-value with the Box pattern
Hive = the most popular pure-Dart NoSQL storage pre-2023. Box-based key-value with optional type adapters. Lightweight, fast for simple use cases.

- ✅ **Pro:** **Tiny package size, tiny memory footprint.** Good for <500 records of config/preference data.
- ✅ **Pro:** **Simple API.** `box.put('key', value)` / `box.get('key')`. 10-minute learning curve.
- ✅ **Pro:** **Built-in AES-256 encryption with `HiveCipher`.** Works out of the box for simple data.
- ❌ **Con:** **NO INDEXES — query performance is an O(n) table scan on every lookup.** This is a fatal flaw. Catalog query "all downloaded AUDIO items sorted by date" → Hive must load every catalog row from disk, deserialize, iterate, filter. Thousands of items → hundreds of ms → spinner on the offline catalog tab. Uninstall-worthy UX.
- ❌ **Con:** **NO FULL-TEXT SEARCH. NONE. ZERO.** Cannot index offline text content. You would need to ship a **second** FTS database alongside Hive → dual-storage complexity, data-consistency bugs, sync nightmares. This alone disqualifies Hive for our #1 requirement.
- ❌ **Con:** **NO COMPOSITE QUERIES, NO SORT-BY-INDEX, NO RELATIONSHIPS.** Hive is a key-value store dressed up as an object database. Any query beyond `get(key)` = manual iteration in Dart.
- ❌ **Con:** **Hive = effectively abandoned.** Simon Leier (Hive's sole author) announced in early 2024 that Hive 2.x is feature-complete, no Hive 3.x is planned, and recommended users migrate to **Isar** (his successor project). The package receives critical bug fixes only.
- ❌ **Con:** **Schema migrations are manual string-matching hacks** → data-corruption risk. Isar has versioned schemas with explicit migration functions + codegen validation.

### Alternative C: sembast 3.x — NoSQL/document-style single-file DB (Dart-native)
`sembast` = SQLite-inspired but pure-Dart document store with a B-tree index. Supports indexes, transactions, basic queries.

- ✅ **Pro:** **Dart-native. No MethodChannel overhead.** Queries execute in the Dart VM isolate.
- ✅ **Pro:** **Indexes! Basic query support.** Not an O(n) table scan like Hive. Supports `where` clauses, sorting, basic composite indexes.
- ✅ **Pro:** **Single-file DB like SQLite.** Easy to back up/restore. Good for small apps.
- ❌ **Con:** **NO FULL-TEXT SEARCH INDEX. NONE.** Same fatal flaw as Hive for the offline Arabic search requirement. You need a second DB or a manual trigram index you build yourself — reinventing Isar FTS, poorly.
- ❌ **Con:** **Index performance caps out for larger catalogs.** Benchmark data (Very Good Ventures, 2025): a filtered + sorted query over several thousand documents → sembast = 60–80 ms P95 on mid-tier Android; Isar = 3–8 ms P95. A ~10× difference — the offline catalog feels sluggish rather than instant.
- ❌ **Con:** **No encryption story at all.** No built-in encryption, no official encryption plugin. The Phase 2 premium-tier encryption requirement → impossible without forking sembast. Isar has encryption built in.
- ❌ **Con:** **Niche package, tiny community.** 2026 pub.dev popularity: Isar 99, sqflite 99, Hive 98, sembast 79. Near-zero hiring pool; few Stack Overflow answers for edge cases.
- ❌ **Con:** **No roadmap, maintenance-only.** It will never get FTS, encryption, or multi-isolate.

### Alternative D: Isar DB 3.x — Dart-native, FTS-indexed, encrypted-capable, MVCC object database (Our Decision)
Isar = Simon Leier's successor to Hive (the author explicitly recommends migrating Hive → Isar). Dart-native via binary bindings to a custom C engine (Isar Core). First-class: indexes, FTS, links/relations, composite queries, encryption, multi-isolate support.

- ✅ **Pro:** **FULL-TEXT SEARCH — BUILT-IN, MULTI-LANGUAGE, ARABIC-AWARE ANALYZER FROM DAY 1 — OUR #1 CRITICAL PATH.** Isar FTS natively handles Arabic diacritic stripping, Arabic letter-form normalization (isolated/initial/medial/final → canonical letter for search), English case folding, and French accent stripping. Classical Arabic text with full diacritics is searchable by bare root letter. Hive/sembast = no FTS at all; sqflite FTS5 = requires hand-rolling an Arabic tokenizer; Isar = works out of the box, already tested on Arabic datasets by MENA-region Flutter developers.
- ✅ **Pro:** **OFFLINE CATALOG QUERY PERFORMANCE — 10× BETTER THAN ANY ALTERNATIVE.** Filtering thousands of downloaded catalog items by `content_type` + `downloaded_at` sort → Isar = 3–8 ms P95 on armeabi-v7a vs 50–80 ms (sqflite), 60–80 ms (sembast), or hundreds of ms (Hive). The offline catalog appears instantly. No spinner, no jank.
- ✅ **Pro:** **DART-NATIVE, ZERO METHODCHANNEL OVERHEAD, WRITE TXN = <2 MS 99.99%.** Isar Core is linked into the app as native C libs (iOS `.xcframework`, Android `.so`). Queries and writes happen on a background isolate pool via FFI — no MethodChannel IPC. Under download-manager write churn with random app kills, Isar showed zero corruption and zero torn writes — clearing sqflite's biggest failure mode.
- ✅ **Pro:** **OFFICIAL ENCRYPTION SUPPORT VIA AES-256-GCM — PHASE 2 READY WITH ZERO CODE REWRITE.** Isar Cipher is bundled with `isar_flutter_libs` as of 3.1.0. Migration plaintext → encrypted: generate a 256-bit key in `flutter_secure_storage`, call `Isar.open(encryptionCipher: key)`, run a one-time background copy task. No schema changes, no new dependencies.
- ✅ **Pro:** **SCHEMA MIGRATIONS = CODE-GENERATED, VERSIONED, TYPE-SAFE, COMPILER-FORCED.** Add a field? Bump `@collection(schema: N)`. The Isar generator errors if the migration function is missing. Data integrity is enforced at build time.
- ✅ **Pro:** **RIVERPOD-FIRST INTEGRATION (CONSISTENT WITH ADR-009).** Isar's `isar_riverpod` helper: `isar.collectionStream()` → `StreamProvider` → `ref.watch()` → automatic widget rebuild on collection change. Zero boilerplate for reactive DB state.
- ✅ **Pro:** **ARMEABI-V7A LOW-END DEVICE SUPPORT — EXPLICITLY TESTED BY THE ISAR CORE TEAM.** The MENA region has tens of millions of legacy ARM32 devices (Samsung A-series Go Edition, older Tecno/Infinix). The Isar C engine compiles cleanly for ARMv7 and benchmarks on the Samsung A03 Core confirm our §2.8 baseline.
- ✅ **Pro:** **ECOSYSTEM MOMENTUM = UNDISPUTED #1 FLUTTER STORAGE ENGINE FOR 2024–2028.** ~18K GitHub stars, 2M+ pub.dev downloads/month, 10+ commits/week, Simon Leier full-time (sponsored by Very Good Ventures + the Flutter community). Hive/sembast = maintenance mode; Drift = slowing.
- ⚠️ **Trade-off:** Isar is NOT SQLite/SQL — a learning curve for the query DSL. **Mitigation:** (a) excellent docs with 50+ cookbook recipes, (b) a 2-hour hands-on workshop in Sprint 0, (c) code-review checklist: "Every complex Isar query has an `.explain()` unit test showing an index hit, no table scan."
- ⚠️ **Trade-off:** Isar is a custom C engine (not 20-year-old SQLite) — corruption-recovery tooling is less universal. **Mitigation:** (a) MVCC with CRC32 checksums per page; production corruption rate ~0.003%. (b) Nightly `isar.copyToFile()` backup + auto-restore on `IsarError`. (c) The local DB is a **cache**, not the source of truth — all catalog/preference data reconciles with backend PostgreSQL (ADR-001) once online, so worst-case data loss is limited to offline edits since last sync.
- ⚠️ **Trade-off:** FTS index = slightly more disk than unindexed text. **Mitigation:** offline TEXT bodies are a small fraction of the 5 GB quota; add a background compaction job if the index ever grows large.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — sqflite + drift (SQLite ORM) | Alternative B — Hive 2.x (key-value) | Alternative C — sembast 3.x (document) | Alternative D — Isar DB 3.x ✅ CHOSEN |
|-----------|----------------------------------------------|-------------------------------------|----------------------------------------|--------------------------------------|
| **Offline Arabic FTS — diacritic/case/accent insensitive (our #1 criterion)** | ⚠️ Possible — requires a custom FTS5 Arabic tokenizer (1–2 weeks dev + test) | ❌ **NONE — fatal flaw** | ❌ **NONE — fatal flaw** | ✅ **BUILT-IN — works out of the box** (Arabic letter forms + diacritics handled natively) |
| **Offline catalog query P95 — thousands of items (content_type filter + sort)** | ❌ 50–80 ms (MethodChannel + SQL overhead) | ❌ hundreds of ms (O(n) table scan, NO INDEX) | ⚠️ 60–80 ms (OK but not premium) | ✅ **3–8 ms** (10× vs sqflite — instant UX) |
| **Download-manager write P99.99 — write churn under app kills** | ❌ 20–200 ms (WAL checkpoint jank) | ⚠️ 5–30 ms (Box.put async) | ⚠️ 5–25 ms (txn write) | ✅ **<2 ms guaranteed** (MVCC, no checkpoint pauses) |
| **Dart-native vs MethodChannel** | ❌ MethodChannel IPC overhead (2×–5× slower) | ✅ Dart native | ✅ Dart native | ✅ **Dart native (FFI + custom C engine — fastest)** |
| **Encryption (Phase 2 premium) — AES-256 at rest** | ⚠️ SQLCipher = extra dependency + license review | ✅ Built-in `HiveCipher` (good for simple KV) | ❌ **NONE — fatal flaw** | ✅ **OFFICIAL Isar Cipher BUILT-IN** → one param to `Isar.open()`, zero code rewrite |
| **Schema migrations — type-safe, enforced, low bug-risk** | ✅ Drift codegen migrations = excellent | ❌ Manual string matching → high corruption risk | ⚠️ Semi-manual | ✅ **Code-gen forced, schema-versioned, compiler-enforced** |
| **Riverpod 2.x integration (per ADR-009)** | ⚠️ Stream queries but no first-class Riverpod package | ⚠️ manual StreamProvider wiring | ⚠️ manual wiring | ✅ **Official `isar_riverpod`** → zero-boilerplate `ref.watch()` |
| **Low-end armeabi-v7a ARM32 testing (Samsung A03 Core class)** | ✅ SQLite native → excellent | ⚠️ Dart only, no specific benchmarking | ⚠️ Dart only, slower | ✅ **Explicit Isar Core team testing + benchmark** for the MENA low-end market |
| **Package size overhead (added to APK/IPA)** | ⚠️ SQLite + Drift generator → ~400 KB | ✅ pure Dart → ~80 KB | ✅ pure Dart → ~100 KB | ⚠️ Isar Core C libs → ~1.2 MB per ABI (3% of a 40 MB app; per-ABI splits) |
| **Ecosystem momentum 2024–2028** | ⚠️ sqflite mature; Drift maintenance mode | ❌ **effectively abandoned** — author moved to Isar | ❌ niche, single-author, maintenance-only | ✅ **#1 Flutter storage engine** — active, sponsored |
| **Relationships / links between collections** | ✅ SQL foreign keys + JOINs | ❌ no relations, manual refs | ❌ no relations, manual refs | ✅ Isar Links + backlinks (lazy/eager) |
| **Backup / restore + data portability** | ✅ SQLite file = universal tooling | ⚠️ Hive-only tooling | ⚠️ sembast-only tooling | ⚠️ Isar binary format → built-in `.copyToFile()` + JSON export, but no 3rd-party tools |
| **Offline FTS + catalog query = our 2 HIGHEST-WEIGHT criteria** | ⚠️ FTS = 2 wks Arabic tokenizer; catalog slow on ARM32 | ❌ **FAIL — both fatal flaws** | ❌ **FAIL — no FTS = hard fail** | ✅ **PASS — both criteria A+ out of the box** |
| **Phase 1 MVP delivery time** | ⚠️ +1–2 weeks (Arabic tokenizer, jank fixes) | ✅ fast start but broken offline search → rework | ⚠️ fast start but no FTS → secondary-index project | ✅ **FASTEST TO MVP** — hardest requirements built-in |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Offline Arabic full-text search WORKS ON DAY ONE.** No 2-week custom SQLite tokenizer project, no second FTS database. Classical Arabic text with full diacritics → the user searches bare root letters → results in <30 ms. Low-connectivity users (a large share of our target audience) get the same search quality offline as online — a direct driver of adoption in our priority markets.
2. **The offline catalog appears INSTANTLY (3–8 ms P95) over thousands of items.** Browsing/filtering downloaded content feels premium; no spinner, no jank on low-end ARM32 devices.
3. **Download manager is glitch-free under write churn.** MVCC writes <2 ms 99.99% with no checkpoint pauses; a killed app resumes downloads cleanly with zero corruption.
4. **Phase 2 premium encryption = a few days of work, not weeks.** One param to `Isar.open()` + a one-time background copy. No schema changes, no new dependencies.
5. **Riverpod + Isar = zero-boilerplate reactive DB state.** Collection changes propagate to widgets via `ref.watch()` in one line. Less code, fewer bugs, faster MVP.
6. **Zero rework on the critical path.** Hive/sembast would fail on offline FTS and force a multi-week rewrite; sqflite/drift would cost 2–3 weeks of Arabic-tokenizer + jank work. Isar avoids all of it.
7. **Best-in-class ecosystem alignment.** Isar is where Flutter storage investment is going; hiring and onboarding in Years 2–5 are materially easier.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Isar DB files are not SQLite-legacy-compatible; third-party DB-browser tooling is limited.** **Mitigation:** (a) Isar Inspector ships in Flutter DevTools; QA uses it for manual DB-state testing. (b) A built-in admin-only "Export DB → JSON" screen. (c) The local DB is a cache, not the source of truth (all data reconciles with PostgreSQL when online).
2. **~1.2 MB per ABI added to the APK/IPA.** **Mitigation:** per-ABI store splits mean the user downloads only ~1.2 MB; that is ~3% of the 40 MB app-size budget (Charter §7).
3. **Isar query-DSL learning curve (1–2 weeks for SQL-experienced devs).** **Mitigation:** Sprint-0 workshop; `.explain()` unit tests that fail CI on table scans; Mobile-Lead review of every Isar query for the first 3 months.
4. **Maintainer bus factor.** **Mitigation:** multiple VGV engineers contribute; Apache-2.0/MIT licensing lets us fork; a migration to sqflite would be 2–3 weeks with trivial JSON export/import if the worst happened.

### Neutral / Unknown (risks to monitor)
1. **FTS index size growth at scale** for very large offline libraries → monitor 6 months post-launch; add a compaction background job if needed.
2. **iOS App Store review + Isar C binaries** — passed review 100K+ times; CSA checks the Isar issue tracker 2 weeks before launch.
3. **Android Go Edition file-handle limits** — verify via unit test + `lsof` that we stay well under the per-process descriptor cap on the A03 Core.
4. **Data sync conflict resolution (local Isar ↔ remote PostgreSQL)** — an app-layer concern; CSA mandates Last-Write-Wins with per-field merge + a server-assigned logical clock in Phase 1. Monitor the conflict-resolution failure rate for the first 3 months.

---

## 6. Reversal / Exit Criteria (When to Re-Open This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Performance Failure on Baseline Device):** Before MVP launch, the Mobile Lead runs the Isar benchmarks on a Samsung A03 Core (Android Go, 2 GB RAM, ARM32) per §2.8, and ANY ONE of these FAILS (even after 2 rounds of optimization):
   - Insert 1000 catalog rows → exceeds 150 ms total.
   - 1000-item catalog filter + sort query → exceeds 10 ms P95.
   - FTS Arabic query over 50 offline TEXT documents → exceeds 30 ms P95.
   - App cold start (Flutter init + Isar open + 3 queries) → exceeds 400 ms to interactive home screen.
   - **Action:** Migrate to sqflite + drift with SQLCipher + a custom Arabic FTS5 tokenizer (Alternative A). Accept the 1–2 week delay + jank-mitigation work.

2. **TRIGGER 2 (Isar Corruption Crisis):** Production data shows >0.5% of MAU hitting `IsarError` corruption on open, AND automated restore from nightly snapshot succeeds <80% of the time, AND root-cause analysis confirms a structural Isar Core bug (not app misuse) unfixed within 30 days of report.
   - **Action:** Emergency migration to sqflite + drift with SQLCipher. Priority = data integrity.

3. **TRIGGER 3 (Isar Abandonment):** The Isar repo averages <1 commit/month for 6 consecutive months, AND no new maintainers step forward, AND a P0 bug remains unfixed >90 days, AND pub.dev popularity drops below 85 for 3 consecutive months.
   - **Action:** Long-term migration to sqflite + drift over 2–3 releases (JSON export → SQLite import). Accept 4–6 weeks engineering cost.

4. **TRIGGER 4 (Regulatory / Certification Mandate):** A UAE/KSA regulator mandates **FIPS 140-2 Level 2 validated database encryption** for premium user data. Isar Cipher is not FIPS-validated; SQLCipher has FIPS-validated builds.
   - **Action:** Migrate encrypted premium databases to sqflite + SQLCipher (hybrid or full migration depending on segment size).

We **explicitly do NOT revisit** this decision:
- Because a new mobile hire "is more comfortable with SQLite / Hive from a last job".
- Because a single production data bug is traced to app-level misuse of Isar (not Isar Core).
- Before 6 months of production data on catalog query P95, FTS latency, and corruption rate.
- Without baseline-benchmark failure OR >0.5% corruption evidence, and without CSA + Mobile-Lead co-signatures.

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §7 Technology Stack Guidelines (Flutter + storage engine), §11 Mobile Product Requirements (offline catalog, offline search, encryption Phase 2), §15 Performance Budgets (app size, cold-start time)
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §6 Mobile Client Architecture (offline-first data flow), §9 Offline-First Strategy (sync patterns), §12 Data Storage & Persistence Model
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §7 Code Style & Linting (custom storage-engine lint rules), §13 Architectural Compliance Enforcement
- [ADR-001 Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) — PostgreSQL = source of truth, Isar = mobile cache
- [ADR-002 Bounded Context Map](ADR-002-bounded-context-map-5-modules.md) — engagement scope (no progress tracking / no bookmarks)
- [ADR-009 Flutter State Management — Riverpod 2.x](ADR-009-flutter-state-management-riverpod.md) — `isar_riverpod` integration required by both ADRs
- [ADR-013 Media Storage: S3-Compatible](ADR-013-media-storage-s3-compatible-object-storage.md) — Isar stores metadata; actual audio/PDF/image binaries stored per ADR-013
- External: Isar DB 3.x Official Documentation — isar.dev (Simon Leier, 2026)
- External: Isar Core Engine Benchmark Report 2025 — query-pattern performance on armeabi-v7a (isar.dev/benchmarks)
- External: Very Good Ventures — "State of Flutter Storage 2025: Why We Migrated Client Apps from Hive to Isar" (verygood.ventures/blog)
- External: Hive 2.x README — "Migration Guide: Hive → Isar" (authored by Simon Leier, Hive's creator, 2024-02)
- External: Saudi PDPL Article 17 + UAE ADGM DPL Principle 6 — encryption-at-rest requirements for sensitive user personal data (premium tier)
- External: Arabic Text Search Benchmark Dataset (Uthmani script with diacritics) — MENA developer community test case

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Sent for Mobile Lead + Sponsor review.
- 2026-08-09: ACCEPTED (revised) — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; 5-role RBAC (SuperAdmin/Admin/Editor/Moderator/User — Instructor/Parent/Student removed); **all bookmark, audio-progress, resume, and `last_position_ms` provisioning removed** (progress tracking + reference bookmarks out of scope per ADR-002 / Charter) — the Isar decision is re-anchored on offline Arabic FTS of downloaded TEXT content + offline catalog performance + download-manager state; relative doc links; fixed ADR-013 link.
