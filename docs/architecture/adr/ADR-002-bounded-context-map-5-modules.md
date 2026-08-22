# ADR-002: Bounded Context Map — 5 Modules with Context Mapping & Extraction Paths

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: BKE, DBA, DEV, SEC
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-001 (Modular Monolith), ADR-003 (Extraction Triggers), ADR-005 (PostgreSQL)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform is a **Modular Monolith** (per ADR-001). The single most critical implementation detail of that pattern is the definition of Bounded Context boundaries. If boundaries are wrong: (a) cross-module coupling turns the monolith into a Big Ball of Mud, (b) future microservice extraction becomes a complete rewrite rather than a mechanical exercise, and (c) ownership among the 10-expert team becomes ambiguous.

The original Architecture Vision draft included **7 Bounded Contexts**. Subsequent analysis of the MVP scope (no courses/quizzes/certificates — Stakeholder Q-05/Q-15/Q-16) revealed that two of those contexts had insufficient functional mass to justify standalone modules in Phase 1. We also need to define:

1. **Context Map**: Upstream/Downstream relationships, communication patterns between contexts
2. **Cross-boundary rules**: EXACTLY what is allowed and forbidden across module boundaries
3. **Database table prefixes**: Namespace conventions for each context's tables
4. **Extraction paths**: For each of the 5 modules, what a future Strangler-Fig microservice extraction would look like

Three alternative decompositions are on the table: 7 modules (original design), 5 modules (refined for MVP scope), or 3 mega-modules (maximum aggregation).

---

## 2. Decision

**✅ WE WILL IMPLEMENT 5 BOUNDED CONTEXTS as NestJS modules, with explicit Context Mapping, cross-boundary enforcement, database table prefixes, and documented extraction paths.**

Concrete actions implementing this decision:

### 2.1 The 5 Bounded Contexts (Modules)

| # | Module Name | Bounded Context | Table Prefix | Owner | Primary Responsibility |
|---|------------|-----------------|--------------|-------|------------------------|
| **BC01** | `identity` | Identity & Access | `id_` | BKE + SEC | 5 authentication methods, 5-role RBAC, user profiles, sessions, OAuth2 integrations, SMS OTP |
| **BC02** | `content` | Content & Media Library | `ct_` | BKE + DBA | 4 content types (Audio / PDF / Text / Image), media library, transcoding jobs, categories, tags, publishing workflow |
| **BC03** | `engagement` | User Engagement | `eg_` | BKE | Comments, Q&A (questions + answers), likes |
| **BC04** | `notifications` | Notifications System | `nt_` | BKE + DEV | 3 notification channels (FCM Push / Email / SMS), templates, delivery status, notification preferences, bulk scheduling |
| **BC05** | `admin` | Admin & Analytics | `ad_` | BKE + FEA | Admin operations, audit logging, analytics aggregates, dashboard KPIs, system config, moderation workflows |

### 2.2 Context Map (Upstream/Downstream Relationships)

```
                    ┌──────────────────────────────────────────────┐
                    │        CONTEXT MAP — AL-FAJR PLATFORM        │
                    └──────────────────────────────────────────────┘

  ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
  │   BC01:      │──OHS──▶│   BC02:      │──OHS──▶│   BC03:      │
  │   Identity   │        │   Content    │        │  Engagement  │
  │   (Upstream) │        │   (D/U)      │        │  (Downstream)│
  └──────┬───────┘        └──────┬───────┘        └──────┬───────┘
         │                       │                       │
         │ ACL                   │ ACL                   │ ACL
         ▼                       ▼                       ▼
  ┌──────────────┐        ┌──────────────┐               │
  │   BC05:      │◀──ACL──│   BC04:      │◀──────OHS─────┘
  │  Admin +     │        │ Notifications│
  │  Analytics   │        │  (Downstream)│
  └──────────────┘        └──────────────┘

  Relationship Legend:
    OHS = Open Host Service (upstream publishes a public API)
    ACL = Anti-Corruption Layer (downstream translates upstream models)
```

### 2.3 Cross-Boundary Communication Rules (ENFORCED IN CI)

1. **✅ ALLOWED: Domain Events via in-process Event Bus**
   - A module publishes a Domain Event (e.g., `UserRegisteredEvent` from BC01)
   - Zero or more modules subscribe and react (e.g., BC04 sends welcome notification, BC05 writes an audit log entry)
   - Events are immutable facts; past-tense names; live in module's `domain/events/` folder
   - Example: `id_user_registered`, `ct_content_published`, `eg_comment_posted`

2. **✅ ALLOWED: Explicit Public Query API (HTTP in same process)**
   - If Module X needs READ data from Module Y, it calls Module Y's **explicitly published** Public Query Controller
   - NEVER imports another module's Repository or Entity directly
   - Example: BC03 (Engagement) queries BC02 (Content) via `ContentQueryController.findById()` to validate content exists before recording a comment

3. **❌ FORBIDDEN: Direct Database Access Across Boundaries**
   - Module X's code MAY NOT execute SQL against Module Y's tables
   - Module X MAY NOT import Module Y's Entity classes, Repositories, or Services
   - Module X MAY NOT join across prefix boundaries in raw SQL or QueryBuilder
   - **Enforcement:** ESLint `@typescript-eslint/no-restricted-imports` + ArchUnit-style tests + DBA review of all migrations

4. **❌ FORBIDDEN: Cross-Module Command (Write) Calls**
   - Module X cannot tell Module Y to WRITE data via direct function call
   - Write coordination happens ONLY via Domain Events (eventual consistency)
   - Exception: BC05 Admin may call any module's command API only for legitimate admin/moderation actions (e.g., admin deletes a comment via BC03's explicit Admin API endpoint)

### 2.4 Database Table Prefix Convention

Every table name SHALL use its module prefix. This guarantees:
- Immediate visual identification of table ownership
- Mechanical schema extraction when a module becomes a microservice
- No accidental cross-prefix joins (DBA review enforces this)

```sql
-- BC01 Identity / Access
CREATE TABLE id_users (...);
CREATE TABLE id_roles (...);
CREATE TABLE id_user_roles (...);
CREATE TABLE id_refresh_tokens (...);
CREATE TABLE id_oauth_accounts (...);
CREATE TABLE id_sms_otps (...);

-- BC02 Content & Media
CREATE TABLE ct_categories (...);
CREATE TABLE ct_contents (...);
CREATE TABLE ct_media_assets (...);
CREATE TABLE ct_transcoding_jobs (...);
CREATE TABLE ct_content_tags (...);

-- BC03 Engagement
CREATE TABLE eg_comments (...);
CREATE TABLE eg_questions (...);
CREATE TABLE eg_answers (...);
CREATE TABLE eg_likes (...);

-- BC04 Notifications
CREATE TABLE nt_notifications (...);
CREATE TABLE nt_templates (...);
CREATE TABLE nt_delivery_logs (...);
CREATE TABLE nt_preferences (...);

-- BC05 Admin & Analytics
CREATE TABLE ad_audit_logs (...);
CREATE TABLE ad_analytics_aggregates (...);
CREATE TABLE ad_system_configs (...);
CREATE TABLE ad_moderation_actions (...);
```

### 2.5 Extraction Paths (Strangler-Fig Ready per ADR-003)

| Module | Extraction Complexity | Extraction Order Likelihood | What must happen for extraction |
|--------|----------------------|-----------------------------|---------------------------------|
| **BC04 Notifications** | LOW (1st) | VERY HIGH | Cut Event Bus → replace with Kafka/Redis streams. Move `nt_` tables via logical replication. Deploy as NestJS microservice with gRPC internal API. |
| **BC02 Content** | MEDIUM (2nd) | HIGH | Move `ct_` tables. Media storage stays shared (object storage). CDN already points at storage. Internal API for content queries. |
| **BC03 Engagement** | MEDIUM (3rd) | MEDIUM | Move `eg_` tables. Foreign key to `id_users` → replace with API call + cache. Engagement write events to Kafka. |
| **BC01 Identity** | HIGH (4th) | LOW-MEDIUM | Move `id_` tables. Auth is cross-cutting: all other services need JWT verification. Deploy as standalone OIDC-compatible auth service. |
| **BC05 Admin** | HIGH (5th) | LOWEST | Move `ad_` tables. Admin needs read/write across all other modules — hardest to extract cleanly. Likely stays in monolith longest. |

---

## 3. Alternatives Considered

### Alternative A: 7 Bounded Contexts (Original Design — Old)

The original draft decomposed as:
1. Identity, 2. Content, 3. Media (separate!), 4. Engagement, 5. Notifications, 6. Analytics (separate!), 7. Admin

- ✅ **Pro:** Finer-grained boundaries; Media module could be extracted even earlier
- ✅ **Pro:** Analytics module (separate from Admin) could use columnar DB later
- ❌ **Con:** Media module in MVP has ONLY 4 entities and 1 job type (transcoding). Too small to justify its own module — overhead of module boundaries > value.
- ❌ **Con:** Analytics module in MVP has NO independent team, NO independent scaling needs. Admin dashboard IS the analytics consumer in Phase 1. Splitting them creates an artificial boundary with zero benefit and constant cross-calls.
- ❌ **Con:** 7 modules × 4 layers (domain/application/infrastructure/presentation) = 28 folders for team to navigate. Cognitive load > 5-module version.
- ❌ **Con:** With only 1 BKE (Backend Expert) in Phase 1, 7 modules means 7 module review checklists. Burnout risk.

### Alternative B: 5 Bounded Contexts (Chosen Decision)

Refined decomposition after MVP scope lock. Media merged into Content (BC02). Analytics merged into Admin (BC05).

- ✅ **Pro:** Perfect alignment with MVP scope. Each module has enough functionality (≥8 entities, ≥3 aggregate roots) to justify boundaries.
- ✅ **Pro:** 5 modules × 4 layers = 20 folders. Cognitive load manageable.
- ✅ **Pro:** Extraction paths preserved. BC02 Content contains all media entities (co-located with their natural owner). BC05 Admin contains all analytics aggregates (admin dashboard = primary consumer).
- ✅ **Pro:** Clean ownership map: each module has a clear primary expert.
- ✅ **Pro:** Cross-module events are meaningful and non-trivial. No "chatty" boundaries.
- ⚠️ **Trade-off:** BC02 Content is the LARGEST module (4 content types + media library + categories + publishing). Mitigation: internal sub-modules (`content/audio`, `content/pdf`, etc.) within BC02 with same cross-boundary rules.
- ⚠️ **Trade-off:** BC05 Admin & Analytics is the WIDEST module (touches all other modules via admin actions). Mitigation: admin command/query APIs are explicitly published on each target module; BC05 only orchestrates the admin UI and audit logs.

### Alternative C: 3 Mega-Modules (Maximum Aggregation)

1. Core (Identity + Admin + Analytics), 2. Content (Content + Media), 3. Experience (Engagement + Notifications)

- ✅ **Pro:** Minimum module overhead. 3 modules × 4 layers = 12 folders.
- ✅ **Pro:** Fewest cross-module calls. Identity is next to Admin, so admin-auth is trivial.
- ❌ **Con:** Extraction path OBSCURED. BC04 Notifications (the #1 most-likely-first extraction candidate) is buried inside "Experience" module. Separating it later requires careful dissection of a large shared schema.
- ❌ **Con:** Identity + Admin + Analytics all in one module creates a monolith-within-a-monolith. It will be 40-50% of the codebase and the hardest to extract — exactly the wrong modules to combine.
- ❌ **Con:** Ownership ambiguity. "Core" module has 3 sub-domains with 3 different expert owners (BKE/SEC/FEA/DBA). Merge conflicts guaranteed.
- ❌ **Con:** Violates Single Responsibility Principle at the module level. A single module should serve one master domain.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — 7 Modules (Old) | Alternative B — 5 Modules ✅ CHOSEN | Alternative C — 3 Mega-Modules |
|-----------|----------------------------------|-------------------------------------|---------------------------------|
| **MVP Cognitive Load** | ❌ 28 folders; too fine-grained | ✅ 20 folders; Goldilocks zone | ✅ 12 folders; lightest |
| **Boundary Correctness (MVP)** | ❌ Media/Analytics too small | ✅ Each module ≥8 entities | ❌ Identity/Admin/Analytics wrongly fused |
| **Extraction Path Clarity** | ⚠️ Good but extra splits needed | ✅ Explicit, documented, mechanical | ❌ Obscured; Notifications buried |
| **Cross-Module Call Volume** | ⚠️ Chatty (Content↔Media calls) | ✅ Meaningful events only | ✅ Fewest calls |
| **Team Ownership Clarity** | ⚠️ Media module has no dedicated owner | ✅ One primary owner per module | ❌ "Core" = 3 owners = no owner |
| **Enforcement Cost (CI rules)** | ❌ 7 boundary pairs to audit | ⚠️ 5 boundary pairs to audit | ✅ 3 boundary pairs (easiest) |
| **Future Microservice Readiness** | ⚠️ Decent; extra merge work before extract | ✅ Optimal; each module = 1 future service | ❌ Must first SPLIT mega-modules before extract |
| **Schema Namespacing Prefixes** | ❌ 7 prefixes; harder to remember | ✅ 5 prefixes (id_ct_eg_nt_ad_); mnemonic | ❌ 3 prefixes lose extraction-ready granularity |
| **Stakeholder Alignment to MVP Scope** | ❌ Includes 2 non-MVP-justified modules | ✅ Exact match to documented MVP out-of-scope | ⚠️ Aligned but over-aggregated |
| **NestJS DI / Startup Overhead** | ⚠️ 7× module bootstrap overhead | ✅ 5× acceptable | ✅ 3× minimum |
| **DB Migration Review Burden (DBA)** | ❌ 7 sets of migrations to audit | ⚠️ 5 sets (manageable) | ✅ 3 sets (lightest) |
| **Long-Term Maintainability (Years 2-5)** | ⚠️ Good if Media/Analytics grow | ✅ Optimal; modules split cleanly on natural seams | ❌ High risk of internal big-ball-of-mud within mega-modules |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Perfect MVP fit.** Each module has genuine, non-trivial responsibility. No "make work" boundaries.
2. **Crystal-clear extraction paths.** Every module has a documented extraction plan; when ADR-003 triggers, Strangler-Fig is a checklist, not a research project.
3. **5 table prefixes are mnemonic.** Engineers can glance at any SQL query and immediately know ownership: `id_` = Identity, `ct_` = Content, `eg_` = Engagement, `nt_` = Notifications, `ad_` = Admin.
4. **Cross-boundary rules are SIMPLE and ENFORCEABLE.** 2 allowed patterns, 2 forbidden patterns. ESLint + ArchUnit tests + DBA reviews = triple enforcement.
5. **Domain Events architecture naturally supports notifications.** BC01/BC02/BC03 publish events; BC04 subscribes. This is the exact pattern that makes Notifications the easiest first extraction.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **BC02 Content is the largest module** (4 content types + media library + publishing workflow). **Mitigation:** Internal sub-modules within BC02 (`content/audio/`, `content/pdf/`, `content/text/`, `content/image/`, `content/media/`) with the same cross-boundary discipline but inside a single NestJS module. BC02 lead may split to sub-leads when team grows.
2. **BC05 Admin & Analytics has cross-cutting write access** (moderation, content deletion, user banning). **Mitigation:** Admin write operations go through the TARGET module's explicit `Admin*Controller`, not through direct DB access. BC05 only orchestrates; audit logs are written in BC05 but the action itself is executed in the owning module.
3. **5 modules means 5 module CI review checklists.** **Mitigation:** Nx affected builds + reusable GitHub Actions matrix = one config generates all 5 checks. DBA reviews use prefix-based checklist templates.

### Neutral / Unknown (risks to monitor)
1. **Will BC02 internal sub-module boundaries be respected?** If BC02 grows beyond ~30 entities in Year 2, we will revisit and potentially split to 6 or 7 modules. Boundary reshuffling inside a monolith is cheap and safe.
2. **Is BC05 Analytics a natural home for future AI/ML recommendation features?** Likely YES — BC05 already owns the analytics aggregates. If recommendation engine becomes a heavy consumer, we can extract it from BC05 as a dedicated service at that time.
3. **Will the 2-prefix-per-query maximum rule (no joins across 3+ prefixes) ever create performance issues?** Unlikely in Phase 1. If it does, the fix is a Redis-cached materialized view in the querying module, not a rule violation.

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Module Growth):** BC02 Content exceeds **40 entities** or BC05 Admin exceeds **35 entities**, confirmed by codebase metrics for 60 consecutive days, AND internal sub-module discipline has broken down (≥5 cross-sub-module import violations/month).
   - **Action:** CSA evaluates splitting BC02 into `content` + `media` (6 modules total) or BC05 into `admin` + `analytics` (6 or 7 modules). New ADR drafted.

2. **TRIGGER 2 (Extraction Pre-Work):** ADR-003 triggers for ANY module, AND during extraction planning we discover the module boundary has >2 entities that logically belong in another module.
   - **Action:** Pre-extraction boundary reshuffle within the monolith (cheap, safe, ACID). Re-extract with corrected boundaries. Update this ADR.

3. **TRIGGER 3 (New Business Domain):** Sponsor adds a genuinely new Phase 2+ domain with ≥8 entities (e.g., Courses, Live Streaming, Payment/Donations) that does not cleanly fit any existing BC.
   - **Action:** Create new BC06 (6th module) with new table prefix. Update this ADR to include BC06 and its context map relationships.

4. **TRIGGER 4 (Chronic Cross-Module Pain):** Architecture unit tests catch >20 cross-boundary import violations/month for 3 consecutive months, indicating the boundaries are wrong for the team's workflow.
   - **Action:** CSA leads boundary review. May increase or decrease module count. No change without quantitative evidence of improvement.

We **explicitly do NOT revisit** this decision:
- Without 60 days of quantitative codebase metrics
- Because "7 sounds better than 5" or any aesthetic/preference argument
- Before MVP launch

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §3 Project Scope (In Scope / Out of Scope / MVP exclusions), §6 Phases & Milestones
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §2.2 Quality Attributes, §4.3 C4 Component View (Modules), §5 Bounded Context Map (the full map this ADR implements)
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §2.1 Team RACI (ownership mapping), §3.1 Class A/B/C decisions, §13 Violation (boundary enforcement mechanisms)
- [ADR-001 Architecture Pattern — Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) §2 Decision (cross-boundary rule context)
- [ADR-003 Microservices Extraction Trigger Criteria](ADR-003-microservices-extraction-trigger-criteria.md) (extraction paths operationalize this ADR)
- External: Martin Fowler — BoundedContext (martinfowler.com/bliki/BoundedContext.html)
- External: Eric Evans — Domain-Driven Design Reference (Context Map patterns: OHS, ACL, Published Language)
- External: Vladimir Khorikov — Bounded Context validation heuristics (size, cohesiveness, extractability)

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Refined from 7 to 5 modules based on MVP scope. Sent for Sponsor + BKE + DBA review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; BC03 Engagement scope reduced to comments/Q&A/likes (progress tracking and bookmarks removed entirely — `eg_progress` and `eg_bookmarks` tables deleted); 5-role RBAC confirmed for BC01; relative doc links; typo fixes.
