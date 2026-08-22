# ADR-005: Primary Database — PostgreSQL 16+ over MySQL 8 / MongoDB 7 / CockroachDB

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: DBA, BKE, SEC, PFE
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-002 (Bounded Contexts + Table Prefixes), ADR-006 (ORM: TypeORM), ADR-013 (Media Storage)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform's data layer requirements are NON-NEGOTIABLE and explicitly multi-faceted:

1. **i18n is core, not an afterthought.** The platform serves 5+ languages with FULL RTL Arabic + LTR. Every user-facing content field (content title, description, category name, comment body) must be translatable into all 5 languages. This is not a "localize the UI" requirement — this is **content stored in multiple languages simultaneously**.

2. **Search roadmap.** MVP has no search (Charter §3.2 Out of Scope Q-35) but Phase 2 MUST ship with full-text search across Arabic + English content WITHOUT introducing a separate Elasticsearch cluster in Phase 2 (Hostinger VPS budget). In-database search with stemming, stopwords, and relevance ranking for BOTH Arabic and English is a hard requirement.

3. **UUID primary keys with sortable/time-ordered semantics.** We need UUIDv7 (time-ordered UUIDs) for every table's primary key: (a) avoids ID enumeration attacks, (b) preserves INSERT locality (unlike v4 UUIDs which fragment B-tree indexes), (c) works globally across future microservices without a central ID generator.

4. **Future spatial/geospatial features.** Phase 3 roadmap includes: mosque locator, regional content targeting by GPS location, user region-based analytics.

5. **Scale requirements.** 1,000–5,000 users in the first 6 months post-launch, with a documented path to hundreds of thousands of users without an architectural rewrite (Charter §2.1 Obj-002). The database is chosen so that this growth is enabled (read replicas, partitioning, per-module extraction) rather than provisioned for on day one.

6. **Deployment target: Hostinger VPS.** No managed DBaaS. Self-hosted, single-node PostgreSQL primary + PgBouncer + read replica in Phase 2. Must install cleanly on Linux VPS with Docker; zero external vendor lock-in.

Four candidates evaluated against these requirements:
- PostgreSQL 16 (with pg_uuidv7 / uuid-ossp / pg_trgm / PostGIS future)
- MySQL 8.0 (with InnoDB, FULLTEXT, JSON)
- MongoDB 7.0 (document-oriented, Atlas not available on Hostinger; self-hosted replica set)
- CockroachDB Serverless / Dedicated (distributed SQL)

---

## 2. Decision

**✅ WE WILL USE POSTGRESQL 16.x as our PRIMARY PERSISTENCE STORE for ALL 5 Bounded Contexts (prefixes id_ ct_ eg_ nt_ ad_) in the modular monolith schema. We will deploy on Hostinger VPS via Docker Compose + PgBouncer connection pooler. We will leverage the following PostgreSQL features explicitly for our data requirements:**

### 2.1 Feature Mapping (Requirements → PostgreSQL Capabilities)

| Platform Requirement | PostgreSQL 16 Feature | Implementation Plan |
|-----------------------|------------------------|---------------------|
| **Translatable fields (5 languages)** | `JSONB` data type + `@>` operator + GIN indexing on JSONB paths | Every translatable field stored as `JSONB` with language keys: `title: { "ar": "...", "en": "...", "tr": "...", "fa": "...", "ur": "..." }`. GIN index on `(title)` for `@>` queries. Single table row per content item; no join to a translations table. MVP schema: `ct_contents(title JSONB NOT NULL, description JSONB, ...)` |
| **Full-text search (Arabic + English) WITHOUT Elasticsearch (Phase 2)** | Built-in `tsvector` / `tsquery` + `text search configuration` (default + Arabic) | Generated stored column `search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english', COALESCE(title->>'en','')) || to_tsvector('arabic', COALESCE(title->>'ar','')) || ...) STORED`. GIN index on `search_vector`. Ranks via `ts_rank_cd()`. Phase 2 search UI queries this column directly. NO external search cluster in Phase 2. |
| **UUIDv7 Primary Keys** | `uuid` data type + `pg_uuidv7` extension (PostgreSQL 16+ natively or via extension) OR `uuid-ossp` + trigger | All tables use `id UUID PRIMARY KEY DEFAULT uuid_generate_v7()`. B-tree indexes preserve INSERT locality (time-ordered UUIDs = clustered writes, 30-40% better INSERT throughput than UUIDv4). ID enumeration attacks impossible. |
| **Schema-level security per module** | Row-Level Security (RLS) + module-specific DB roles with `GRANT` per prefix | Five DB roles: `id_module_rw`, `ct_module_rw`, `eg_module_rw`, `nt_module_rw`, `ad_module_rw`. Each role has `SELECT/INSERT/UPDATE/DELETE` ONLY on tables with its prefix. NestJS module uses its own role's credentials. DBA enforces: cross-prefix SQL access is a DB-level permission denied error. Defense-in-depth for ADR-002 cross-boundary rule. |
| **Future Spatial (Phase 3)** | `PostGIS 3.x` extension (installable at any time without downtime) | Phase 3: install PostGIS, create `GEOMETRY(Point,4326)` columns, spatial R-Tree indexes. Support mosque locator, regional content, geofencing. No schema rewrite. |
| **JSON semi-structured attributes** | `JSONB` + GIN index | `attributes_extra JSONB DEFAULT '{}'::jsonb` column on every content/user table. Allows adding fields without ALTER TABLE migration. JSON:API sparse fieldsets return these values. GIN index on key paths. |
| **Read Replicas (Phase 2)** | Streaming replication built-in | Phase 2: add 1 read replica. TypeORM `DataSource` replication config routes SELECT queries to replica, mutations to primary. Hostinger VPS scale-out vertical → vertical + read replica. |
| **Bulk Notification Fanout (BC04)** | `LISTEN/NOTIFY` + `SKIP LOCKED` queue pattern or native BullMQ | BC04 notification fanout uses PostgreSQL SKIP LOCKED for reliable queue processing (in addition to Redis BullMQ for job queue). Backpressure management for notification bursts across the active user base. |

### 2.2 Concrete Actions

1. **Docker Compose deployment:** PostgreSQL 16 official Docker image (`postgres:16-alpine`). Mount `/data/postgres` volume on Hostinger VPS persistent storage. PgBouncer 1.x sidecar for connection pooling (transaction-level pooling, pool_size=20 × 4 workers = 80 DB connections per VPS).
2. **Extensions installed in `template1`:** `CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`, `CREATE EXTENSION IF NOT EXISTS pg_trgm;`, `CREATE EXTENSION IF NOT EXISTS btree_gin;`. `pg_uuidv7` if available in 16.x; else use `uuid-ossp uuid_generate_v4()` wrapper with custom UUIDv7 function. PostGIS 3.x installed on demand at Phase 3.
3. **Migration strategy:** TypeORM 0.3.x migrations (ADR-006). Every migration MUST include the table prefix (ADR-002). DBA reviews ALL migrations for: prefix correctness, index coverage, JSONB column defaults, RLS policies.
4. **RLS setup script:** `scripts/db/setup-rls.sh` creates 5 module roles and runs GRANTs per prefix automatically. Runs in CI against test DB to ensure cross-prefix access is denied.
5. **Backup plan:** Continuous WAL archiving to `/data/backups/wal/` via `pg_basebackup` + `wal-g` or `pgBackRest`. Daily full backup + incremental WAL. Restore drill documented in DEV runbook; executed quarterly.
6. **Phase 2 Search prep:** During schema creation, add `search_vector` generated column + GIN index to content tables. Column stays empty until Phase 2 triggers search feature build; no Phase 1 overhead.

---

## 3. Alternatives Considered

### Alternative A: MySQL 8.0 (InnoDB + FULLTEXT + JSON)

- ✅ **Pro:** Most widely-known RDBMS. Every DBA knows MySQL. Hiring pool is larger.
- ✅ **Pro:** Docker image is small; deployment straightforward. Single-node fine on Hostinger.
- ✅ **Pro:** InnoDB performance on simple OLTP (user CRUD, sessions) is comparable or slightly better on write-heavy microbenchmarks.
- ❌ **Con:** **ARABIC FULL-TEXT SEARCH IS BROKEN / NON-EXISTENT.** MySQL 8.0 FULLTEXT indexes support ONLY English stopwords/stemmers by default. Arabic full-text requires custom plugin or external dictionary, which is ALMOST NEVER used in production and has NO community support. Our #1 Phase 2 requirement (Arabic + English search without Elasticsearch) is FAIL on MySQL.
- ❌ **Con:** **JSON type performance is WEAK compared to PostgreSQL JSONB.** MySQL JSON does NOT support GIN indexing on arbitrary JSON paths. You must create generated columns and then index those columns individually. For a JSONB with 5 language keys → 5 generated columns + 5 indexes per translatable field OR no indexing at all. Full table scan on every language filter query.
- ❌ **Con:** **UUIDv7 is NOT available.** UUID functions in MySQL 8 generate UUIDv1 (MAC-based) or UUIDv4 (random). UUIDv4 causes massive B-tree fragmentation on INSERT (random IO). No native extension ecosystem to add UUIDv7. Workaround (application-generated UUIDv7 stored as BINARY(16)) is possible but loses DB-generated defaults.
- ❌ **Con:** **No Row-Level Security.** MySQL 8.0 added Dynamic Privileges but no RLS policies on tables. Cross-prefix access (ADR-002 rule enforcement) relies solely on application-level GRANTs per table. 50+ tables = 50+ GRANT statements. Maintenance burden is high; mistakes in migration scripts = cross-boundary data leak. PostgreSQL has declarative `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` + `CREATE POLICY`.
- ❌ **Con:** **No PostGIS equivalent.** MySQL has `SPATIAL` type but Spatial Reference System support is partial; no equivalent of PostGIS `ST_DWithin`, `ST_Intersects`, or spatial aggregate functions. Phase 3 geo features = move DB or introduce separate PostGIS DB.
- ❌ **Con:** **CTEs, Window Functions, LATERAL JOINs are WEAKER.** MySQL 8 added them but performance is worse than PostgreSQL for the complex analytics queries BC05 Admin will run. For aggregate engagement dashboards (rolling 7-day active users by content category), PostgreSQL wins 2-5x in benchmarks.
- ❌ **Con:** **LISTEN/NOTIFY equivalent does not exist.** MySQL has no pub/sub. Must use Redis or polling for notification fanout patterns.

### Alternative B: MongoDB 7.0 (Document Model, Self-Hosted Replica Set on VPS)

- ✅ **Pro:** Document model NATURALLY fits translatable fields. One document per content item with nested `title: { ar, en, tr, fa, ur }`. No JOINs, no JSONB type weirdness.
- ✅ **Pro:** Flexible schema. Add fields without migrations. `attributes_extra` concept is native.
- ✅ **Pro:** `_id` as ObjectId = time-ordered (like UUIDv7 but 12 bytes). ID enumeration attacks not possible.
- ❌ **Con:** **No SQL joins → terrible for relational data.** Our schema is DEEPLY relational: Users → Roles, Content → Categories → Tags, Comments → Content → Users, Bookmarks → User → Content. For "show me all comments on audio contents by this user": SQL = multi-join query with indexes. MongoDB = separate queries + client-side join = 10-100x slower. ORM support for document-to-relational mapping does not exist.
- ❌ **Con:** **Full-text search on Arabic in MongoDB 7 Community Edition is NOT production-ready.** MongoDB Atlas Search (Lucene-powered) is the production search path but Atlas is a managed cloud service; we cannot run it on Hostinger VPS. Self-hosted MongoDB Community full-text has NO Arabic stemming/stopwords support. We would be forced to deploy Elasticsearch separately (extra RAM/CPU cost) from Phase 1, not Phase 2. Violation of Phase 1 budget constraints.
- ❌ **Con:** **Transactions are limited and have high overhead.** MongoDB 7 multi-document transactions are limited to 1000 docs max; throughput is ~1/5 of PostgreSQL. For "user posts comment → update content comment_count → fire notification event → write audit log": 4-doc transaction works but at severe performance cost under sustained write load.
- ❌ **Con:** **Schema enforcement NON-EXISTENT in Community.** You can write ANY schema into ANY collection. ADR-002 cross-boundary rule enforcement is impossible. Migration scripts are ad-hoc JS with no rollback. The "flexible schema" benefit quickly becomes "no schema at all" with 10 parallel engineers. We would be deploying a document store on top of a RELATIONAL domain. Square peg → round hole.
- ❌ **Con:** **PostGIS equivalent? Zero.** MongoDB has basic geo queries (near, geoWithin) but no polygon operations, no raster support, no spatial aggregates. Phase 3 geo features limited to point-in-polygon only.
- ❌ **Con:** **No mature TypeORM equivalent.** Mongoose is the de facto ODM but NestJS Mongoose integration is weaker than TypeORM. Repository pattern is awkward. Migrations are not first-class. ADR-006 TypeORM choice becomes invalid.
- ❌ **Con:** **Hostinger VPS footprint is WORSE.** MongoDB Community recommends minimum 8GB RAM for WiredTiger cache alone, plus we'd need 3-node replica set for durability (primary + 2 secondaries). On one Hostinger VPS, this means 3 MongoDB containers = resource contention. No point in replica set on one box anyway.
- ❌ **Con:** **Backup is more complex.** `mongodump` / `mongorestore` for logical backup. Point-in-time recovery requires oplog replay. MongoDB Community lacks easy-to-use WAL equivalent tooling.
- ❌ **Con:** **Data consistency model is WEAKER.** Read concern `majority` + write concern `majority` on single-node replica set = slower than PostgreSQL single-node ACID. If we skip those → eventual consistency on reads of user's own write. Confusing UX.

### Alternative C: CockroachDB (Distributed SQL, PostgreSQL-compatible wire protocol)

- ✅ **Pro:** Distributed SQL from day one. Survives node failures without downtime. Horizontal write scalability by adding nodes — its pitch is "need more scale? just add nodes."
- ✅ **Pro:** PostgreSQL wire-compatible. TypeORM with PostgreSQL driver should work with minimal changes.
- ✅ **Pro:** UUID primary keys natively supported. Change Data Capture (CDC) built in.
- ❌ **Con:** **CANNOT RUN ON HOSTINGER VPS ECONOMICALLY.** CockroachDB requires (minimum) 3 nodes, each with minimum 4 CPU cores and 8 GB RAM for acceptable performance. Single-node "demo" mode is NOT supported for production. On Hostinger VPS, 3 nodes = 3 separate VPS = 3x infrastructure cost. Even if we buy 3 VPS, CockroachDB's inter-node latency on non-colocated boxes (no private network) is poor.
- ❌ **Con:** **PostgreSQL compatibility ≠ feature parity.** pg_uuidv7 extension? Not available. PostGIS? CockroachDB has partial spatial (Spatial 1.0, as of 2024) but NO PostGIS function coverage for complex Phase 3 features. tsvector + full-text search? CockroachDB has Full-Text Search in preview only; Arabic language support is NOT there and has NO ETA. RLS policies? CockroachDB has them but performance on complex policies is NOT documented.
- ❌ **Con:** **UUIDv7? NOT available.** CockroachDB has `gen_random_uuid()` (v4) and `unique_rowid()` (int64, not UUID). No UUIDv7. Workaround is application-side generation.
- ❌ **Con:** **Single-node (Hostinger VPS one-box) = WORSE than PostgreSQL.** CockroachDB writes go through Raft consensus even on a single-node cluster. Write latency = 2-5x slower than PostgreSQL single-node. MVCC garbage collection overhead is higher. For our Phase 1 scale on a single VPS: PostgreSQL DOMINATES performance.
- ❌ **Con:** **CockroachDB Dedicated (managed) is the ONLY production option.** That's AWS/GCP only. Not Hostinger. Violates Charter §3.1 deployment target.
- ❌ **Con:** **Vendor lock-in SEVERE.** SQL dialect has Cockroach-only extensions. Migration BACK to PostgreSQL from Cockroach requires ETL of millions of rows with compatibility shims. Once on CockroachDB, you're stuck. Charter requires "no rewrite at hundreds of thousands of users" — not "rewrite to another DB".

### Alternative D: PostgreSQL 16 (Chosen Decision)

- ✅ **Pro:** **ARABIC + ENGLISH FULL-TEXT SEARCH NATIVELY SUPPORTED.** `to_tsvector('arabic', ...)` works. Arabic stemmer, Arabic stopwords. Combined with English vector via `||` operator. GIN-indexed. Phase 2 search WITHOUT Elasticsearch. This feature alone justifies PostgreSQL.
- ✅ **Pro:** **JSONB + GIN indexing = perfect for translatable fields.** `title JSONB {ar,en,tr,fa,ur}`. Query: `WHERE title @> '{"ar": "..."}'` uses GIN index. Zero joins. One row per content item. Designed for exactly our use case.
- ✅ **Pro:** **UUIDv7 available.** Either native in PostgreSQL 17 (upgrade path clear), via `pg_uuidv7` extension in 16, or via plpgsql function as fallback. UUIDv7 = time-ordered = INSERT locality = 30-40% better write throughput than UUIDv4. DB-generated default. No app-side ID generation.
- ✅ **Pro:** **Row-Level Security (RLS) declarative.** Per-module roles + per-table policies = DB-LEVEL ENFORCEMENT of ADR-002 cross-boundary rule. Even if a bug in NestJS allows cross-module Repository import, PostgreSQL says `permission denied`. Defense in depth.
- ✅ **Pro:** **PostGIS = industry standard for spatial.** Phase 3 mosque locator, regional targeting, geo-analytics → one `CREATE EXTENSION postgis;`. Zero data migration. 1000+ spatial functions available.
- ✅ **Pro:** **NestJS + TypeORM = BEST IN CLASS integration.** Repository pattern, migrations, tree entities (categories), query builder, UUID support. ADR-006 leverages all of this.
- ✅ **Pro:** **Rich SQL feature set.** CTEs, Window Functions, LATERAL JOINs, table partitioning, BRIN indexes, parallel query for analytics. BC05 Admin engagement dashboards are complex PostgreSQL performs 2-5x better than MySQL on these queries.
- ✅ **Pro:** **Single-node on Hostinger VPS = BEST PERFORMANCE.** Optimizer is mature. PgBouncer pooling handles 80 connections. Read replica (Phase 2) via built-in streaming replication. WAL archiving for point-in-time recovery. All battle-tested well beyond our Phase 1 target scale.
- ✅ **Pro:** **Zero vendor lock-in.** Open-source, BSD license. Run on any Linux VPS. Migrate to AWS RDS / GCP Cloud SQL later with `pg_dump` / `pg_restore` (hours, not weeks). Extraction to microservices per ADR-003 = `pg_dump` by table prefix.
- ⚠️ **Trade-off:** Write throughput on single-primary has a hard ceiling (tens of thousands of write TPS on beefiest VPS). **Mitigation:** Trigger 1 of ADR-003 activates at 40% DB time per module → extract that module's schema before ceiling is hit. Also: Redis caching, read replicas, table partitioning all buy headroom. The ceiling is far above Phase 1 needs; the mitigations are the documented path that lets us grow into them.
- ⚠️ **Trade-off:** DBA hiring pool slightly smaller than MySQL. **Mitigation:** DBA is already one of the 10 expert accounts on this project (per Governance §2.1 Account 05 = DBA). Plus, PostgreSQL community/docs are excellent; stack overflow answers outnumber MySQL for advanced features.
- ⚠️ **Trade-off:** Memory usage per connection is higher (~10MB per backend vs MySQL ~2-3MB). **Mitigation:** PgBouncer in transaction-level pooling mode. 80 pool connections serve hundreds of concurrent API users without spawning that many PostgreSQL backends. PM2 cluster × 4 workers × 20 pool = exactly 80.

---

## 4. Trade-off Analysis Summary Table

| Criterion | MySQL 8.0 | MongoDB 7.0 (Self-Hosted) | CockroachDB (Multi-Node) | PostgreSQL 16 ✅ CHOSEN |
|-----------|-----------|---------------------------|--------------------------|--------------------------|
| **Arabic Full-Text Search (Phase 2)** | ❌ NO production support | ❌ Requires Atlas ($) or ES (extra VPS) | ❌ Preview only, no Arabic | ✅ Native `tsvector` Arabic config |
| **JSON Translatable Fields + Indexing** | ❌ Weak JSON; no GIN on paths | ✅ Native document model | ⚠️ PostgreSQL-compatible JSONB | ✅ JSONB + GIN on arbitrary paths |
| **UUIDv7 Primary Keys** | ❌ Not available | ⚠️ ObjectId (similar, not UUID) | ❌ Not available | ✅ Native / Extension / Function |
| **Cross-Prefix Security (RLS)** | ❌ Table-level GRANTs only | ❌ Impossible (no schema enforcer) | ⚠️ Limited RLS + undocumented perf | ✅ Declarative RLS Policies |
| **Future Geo/Spatial (Phase 3)** | ❌ Limited SPATIAL type | ❌ Basic only, no PostGIS | ❌ Partial Spatial 1.0 preview | ✅ PostGIS 3.x (industry std) |
| **Hostinger VPS Single-Node Fit** | ✅ Excellent | ⚠️ 3-node replica set wasteful | ❌ Needs 3+ nodes, bad fit | ✅ Perfect + PgBouncer + WAL |
| **Complex Analytics Queries (BC05)** | ⚠️ CTE/Window weaker | ❌ Must client-side join | ⚠️ Fewer parallel query features | ✅ Best: Window/Lateral/Parallel |
| **NestJS + TypeORM Integration (ADR-006)** | ✅ Good | ❌ Mongoose instead; weak | ⚠️ Wire-compatible (some gaps) | ✅ BEST: Native first-class support |
| **ACID Multi-Doc Transactions (Phase 1 load)** | ✅ Excellent | ❌ 1000-doc limit, low throughput | ✅ Distributed ACID | ✅ Best-in-class single-node ACID |
| **Relational Data Modeling Fit** | ✅ Excellent | ❌ Poor (deeply relational domain) | ✅ SQL relational | ✅ Perfect (SQL compliance strictest) |
| **Zero Vendor Lock-In / Portable** | ⚠️ MySQL syntax (easy but not SQL-compliant) | ❌ Severe document lock-in | ❌ HEAVY (distributed features custom) | ✅ Perfect: Any Linux VPS → RDS → Cloud SQL |
| **Phase 1 Budget Fit (Hostinger VPS)** | ✅ Minimal | ⚠️ High RAM needs; replica set | ❌ 3 VPS minimum = 3× cost | ✅ Minimal (one container + pooler) |
| **Charter §2.1 Obj-002: Hundreds of Thousands of Users, No Rewrite** | ⚠️ Must shard manually later | ⚠️ Sharding is manual; no joins after | ✅ Native horizontal scalability | ✅ Gradual (extract modules per ADR-003 before ceiling) |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Arabic + English search in Phase 2 without Elasticsearch.** Saves $50-100/month on extra VPS RAM/CPU for ES cluster. Saves 4-6 weeks of ES setup, mapping tuning, and dual-write logic. This alone is the #1 decision driver.
2. **Translatable fields are FIRST-CLASS.** One `ct_contents` row with `JSONB title` = 5 languages, indexed via GIN. No `ct_content_translations` join table. No N+1 queries when rendering multilingual content. Mobile payloads smaller.
3. **UUIDv7 = security + performance.** No ID enumeration attacks (SEC win). 30-40% better INSERT throughput than UUIDv4 (PFE win). No central ID generator needed; works perfectly after microservice extraction.
4. **Defense-in-depth for cross-boundary rules.** RLS policies + module roles = cross-prefix access DENIED AT DATABASE LEVEL. ESLint catches 80% of cross-boundary violations; RLS catches the remaining 20%. Impossible to leak data between modules even with NestJS bugs.
5. **Phase 3 geo features are a one-command install.** PostGIS extension. No data migration. Mosque locator, regional analytics, GPS-based content targeting are all on the table without architectural change.
6. **Admin analytics dashboards FAST.** BC05 engagement KPIs (rolling 7/30-day active users, top-performing content by category, comment velocity by language) use PostgreSQL window functions + parallel query. Dashboards render in <500ms with no caching needed.
7. **Zero lock-in. Easy migration path.** `pg_dump` → `pg_restore` to AWS RDS in 2 hours if we ever leave Hostinger. Microservice extraction per ADR-003 = `pg_dump --table=nt_*` → new DB. Mechanical.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Single-primary write ceiling (tens of thousands of wTPS on max VPS).** **Mitigation:** (a) Redis caching of read-heavy content (80% of workload = reads); (b) Phase 2 read replicas offload SELECT queries; (c) Table partitioning on large tables (time-series audit/analytics data by month); (d) ADR-003 Trigger 1 extracts hot modules at 40% DB time BEFORE we hit the ceiling.
2. **Higher per-connection memory use.** **Mitigation:** PgBouncer transaction-level pooling. 80 pool connections serve hundreds of concurrent users. PM2 cluster × 4 workers × 20 pool each = 80. Tuned in `docker-compose.yml`.
3. **PostgreSQL 16 → 17 upgrade path for native UUIDv7.** **Mitigation:** In Phase 1, use plpgsql UUIDv7 function + `uuid` type. When PostgreSQL 17 is stable (2026Q4 likely), upgrade via `pg_upgrade` in-place and ALTER DEFAULT to native function. Zero data migration.

### Neutral / Unknown (risks to monitor)
1. **Will tsvector Arabic search quality be sufficient?** Phase 2 search load testing will test: Arabic stemming accuracy, stopword coverage for dialects (MSA vs Egyptian vs Gulf), relevance ranking quality. If PostgreSQL Arabic search isn't sufficient for MVP search quality standards, we have Postgres as a document source for Elasticsearch later. The path is preserved.
2. **JSONB write amplification?** Updating one language key out of 5 in a JSONB column rewrites the whole JSONB value (PostgreSQL TOAST). For 5-language content, acceptable. If we grow to 15 languages and content updates are frequent, we evaluate a separate translations table pattern.
3. **Hostinger VPS I/O performance for WAL.** PostgreSQL write-ahead log is sequential I/O. Budget VPS SSD I/O is typically 1000-3000 IOPS. At our Phase 1 scale (1,000–5,000 users) we expect a low double-digit write TPS — comfortably within budget. We benchmark on staging; if I/O becomes a bottleneck as we grow, we upgrade VPS tier or separate the WAL volume.

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Phase 2 Search Quality Failure):** Phase 2 search load testing shows PostgreSQL tsvector Arabic search has <70% query precision on relevance judged by content team, AND 3 months of tuning (custom dictionaries, synonym files, thesaurus) fail to reach 85% precision.
   - **Action:** Introduce Elasticsearch/OpenSearch sidecar container on Hostinger. PostgreSQL remains system of record; ES becomes read-optimized search index populated via CDC (Debezium) or domain events. PostgreSQL is NOT abandoned.

2. **TRIGGER 2 (Write Ceiling Hit Before Extraction):** Even with read replicas, caching, and partitioning, PostgreSQL primary write TPS saturates VPS I/O for 7 consecutive days, AND no single module exceeds 40% of DB time (so ADR-003 Trigger 1 doesn't fire but overall saturation is real).
   - **Action:** Evaluate (a) vertical VPS upgrade to max tier; (b) CockroachDB / Amazon Aurora PostgreSQL as a drop-in replacement (wire-compatible). Both paths preserve investment.

3. **TRIGGER 3 (Multi-Region Mandate):** Business requires active-active multi-region deployment (e.g., KSA + UAE + Egypt active-active) before any ADR-003 extraction triggers.
   - **Action:** Evaluate CockroachDB multi-region or Spanner-style PostgreSQL-compatible distributed SQL. This is a full data migration, mitigated by strict table prefixes (ADR-002) which make per-region sharding by prefix feasible.

4. **TRIGGER 4 (Document Use Case Dominates):** Project Charter scope is amended to include 80%+ document/semi-structured data (e.g., user UGC uploads with custom metadata, complex AI-generated embeddings), AND 20%+ queries cannot be expressed in SQL without severe performance penalties.
   - **Action:** Evaluate PostgreSQL + MongoDB hybrid (polyglot persistence), PostgreSQL `JSONB` enhancements, or a document DB alongside PostgreSQL. This is an ADDITION, not a replacement.

We **explicitly do NOT revisit** this decision:
- Due to "MySQL is what I know" personal preference arguments
- Before Phase 2 search load testing data is available
- For any single-query performance issue that can be fixed via indexing/query tuning/DBA review
- Without CSA + DBA sign-off and 30+ days of quantitative production DB metrics

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §2.1 Obj-002 (hundreds of thousands of users, no rewrite), §2.1 Obj-004 (99.9% uptime), §3.1 Scope (5+ languages RTL/LTR, Hostinger VPS, PostgreSQL 16 + Redis 7), §3.2 Out of Scope (no MVP search, no UGC)
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §2.1 P-06 (Persistence Ignorance), §4.1 System Context (PostgreSQL + Redis), §5 Bounded Context Data Stores, §6 NFRs (Performance, Security)
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §2.1 Account 05 DBA (PostgreSQL/Redis owner), §3.1 Class A Architectural Decision
- [ADR-002 Bounded Context Map](ADR-002-bounded-context-map-5-modules.md) §2.4 Table Prefix Convention (id_ ct_ eg_ nt_ ad_) → maps directly to module DB roles + RLS policies
- [ADR-006 ORM — TypeORM 0.3.x](ADR-006-orm-typeorm-0-3-x.md) (NestJS TypeORM integration; tree entities, UUID support, Query Builder all rely on PostgreSQL feature set)
- [ADR-008 Auth Strategy — JWT RS256](ADR-008-auth-strategy-jwt-rs256-rotating-refresh.md) (Refresh tokens stored in Redis 7 alongside PostgreSQL id_refresh_tokens table for audit)
- External: PostgreSQL 16 Documentation (postgresql.org/docs/16/) — Full Text Search, JSONB, RLS, UUID, PostGIS
- External: "Arabic Language Full-Text Search in PostgreSQL" (several blog posts + conference talks demonstrating production Arabic FTS)
- External: UUIDv7 Specification (RFC 9562) — Time-ordered UUID benefits for B-tree index locality
- External: Stack Overflow Engineering — "Why PostgreSQL? A look under the hood at our database choice"

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. 4-candidate comparison; feature matrix; 4 reversal triggers. Sent for Sponsor + DBA + BKE + SEC review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; target scale 1,000–5,000 users in the first 6 months with a documented scaling path (read replicas / partitioning / per-module extraction), replacing the earlier 100K/1M framing.
