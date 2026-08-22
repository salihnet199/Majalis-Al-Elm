# ARCHITECTURE VISION
# الرؤية المعمارية للمشروع

| Field | Value |
|-------|-------|
| Document ID | AF-ARCH-VISION-001 |
| Version | 1.1.0 |
| Status | 🟢 APPROVED — Project Sponsor (Phase 0 consolidation) |
| Created Date | 2026-08-07 |
| Last Updated | 2026-08-09 |
| Author | Chief Software Architect |

---

## 1. EXECUTIVE SUMMARY

This document defines the **architectural vision** for the **Majlis Al-Alim (مجالس العالم)** Educational & Religious Platform. It establishes the system's structural shape, technology choices, deployment topology, and quality attribute-driven design decisions.

The chosen architecture is a **Modular Monolith with microservices-extraction-ready boundaries** — the optimal balance for Phase 1 delivery velocity while preserving a clear path to distributed systems when scale demands it. This is the architectural pattern used successfully by Shopify, GitHub, Discord, and Stack Overflow for their initial high-growth phases.

---

## 2. ARCHITECTURE GOALS & PRINCIPLES

### 2.1 Non-Negotiable Architectural Principles

| # | Principle | Description | Enforcement Mechanism |
|---|-----------|-------------|----------------------|
| P-01 | **Clean Architecture (Domain-Centric)** | Dependencies point inward. Domain layer has no external dependencies. | Folder structure, import lint rules, peer review |
| P-02 | **SOLID Compliance** | Single Responsibility, Open/Closed, LSP, ISP, DIP | Static analysis, code review checklist |
| P-03 | **Twelve-Factor App** | All 12 factors enforced as baseline | CI checks, config management, release process |
| P-04 | **DDD Strategic Design** | Bounded Contexts with explicit mapping (Context Map) | ADRs, module boundaries, integration tests |
| P-05 | **Domain Events First** | Cross-module communication via explicit domain events, not direct DB access | Event bus contract, integration tests |
| P-06 | **Persistence Ignorance** | Domain objects are ORM-agnostic. Repository interfaces live in Domain. | Dependency direction enforcement |
| P-07 | **Secure by Default** | Opt-in to exposure; deny-by-default on network, API, data access | Security scanning, code review checklist |
| P-08 | **Observable by Default (Lightweight)** | Every request carries a `trace_id`; liveness/readiness exposed; every error logged as structured JSON | `trace_id` middleware, `/health` + `/ready` (`@nestjs/terminus`), pino JSON logs — ADR-011 |
| P-09 | **Testability as First-Class Constraint** | Every architectural decision is evaluated on "can this be unit tested without mocks?" | Test coverage gates, architecture unit tests |
| P-10 | **Strangler-Fig Ready** | Every module boundary is a future service boundary — module = potential service | Internal API contracts, ADR-003 compliant |

### 2.2 Architecture Quality Attribute Priorities

**Rank order (Weighted for Architecture Trade-off Analysis):**

| Priority | Quality Attribute | Weight | Why |
|----------|-------------------|--------|-----|
| 1 | **Security** | 30% | Educational/religious platform with user PII; trust is existential |
| 2 | **Scalability** | 20% | Start at 1,000–5,000 users; architecture must enable growth to hundreds of thousands **without rewrite** |
| 3 | **Maintainability** | 18% | Multi-team, multi-year project; codebase longevity critical |
| 4 | **Performance** | 15% | Mobile UX and engagement tied to latency directly |
| 5 | **Availability** | 10% | 99.9% SLA target; not banking-grade but serious |
| 6 | **Deployability** | 7% | Small, frequent releases via CI/CD |

---

## 3. ARCHITECTURAL STYLE DECISION (THE FOUNDATIONAL CHOICE)

### 3.1 Architectural Pattern Comparison

This decision is so consequential that we perform a formal trade-off analysis before committing.

| Criterion | Modular Monolith (Chosen) | Microservices (Phase 1) | Layered Monolith (Traditional) |
|-----------|---------------------------|--------------------------|--------------------------------|
| **Phase 1 Delivery Speed** | ✅ Excellent — single deployable | ❌ Very slow — network boundaries, distributed txs, infra overhead | ⚠️ Good initially but degrades |
| **Scalability Path (→ hundreds of thousands)** | ✅ Scale DB + app servers; extract modules incrementally | ✅ Native horizontal scaling | ❌ Coupling blocks scaling past low six figures |
| **Team Coordination (10 experts)** | ✅ Module ownership, single repo, shared tooling | ⚠️ Requires strict API contracts, independent deploys | ❌ Everyone steps on everyone |
| **Operational Complexity (VPS)** | ✅ 1 app cluster + 1 DB cluster (manageable) | ❌ Service mesh, k8s, distributed tracing — overkill for VPS | ✅ Minimal |
| **Testing Cost** | ✅ In-process tests; cheap integration tests | ❌ Expensive contract/E2E tests per pair | ⚠️ Good until coupling sets in |
| **Data Consistency** | ✅ ACID transactions across contexts | ❌ Saga patterns, eventual consistency everywhere | ✅ ACID everywhere |
| **Evolutionary Flexibility** | ✅ Extract modules → services when metrics demand it | ⚠️ Locked into decomposition decisions early | ❌ Big ball of mud almost guaranteed |
| **Cold Start / Learning Curve** | ✅ New devs productive in 1-2 days | ❌ Weeks to understand service topology | ⚠️ Moderate |
| **Cost (Phase 1)** | ✅ VPS friendly | ❌ Needs k8s or multi-node clustering | ✅ Minimal |
| **Performance (latency)** | ✅ In-process calls, no network hop | ❌ Network hop between every service call | ✅ In-process |
| **Failure Isolation** | ⚠️ Module A crash = process crash (mitigated via queue + health checks) | ✅ Isolated blast radius | ❌ Worst — everything coupled |

### 3.2 Final Decision

> **✅ DECISION: Modular Monolith with Bounded Contexts as natural service-extraction boundaries.**

**Rationale:**
- The project explicitly targets **Hostinger VPS** for Phase 1 — microservices on raw VPS is a DevOps anti-pattern without Kubernetes.
- The Sponsor explicitly wants **no architectural rewrite** when scaling — modular monolith preserves extraction paths.
- The **10 expert accounts** working in parallel need independent ownership within a single codebase — modules give this.
- Shopify, GitHub, and Stack Overflow all grew to massive scale on modular monoliths before extracting services. There is no shame in this pattern. It is the correct Phase 1 choice.
- Each module = 1 Bounded Context = 1 future microservice. The Strangler-Fig pattern will be used to carve services out one at a time **when load testing proves a module is a bottleneck**.

**When will we revisit this decision?** → Trigger: any single module consumes >40% of DB resources OR >40% of API RPS, documented via 30 days of production metrics. At that point, ADR-003 "Microservice Extraction Trigger" is activated.

---

## 4. SYSTEM ARCHITECTURE — C4 MODEL

### 4.1 Level 1: System Context (C4-Context)

```
                        ┌─────────────────────────────────────────┐
                        │           END USERS & SYSTEMS            │
                        └─────────────────────────────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
  ┌──────────────┐          ┌──────────────────┐        ┌──────────────────┐
  │  Mobile App  │          │ Admin Dashboard │        │  3rd Party APIs  │
  │  (Flutter)   │          │    (React SPA)   │        │                  │
  │ iOS + Android│          │  Browser-based   │        │ • FCM (Push)     │
  └──────┬───────┘          └────────┬─────────┘        │ • Email (SMTP/   │
         │                           │                  │   SES/SendGrid)  │
         │  HTTPS/TLS 1.3            │  HTTPS/TLS 1.3   │ • CDN (Media)    │
         │  REST APIs + Token Auth   │  REST + Cookies   │ • Object Storage │
         ▼                           ▼                  │   (S3-compatible)│
  ┌─────────────────────────────────────────────────────┴──────────────────┐
  │                                                                         │
  │             MAJLIS AL-ALIM EDUCATIONAL PLATFORM (SYSTEM)             │
  │                                                                         │
  │  ┌─────────────────────────┐    ┌─────────────────────────────────┐    │
  │  │   API Gateway / Edge    │───▶│   Modular Monolith Backend      │    │
  │  │  (Nginx + TLS + WAF)    │    │   (NestJS)                      │    │
  │  └────────────┬────────────┘    │  ┌─────────┐ ┌───────────────┐  │    │
  │               │                 │  │  Core   │ │   Modules     │  │    │
  │               │                 │  │ Shared  │ │ (5 Bounded    │  │    │
  │               │                 │  │ Kernel  │ │  Contexts)    │  │    │
  │               │                 │  └─────────┘ └───────────────┘  │    │
  │               │                 └──────────────┬──────────────────┘    │
  │               │                                │                       │
  │               ▼                                ▼                       │
  │   ┌───────────────────┐           ┌───────────────────────┐            │
  │   │   Redis Cache     │           │   PostgreSQL          │            │
  │   │ (Sessions/Tokens/ │           │ (Primary Datastore)   │            │
  │   │  Rate Limit/Hot)  │           │ + Read Replicas (v2)  │            │
  │   └───────────────────┘           └───────────────────────┘            │
  │                                                                         │
  └─────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
                          ┌───────────────────────────┐
                          │  Infrastructure & DevOps  │
                          │ • Docker + Compose        │
                          │ • GitHub Actions CI/CD    │
                          │ • Uptime Kuma + /health   │
                          │ • Structured JSON logs    │
                          │ • Hostinger VPS (Linux)   │
                          └───────────────────────────┘
```

### 4.2 Level 2: Container View (C4-Container)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          HOSTINGER VPS (SINGLE NODE, PHASE 1)                │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                        DOCKER COMPOSE STACK                          │  │
│   │                                                                      │  │
│   │  ┌────────────┐       ┌────────────┐       ┌────────────────────┐   │  │
│   │  │   NGINX    │──────▶│    APP     │──────▶│   POSTGRESQL       │   │  │
│   │  │   Edge     │       │  NESTJS    │       │   Primary          │   │  │
│   │  │ + WAF      │       │  (Single   │       │   + WAL Archiving  │   │  │
│   │  │ + TLS 1.3  │       │   Process, │       │   + PgBouncer      │   │  │
│   │  │ + Rate     │       │   N Workers│       │   (pooling)        │   │  │
│   │  │   Limit    │       │   via PM2) │       │                    │   │  │
│   │  │ + Static   │       │            │       └──────────┬─────────┘   │  │
│   │  │   Assets   │       │  Port: 3000 │                  │             │  │
│   │  │            │       └─────┬──────┘                  │             │  │
│   │  │  Port: 80  │             │                         │             │  │
│   │  │  + 443 SSL  │             │                         │             │  │
│   │  └────────────┘             │                         │             │  │
│   │                             │                         │             │  │
│   │  ┌─────────────┐            │                         │             │  │
│   │  │    REDIS    │◀───────────┘                         │             │  │
│   │  │   Cache     │                                      │             │  │
│   │  │ + Pub/Sub   │◀─────────────────────────────────────┘             │  │
│   │  │ + Queues    │                                                    │  │
│   │  │ Port: 6379  │                                                    │  │
│   │  └─────────────┘                                                    │  │
│   │                                                                      │  │
│   │  ┌────────────────┐     ┌──────────────┐    ┌───────────────────┐   │  │
│   │  │  UPTIME KUMA   │────▶│  /health +   │    │ Structured JSON   │   │  │
│   │  │  Uptime/TLS/   │     │  /ready      │    │ logs → json-file  │   │  │
│   │  │  Alerts :3001  │     │ (terminus)   │    │ + logrotate       │   │  │
│   │  └────────────────┘     └──────────────┘    └───────────────────┘   │  │
│   │  (monitoring profile — single container, ~200–400MB; ADR-011)        │  │
│   │                                                                      │  │
│   │  ┌──────────────────────────────────────────────────────────────┐   │  │
│   │  │        ADMIN DASHBOARD (REACT SPA) — built as static files    │   │  │
│   │  │        Served by NGINX from /admin path                       │   │  │
│   │  └──────────────────────────────────────────────────────────────┘   │  │
│   │                                                                      │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│   ┌──────────────────────────────────────────────────────────────────────┐  │
│   │                  EXTERNAL VOLUMES (PERSISTENT)                       │  │
│   │   • /data/postgres   • /data/redis   • /data/backups                 │  │
│   │   • /data/media      • /var/log/majlis-alim                          │  │
│   └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.3 Level 3: Component View — Backend Monolith (C4-Component)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    NESTJS MODULAR MONOLITH (INTERNAL)                       │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                        PRESENTATION / API LAYER                       │  │
│  │   ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌───────────┐  │  │
│  │   │ Identity │ │ Content  │ │Engagement│ │  Notif.  │ │  Admin    │  │  │
│  │   │  REST    │ │  REST    │ │ REST/WS  │ │  REST    │ │ REST      │  │  │
│  │   │Controllers│ │Controllers│ │Controllers│ │Controllers│ │Controllers│ │  │
│  │   └─────┬────┘ └────┬────┘ └────┬────┘ └────┬────┘ └────┬──────┘  │  │
│  │         │            │           │           │           │          │  │
│  │  ┌──────┴────────────┴───────────┴───────────┴───────────┴──────┐   │  │
│  │  │            SHARED API PIPE & MIDDLEWARE KERNEL              │   │  │
│  │  │  Auth Guard | Rate Limit | Validation | Logging | trace_id  │   │  │
│  │  └──────────────────────────┬─────────────────────────────────┘   │  │
│  └─────────────────────────────┼─────────────────────────────────────┘  │
│                                │                                         │
│  ┌─────────────────────────────┼─────────────────────────────────────┐  │
│  │                      APPLICATION / USE CASE LAYER                │  │
│  │                                                                   │  │
│  │   Each Bounded Context Module:                                   │  │
│  │   ┌──────────────────────────────────────────────────┐           │  │
│  │   │  Module: Identity (IAM)                         │           │  │
│  │   │  • Auth Methods: email/OTP/Google/Apple/FB      │           │  │
│  │   │  • Commands: RegisterUser, Login, OtpChallenge,│           │  │
│  │   │                 OAuthExchange, Refresh, Revoke  │           │  │
│  │   │  • Queries:  Me, Session List, Role Matrix     │           │  │
│  │   │  • RBAC: 5 roles                                │           │  │
│  │   │    SuperAdmin/Admin/Editor/Moderator/User       │           │  │
│  │   └──────────────────────────────────────────────────┘           │  │
│  │                                                                   │  │
│  │   ┌───────────────────┐ ┌─────────────────────────────────────┐ │  │
│  │   │ Module: Content   │ │ Module: Engagement (Community)       │ │  │
│  │   │ & Media Library   │ │                                     │ │  │
│  │   │ • 4 Types only:   │ │ • Comments + Q&A per content item  │ │  │
│  │   │   Audio·PDF·Text  │ │ • User Activity history            │ │  │
│  │   │   ·Image (NO video)│ │ • Profile display/preferences      │ │  │
│  │   │ • Draft/Review/   │ │ • NO progress tracking, NO resume, │ │  │
│  │   │   Publish Workflow│ │   NO bookmarks (see ADR-012)       │ │  │
│  │   │ • i18n 5+ langs   │ └─────────────────────────────────────┘ │  │
│  │   │ • Taxonomy        │                                           │  │
│  │   │ (Categories/Tags)│                                           │  │
│  │   └───────────────────┘                                           │  │
│  │                                                                   │  │
│  │   ┌───────────────────────┐  ┌────────────────────────────────┐ │  │
│  │   │ Module: Notifications │  │ Module: Admin, Analytics & Ops│ │  │
│  │   │ • 3 Channels:         │  │                                │ │  │
│  │   │   FCM · Email · SMS   │  │ • User Mgmt (roles, suspend)  │ │  │
│  │   │ • Preferences/opt-out │  │ • Moderation queue            │ │  │
│  │   │ • Announcements       │  │ • Basic Analytics dashboard   │ │  │
│  │   │ • In-App Center       │  │ • Immutable Audit Log         │ │  │
│  │   └───────────────────────┘  └────────────────────────────────┘ │  │
│  └──────────────────────┬──────────────────────┬───────────────────┘  │
│                         │                      │                       │
│  ┌──────────────────────┴──────────────────────┴───────────────────┐  │
│  │                      DOMAIN / CORE LAYER                       │  │
│  │                                                                 │  │
│  │   THIS LAYER HAS ZERO EXTERNAL DEPENDENCIES                    │  │
│  │   • Bounded Context: Identity → User, Role, Permission, Session,│  │
│  │   │                                RefreshToken, OtpChallenge  │  │
│  │   • Bounded Context: Content → ContentItem, ContentTranslation,│  │
│  │   │       MediaAsset, Category (tree), Tag, Author              │  │
│  │   • Bounded Context: Engagement → Comment, QuestionAnswer,     │  │
│  │   │       Answer, UserActivity (NO progress, NO bookmarks)     │  │
│  │   • Bounded Context: Notifications → Notification, Device,     │  │
│  │   │       NotificationPreference, Announcement                 │  │
│  │   • Bounded Context: Admin → AuditLogEntry, ModerationAction,  │  │
│  │   │       SystemConfigFlag, ReportDefinition                   │  │
│  │   • Domain Events: UserRegistered, ContentPublished,           │  │
│  │   │       CommentPosted, QuestionAnswered, NotificationQueued  │  │
│  │   • Value Objects: EmailAddress, PhoneNumberE164, PasswordHash,│  │
│  │   │                   UUIDv7, IsoLocale, MediaByteSize         │  │
│  │   • Repository Interfaces (no implementations!) — one per Aggregate│
│  └──────────────────────────────┬──────────────────────────────────┘  │
│                                 │                                     │
│  ┌──────────────────────────────┴──────────────────────────────────┐  │
│  │                  INFRASTRUCTURE / ADAPTERS LAYER               │  │
│  │                                                                 │  │
│  │   ┌─────────────────────┐  ┌─────────────────────────────┐     │  │
│  │   │  Persistence        │  │  External Service Adapters  │     │  │
│  │   │  (TypeORM Repos)   │  │  • Auth Providers:          │     │  │
│  │   │  • tables across    │  │     Google / Apple / FB /   │     │  │
│  │   │     5 BCs           │  │     EmailPass / SMS OTP     │     │  │
│  │   │                     │  │  • FCM Push Notifications   │     │  │
│  │   │                     │  │  • Email Provider adapter   │     │  │
│  │   │                     │  │    (SMTP/SendGrid/Mailgun)  │     │  │
│  │   │                     │  │  • SMS Provider adapter     │     │  │
│  │   │                     │  │    (Twilio/Msg91/Infobip)   │     │  │
│  │   │                     │  │  • S3-compatible Obj Storage│     │  │
│  │   │                     │  │    (ADR-013; env-configured)│     │  │
│  │   └─────────────────────┘  └─────────────────────────────┘     │  │
│  │                                                                 │  │
│  │   ┌────────────────────────┐  ┌────────────────────────────┐   │  │
│  │   │  Caching (Redis)       │  │  Event Bus (Internal +     │   │  │
│  │   │  • Cache-aside         │  │    Redis Pub/Sub v2)       │   │  │
│  │   │  • Write-through plan  │  │  • In-process event bus    │   │  │
│  │   └────────────────────────┘  └────────────────────────────┘   │  │
│  └─────────────────────────────────────────────────────────────────┘  │
│                                                                         │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  CROSS-CUTTING CONCERNS (SHARED KERNEL - USED BY ALL LAYERS)    │    │
│  │  • Logging (pino → structured JSON → Docker json-file)          │    │
│  │  • Correlation (trace_id middleware; OTel-shaped port)          │    │
│  │  • Health/Readiness (@nestjs/terminus → /health + /ready)       │    │
│  │  • Validation (class-validator / Zod)                           │    │
│  │  • Serialization (class-transformer)                            │    │
│  │  • Exception Handling (Global Filters)                          │    │
│  │  • Configuration (@nestjs/config + env validation)              │    │
│  │  • Date/Time (Luxon — NEVER the native Date API)                │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. BOUNDED CONTEXT MAP (DDD STRATEGIC DESIGN) — v1.1.0

This is one of the most important sections. Misaligned boundaries cause 80% of maintenance pain. **This is the canonical 5-context model** (courses/quizzes removed; progress-tracking and bookmarks removed per binding Sponsor decision; Analytics merged into Admin).

| Bounded Context | Module Folder | Upstream Contexts | Relationship Type | Primary Aggregate(s) |
|-----------------|---------------|-------------------|-------------------|----------------------|
| **[BC01] Identity & Access** | `modules/identity` | None (foundational; anti-corruption layer for 3p auth providers) | Core Kernel (shared user_id) | User, Role, Permission, Session, RefreshToken, OtpChallenge, SocialIdentity |
| **[BC02] Content & Media Library** | `modules/content` | Identity (for author_id, last_editor_id audit fields) | Published Language | ContentItem, ContentTranslation, MediaAsset, Category (nested set tree), Tag, AuthorReference |
| **[BC03] Engagement (Community)** | `modules/engagement` | Identity (userId), Content (contentId), both via events + read-optimized views | Upstream-Downstream | UserActivity, Comment (threaded), Question (Q&A thread), Answer (moderator/editor reply). **NO progress, NO bookmarks.** |
| **[BC04] Notifications** | `modules/notifications` | Identity (userId, device tokens), Content (Published event), Engagement (Comment/QA events) | Separated Way — ONLY async events; NO synchronous calls | Notification, UserDevice (FCM token), NotificationPreference, Announcement, SmsMessageLog, EmailMessageLog |
| **[BC05] Administration, Analytics & Ops** | `modules/admin` | ALL (read-only consumer of events from every BC) + Identity for auth | Big Ball of Mud Consumer (eventual consistency, read-model optimized). Writes: admin-initiated actions audited. | AuditLogEntry, ModerationAction, SystemConfigFlag, AnalyticsDailyRollup (materialized) |

### Cross-Boundary Communication Rules (ENFORCED)

```
✅ ALLOWED:   Domain events published on internal Event Bus, subscribed via handlers
✅ ALLOWED:   Internal NestJS CQRS QueryBus to ANOTHER module's *Query* only (no Commands!)
✅ ALLOWED:   Read-only database views that JOIN across contexts — VIEWS ONLY, not direct table joins
✅ ALLOWED:   API Gateway aggregates responses from multiple modules in one HTTP call
❌ FORBIDDEN: Direct import/instantiation of another module's Repository or Service class
❌ FORBIDDEN: Raw SQL SELECT joining tables from different bounded-context schemas
❌ FORBIDDEN: Shared mutable database tables between modules; each table OWNED by exactly 1 BC
```

Boundary enforcement is CI-gated via `@nx/enforce-module-boundaries` (ADR-014) mapping one `scope:*` tag per Bounded Context.

### Schema Separation Strategy

For Phase 1 (VPS): Use **table prefix naming convention enforced in TypeORM entities**:
- `id_*` = BC01 Identity tables
- `ct_*` = BC02 Content tables
- `eg_*` = BC03 Engagement tables
- `nt_*` = BC04 Notifications tables
- `ad_*` = BC05 Admin/Analytics tables

Future extraction: Split to separate physical databases by schema prefix = 1 mechanical move per module, zero code rewrite required beyond DB host env var per extracted service.

---

## 6. DEPLOYMENT ARCHITECTURE

### 6.1 Phase 1: Single VPS, Docker Compose (Target: 1,000–5,000 users, first 6 months)

```
┌───────────────────────────────────────────────────────────┐
│                  HOSTINGER VPS (PHASE 1 SPECS)             │
│  • 2 vCPU                                                  │
│  • ~4 GB RAM                                               │
│  • ~200 GB NVMe SSD                                        │
│  • Ubuntu 24.04 LTS                                        │
│  • 1 Gbps network interface                                │
└───────────────────────────────────────────────────────────┘
```

> The architecture **enables** growth to hundreds of thousands of users without rewrite (extraction paths preserved). Larger resources below are **provisioned only when metrics demand it** — not day-one.

### 6.2 Phase 2: Vertical Scale + Read Replica (Target: tens of thousands of users)

- Upgrade VPS: more vCPU + RAM as load dictates, larger NVMe
- Add PostgreSQL read replica on a second VPS
- Read-heavy endpoints (content browse, analytics queries) hit replica

### 6.3 Phase 3: First Service Extraction (Target: hundreds of thousands of users)

- Identify hottest module via profiling (likely Notifications, Admin/Analytics, or Engagement)
- Extract to independent NestJS microservice behind internal gRPC
- Strangler-Fig: route specific traffic to new service
- This is why we preserved module boundaries from Day 1

### 6.4 Disaster Recovery Topology

- **Backup Strategy**: PostgreSQL continuous WAL archiving to object storage (S3-compatible or Hostinger backup)
- **Snapshot Frequency**: Daily full backup + incremental every 6 hours
- **Retention**: 30 days daily, 12 monthly
- **Restore Test**: Monthly automated restore drill to staging environment
- **RPO**: ≤ 1 hour (WAL archive)
- **RTO**: ≤ 4 hours (manual failover in Phase 1, automated in Phase 2)

---

## 7. TECHNOLOGY STACK (FULL MATRIX)

### 7.1 Backend (NestJS)

| Layer | Technology | Version Target | Rationale (why this, not alternatives) |
|-------|-----------|----------------|----------------------------------------|
| Runtime | Node.js | 20.x LTS (Hydrogen) | LTS support, NestJS optimized, V8 performance |
| Framework | NestJS | 10.x+ | Native TypeScript, modular architecture alignment, DI container, opinionated structure perfect for Clean Architecture |
| Language | TypeScript | 5.4+ strict mode | Type safety catches bugs at compile time; strict mode enforced |
| ORM | TypeORM | 0.3.x | Best integration with NestJS, repository pattern, migrations, supports clean separation (ADR-006) |
| Validation | Zod + class-validator | Latest | Zod for API boundary validation, class-validator for DTOs — defense in depth |
| API Format | REST (JSON:API conventions) | — | Simpler, better cacheability than GraphQL for Phase 1. GraphQL gateway is an optional v2 upgrade path. (ADR-004) |
| API Docs | OpenAPI 3.1 / Swagger | via @nestjs/swagger | Auto-generated from code, always in sync |
| Authentication | JWT (access token) + rotating refresh tokens | RS256 signing | Short-lived access tokens (15 min), rotated refresh tokens (7 days), stored HttpOnly or in Redis session (ADR-008) |
| Authorization | CASL + NestJS RBAC guards | — | Attribute-based access control over the 5 roles when needed beyond basic role checks |
| Event Bus | Custom in-process bus (with Redis adapter ready) | — | Module boundaries clean; can swap for BullMQ / Kafka without app change |
| Job Queue | BullMQ (Redis-backed) | — | Delayed jobs, retries, scheduled tasks. Critical for notifications, media processing. |
| Logging | pino (structured JSON) | → Docker json-file + logrotate | Structured JSON logs under `/var/log/majlis-alim`; grep/jq-queryable; ADR-011 |
| Health/Readiness | @nestjs/terminus | → /health + /ready | Liveness/readiness probes polled by Uptime Kuma; ADR-011 |
| Correlation | trace_id middleware (OTel-shaped port) | → log fields | Per-request `trace_id`; OTel-shaped `ObservabilityPort` so a full LGTM stack can be adopted later with **zero business-logic change**; ADR-011 |
| Testing (Unit) | Jest | — | Default for NestJS, excellent TypeScript support |
| Testing (E2E) | Supertest + Jest | — | Native NestJS integration |
| Testing (Load) | k6 | — | Scriptable load testing; CLI + JSON output, no dashboard dependency required |
| Security Headers | Helmet.js | Latest | OWASP secure headers baseline |
| Rate Limiting | @nestjs/throttler (Redis store) | — | Prevent abuse; Redis store so cluster-aware |

### 7.2 Database & Caching

| Purpose | Technology | Version | Rationale |
|---------|-----------|---------|-----------|
| Primary OLTP | PostgreSQL | 16.x | Best-in-class relational DB, JSON support, partitioning, window functions, MVCC. **Do NOT use MySQL.** (ADR-005) |
| Connection Pool | PgBouncer | Latest | Mandatory before Node connection pools exhaust Postgres' process limit |
| Session / Token Store | Redis | 7.x | O(1) lookups, TTL-based expiry, atomic operations for rate limiting |
| Query Result Cache | Redis | 7.x | Cache-aside pattern for read-heavy content queries |
| Pub/Sub | Redis Pub/Sub | 7.x | Phase 1 async; upgrade to Redis Streams or Kafka if throughput demands |
| Full-Text Search | PostgreSQL tsvector + GIN indexes | Built-in | Phase 1: Postgres FTS is excellent at this scale. Meilisearch/Elasticsearch deferred. |

### 7.3 Frontend — Admin Dashboard (React)

| Concern | Technology | Version | Rationale |
|---------|-----------|---------|-----------|
| Framework | React | 18.x (canary for 19 if stable) | Industry standard, massive ecosystem, SPA requirements met |
| Meta-framework | Vite (not Next.js) | 5.x | Dashboard is pure SPA — SSR is unnecessary overhead. Vite builds faster than any bundler today. |
| Language | TypeScript | 5.4+ strict | Same rationale as backend — type safety |
| UI Library | Ant Design (antd) | 5.x | Best admin/enterprise React component library, accessible, data tables out of the box |
| State Mgmt | Zustand + TanStack Query (@tanstack/react-query v5) | — | Zustand for UI state, React Query for server state — modern best-practice combo. No Redux. (ADR-010) |
| Forms | React Hook Form + Zod resolver | — | Lightweight, performant, Zod validation alignment with backend |
| Routing | React Router | 6.x | Industry standard, data router support for v6.4+ |
| Charts | Recharts or Apache ECharts | Latest | Analytical dashboards need good charts; ECharts if more advanced visuals required |
| Table | Ant Design Table + TanStack Table core | — | Data-heavy admin needs virtualized, sortable, filterable tables |
| HTTP Client | Axios (with interceptor for auth) | — | Retry, interceptors, request cancellation |
| Styling | Tailwind CSS 3 | 3.x | Utility-first, zero-runtime, composable; pair with antd via theme customization |
| Testing | Vitest + Testing Library + Playwright (E2E) | — | Vitest = fast Jest drop-in; Playwright = best browser E2E |

### 7.4 Mobile (Flutter)

| Concern | Technology | Version | Rationale |
|---------|-----------|---------|-----------|
| Framework | Flutter | 3.22+ (stable channel) | Required by project constraints; Skia rendering, single codebase |
| Language | Dart | 3.4+ (sound null safety) | Native to Flutter, mature type system |
| State Management | Riverpod 2.x | 2.x | Provider replacement — official recommendation, compile-time safety, testable (ADR-009) |
| Routing | go_router | 13.x+ | Official Flutter routing; declarative, deep-link support |
| Local Persistence | Isar | 3.x+ | Fast NoSQL local DB, Dart-native, offline Arabic FTS + catalog queries; ADR-012 |
| HTTP Client | Dio | 5.x+ | Interceptors, FormData, good error handling; better than http package |
| Authentication | flutter_secure_storage + JWT | — | Secure storage for tokens on device (Keychain / Keystore) |
| Notifications | firebase_messaging | Latest | FCM is explicit project requirement |
| Audio Player | just_audio + audio_service | — | Background playback, Android Auto / CarPlay hooks (audio is a core content type) |
| PDF Viewer | pdfx / Syncfusion PDF viewer | Latest | Render downloaded PDF/Book content (core content type) |
| Offline Support | Isar + connectivity_plus + workmanager | — | Queue offline actions, replay on connectivity restore; offline downloaded content |
| App Architecture | Riverpod + Feature-first Clean Architecture | — | Feature-sliced vertical slices; no `lib/widgets/` or `lib/models/` mega-folders |
| Dependency Injection | Riverpod (DI via providers) | — | Native to Riverpod; no get_it needed |
| Testing | flutter_test + mocktail + patrol (E2E) | — | Mocktail over mockito; patrol for robust native E2E |
| Environment | flutter_dotenv + --dart-define | — | Never hardcode secrets or domains; flavor support (API_DOMAIN env-configured) |

> **NO video.** Content types are strictly **Audio · PDF/Book · Text · Image** — there is no video player in the stack.

### 7.5 DevOps & Infrastructure

| Concern | Technology | Rationale |
|---------|-----------|-----------|
| Container Runtime | Docker Engine (24.x+) | Standard container runtime |
| Orchestration (Phase 1) | Docker Compose | VPS-friendly; no K8s needed. Declarative, reproducible environments. (ADR-007) |
| Orchestration (Phase 3) | Kubernetes (k3s if self-hosted) | When service extraction mandates orchestration |
| CI/CD | GitHub Actions | Free for public repos, generous for private. Native YAML, excellent Docker support. |
| Monorepo Tooling | Nx 19+ | Affected builds, remote cache, generators, boundary enforcement (ADR-014) |
| Container Registry | GitHub Container Registry (ghcr.io) | Integrated with Actions; or Docker Hub |
| Reverse Proxy | Nginx (latest stable) | Static serving, TLS termination, WAF via ModSecurity, rate limiting, gzip/brotli |
| TLS | Let's Encrypt (Certbot, auto-renewal) | Free, industry standard |
| Process Manager (inside container) | PM2 (cluster mode) | Node.js process clustering, auto-restart, load balancing across cores |
| Infrastructure Config | Docker Compose + Shell Scripts + env files | Phase 1: Terraform deferred (no multi-cloud yet). ADR-007 tracks. |
| Secret Management | Doppler or env files (never committed) | Phase 1 local: .env files in .gitignore; domains/keys env-configured, never hardcoded |
| Monitoring (Uptime) | Uptime Kuma (single container, ~200–400MB) | Uptime + TLS-expiry + alerting; polls /health + /ready; ADR-011 |
| Monitoring (Logs) | Structured JSON (pino) → Docker json-file + logrotate | grep/jq-queryable; **no Loki/ELK in Phase 1**; ADR-011 |
| Health Checks | @nestjs/terminus → /health + /ready | Liveness + readiness endpoints |
| Alerting | Uptime Kuma → Email + Telegram | Budget-conscious; the full LGTM stack is a **deferred Phase-2+ upgrade** (ADR-011) |
| Disk Backup | BorgBackup (dedup, encrypted, incremental) + rclone to object storage | Best backup tool for self-hosted |

---

## 8. FOLDER STRUCTURE (MONOREPO)

```
majlis-alim/
├── docs/                                    # ← CURRENT DOCUMENTATION
│   ├── PROJECT_CHARTER.md
│   ├── architecture/
│   │   ├── ARCHITECTURE_VISION.md           # ← THIS FILE
│   │   ├── C4-MODEL.md
│   │   ├── API-DESIGN.md
│   │   ├── DB-SCHEMA.md
│   │   └── adr/
│   │       ├── ADR-001-architecture-pattern-modular-monolith.md
│   │       ├── ADR-002-bounded-context-map-5-modules.md
│   │       └── ADR-0NN-*.md
│   └── governance/
│       ├── TECHNICAL_GOVERNANCE.md
│       ├── CODE-STANDARDS.md
│       └── SECURITY-BASELINE.md
│
├── apps/                                    # NX MONOREPO: executable apps
│   ├── backend/                             # NestJS Modular Monolith
│   │   ├── src/
│   │   │   ├── main.ts                      # ENTRYPOINT
│   │   │   ├── app.module.ts
│   │   │   │
│   │   │   ├── shared/                      # Shared Kernel (Cross-Cutting)
│   │   │   │   ├── domain/                  # Domain primitives: UUID, VO base, etc.
│   │   │   │   ├── infrastructure/          # Logging, health, config, trace_id
│   │   │   │   └── presentation/            # Guards, interceptors, filters shared
│   │   │   │
│   │   │   └── modules/                     # 5 BOUNDED CONTEXTS (each = own layer triad)
│   │   │       ├── identity/                # BC01: Identity & Access
│   │   │       │   ├── domain/              # ⟵ PURE: entities, VOs, domain events, repo IFACES
│   │   │       │   ├── application/         # Use cases: commands, queries, handlers, DTOs
│   │   │       │   ├── infrastructure/      # Repo impls, external adapters
│   │   │       │   ├── presentation/        # REST controllers
│   │   │       │   └── identity.module.ts
│   │   │       ├── content/                 # BC02: Content & Media Library
│   │   │       │   └── (same layer triad)
│   │   │       ├── engagement/              # BC03: Engagement (Community)
│   │   │       ├── notifications/           # BC04: Notifications
│   │   │       └── admin/                   # BC05: Administration, Analytics & Ops
│   │   │
│   │   ├── test/                            # E2E tests, fixture setup
│   │   ├── migrations/                      # TypeORM migrations (ordered, immutable)
│   │   └── Dockerfile
│   │
│   ├── admin/                               # React SPA (admin dashboard)
│   │   ├── src/
│   │   │   ├── app/                         # Routes, providers, global styles
│   │   │   ├── pages/                       # Page-level feature containers
│   │   │   ├── features/                    # Feature slices: each = state + UI + API
│   │   │   │   ├── auth/
│   │   │   │   ├── users/
│   │   │   │   ├── content/
│   │   │   │   └── analytics/
│   │   │   ├── shared/                      # UI kit, hooks, utilities, API client
│   │   │   └── main.tsx
│   │   └── Dockerfile
│   │
│   ├── mobile/                              # FLUTTER APP
│   │   (The Flutter application, structured to
│   │    feature-first Clean Architecture — ADR-009)
│   │
│   └── docs-site/                           # Docusaurus documentation site
│
├── libs/                                    # NX MONOREPO: shared packages
│   ├── shared-ts-types/                     # Shared DTO/type definitions (TypeScript)
│   ├── shared-ts-api-client/                # TS REST client generated from OpenAPI
│   ├── dart-api-client/                     # Shared Dart HTTP client for mobile
│   ├── shared-i18n-assets/                  # i18n translation JSON (AR/EN/FR/UR/MS)
│   ├── shared-eslint-config/                # Shared lint rules (@majlis-alim/eslint-config)
│   └── tsconfig/                            # Shared TypeScript base config
│
├── infra/                                   # Infrastructure-as-Code
│   ├── docker/
│   │   ├── compose.yaml                     # Dev + local full stack
│   │   ├── compose.prod.yaml                # Production overrides
│   │   ├── nginx/
│   │   │   ├── Dockerfile
│   │   │   └── conf.d/
│   │   └── uptime-kuma/
│   │       └── kuma-data/                   # Uptime Kuma persistent config (monitors, alerts)
│   ├── scripts/                             # Deploy, backup, restore, DB migration
│   └── monitoring/                          # Uptime Kuma compose profile + logrotate config
│
├── .github/workflows/                       # CI/CD pipelines
│   ├── ci.yml                               # nx affected: lint + test + build on every PR
│   ├── cd-staging.yml                       # Deploy to staging on main push
│   └── cd-production.yml                    # Manual production deploy (tag triggered)
│
├── nx.json                                  # Nx monorepo config (task runner, caching)
├── package.json                             # Root workspace package.json (@majlis-alim scope)
├── tsconfig.base.json                       # Root TS config
├── .prettierrc                              # Code formatting rules (single source of truth)
├── .editorconfig
├── eslint.config.js                         # Root lint config (extended by libs/*)
└── .gitignore
```

---

## 9. PERFORMANCE ARCHITECTURE

### 9.1 Performance Anti-Patterns to Prevent

These are the top 10 mistakes that kill platform performance. We will **explicitly prevent** every one.

| # | Anti-Pattern | Mitigation / Enforcement |
|---|--------------|--------------------------|
| 1 | N+1 queries | TypeORM `relations` check in PR template, perf test in CI for hot endpoints |
| 2 | `SELECT *` | Explicit column selection; custom DTO queries via QueryBuilder |
| 3 | No DB indexes on WHERE columns | Migration checklist: every WHERE clause → verify via EXPLAIN ANALYZE |
| 4 | Unbounded lists (no pagination) | API hard enforcement: default limit 20, max 100; cursor pagination preferred |
| 5 | Blocking the Node.js event loop | CPU-intensive jobs → BullMQ worker processes, never in API handler |
| 6 | Cache stampede | Redis distributed locks, staggered TTL jitter, warm-up strategy |
| 7 | Upload/download without streaming | Media uploads → stream to object storage directly (no disk buffer, no memory buffer) |
| 8 | Synchronous JSON deep stringify/parse | `fast-json-stringify` on hot paths; Zod strict schemas validate once at boundary |
| 9 | Large payloads over REST | Compression (gzip/brotli) enforced; payload > 10KB triggers architecture review |
| 10 | Flutter build without tree-shaken assets | `flutter_lints` + strict asset pubspec rules |

### 9.2 Caching Strategy (Multi-Level)

```
Level 1: Flutter Client Cache (Isar)
  → Offline downloaded content, preferences, offline catalog + Arabic FTS index
  → TTL per content type

Level 2: HTTP Cache (Nginx)
  → Static assets (JS bundles, images, fonts)
  → Cache-Control headers with content-hash filenames for immutable caching

Level 3: CDN Cache (Cloudflare or equivalent)
  → Media files (audio/images/PDF)
  → TTL: 7 days minimum; purged by API on content update

Level 4: Application-level Redis Cache
  → Cache-aside pattern: hot content (content list, public profile), DB query results
  → TTL: Short (1-5 min) for dynamic; longer (1-4 hours) for static
  → Invalidation: Domain events trigger explicit cache delete

Level 5: PostgreSQL Buffer Pool (Memory)
  → Sufficient shared_buffers to keep working set in memory
  → pg_stat_statements to find slow queries weekly
```

---

## 10. SECURITY ARCHITECTURE

### 10.1 OWASP Top 10 Baseline Mitigations

| OWASP Top 10 | Mitigation (Built-in Architecture, Not Optional) |
|--------------|--------------------------------------------------|
| **A01: Broken Access Control** | RBAC (5 roles) + CASL on every endpoint; default deny; integration tests for negative cases (unauthorized access MUST fail) |
| **A02: Cryptographic Failures** | TLS 1.3 only; HSTS; AES-256-GCM for PII at rest; bcrypt/argon2 for passwords (cost factor tuned); secrets never in code |
| **A03: Injection** | Parameterized queries only (TypeORM prevents this but NO raw SQL without explicit review); Zod + class-validator on every input boundary; output encoding |
| **A04: Insecure Design** | Threat modeling per bounded context; security architecture review checklist on every PR; feature flags for gradual rollout |
| **A05: Security Misconfiguration** | Hardened Nginx config; Helmet.js; latest dependencies via Renovate/Dependabot; immutable infra via Docker |
| **A06: Vulnerable & Outdated Components** | `npm audit` blocking CI; Snyk or equivalent scanning; automated minor/patch upgrades |
| **A07: Identification & Authentication Failures** | MFA available; password policy (12+ chars, no common, breach database check via HaveIBeenPwned optional); brute-force lockout via rate limit + Redis; refresh token rotation + detection; session revocation |
| **A08: Software & Data Integrity Failures** | Signed Docker images; signed commits; integrity hash checks on dependency install; backup encryption with HMAC |
| **A09: Security Logging & Monitoring Failures** | Structured audit logs (who did what, when, IP, user agent); centralized; 90+ day retention; alerts on security events (5 failed logins, admin login from new IP, etc.) |
| **A10: Server-Side Request Forgery** | URL allowlist; egress firewall rules; metadata service blocked; DNS rebinding protection |

### 10.2 User Data Protection Model

```
┌───────────────────────────────────────────────────────────────┐
│                    DATA CLASSIFICATION MATRIX                  │
├──────────────┬──────────────────┬──────────────────────────────┤
│ Class        | Examples         | Handling Requirement         │
├──────────────┼──────────────────┼──────────────────────────────┤
│ Public       | Content catalog  │ No restrictions; CDN cache OK│
│ Internal     | Audit logs       │ Access: admin + security only│
│ Confidential | Email, name, DOB │ AES-256-GCM at rest; TLS only│
│ Restricted   | Password hashes  │ KMS-wrapped keys; db_column  │
│              |                  │ encryption; NEVER log these  │
└──────────────┴──────────────────┴──────────────────────────────┘
```

---

## 11. ARCHITECTURALLY SIGNIFICANT DECISIONS — ADR INDEX

Every decision below is documented in a standalone ADR file with alternatives considered and rationale. **All 14 ADRs are ACCEPTED as of the Phase 0 consolidation (2026-08-09).**

| ADR ID | Decision Title | Status |
|--------|---------------|--------|
| ADR-001 | Architecture Pattern: Modular Monolith over Microservices for Phase 1 | 🟢 ACCEPTED |
| ADR-002 | Bounded Context Map (5 contexts, boundaries defined) | 🟢 ACCEPTED |
| ADR-003 | Microservice Extraction Trigger Criteria (40% threshold) | 🟢 ACCEPTED |
| ADR-004 | API Style: REST + JSON:API over GraphQL/gRPC for Phase 1 | 🟢 ACCEPTED |
| ADR-005 | Database: PostgreSQL 16 over MySQL | 🟢 ACCEPTED |
| ADR-006 | ORM: TypeORM over Prisma over Drizzle | 🟢 ACCEPTED |
| ADR-007 | IaC: Docker Compose + Shell Scripts over Terraform for Phase 1 | 🟢 ACCEPTED |
| ADR-008 | Auth: JWT RS256 + Refresh Token Rotation over Sessions/OPAQUE | 🟢 ACCEPTED |
| ADR-009 | State Management: Riverpod 2.x over Bloc/Provider (Flutter) | 🟢 ACCEPTED |
| ADR-010 | State Management: Zustand + TanStack Query over Redux (React) | 🟢 ACCEPTED |
| ADR-011 | Observability: Lightweight Monitoring (Uptime Kuma + /health + /ready + structured JSON logs) | 🟢 ACCEPTED |
| ADR-012 | Mobile Local Storage: Isar over Hive/sembast | 🟢 ACCEPTED |
| ADR-013 | Media Storage: S3-compatible object storage over filesystem | 🟢 ACCEPTED |
| ADR-014 | Monorepo Tooling: Nx over Turborepo over Lerna | 🟢 ACCEPTED |

---

## 12. RISK ANALYSIS (ARCHITECTURE-SPECIFIC)

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **VPS single-node = SPOF** | Critical | Medium | Multi-node target for Phase 2; automated failover scripts, warm standby snapshot |
| **Module boundaries leak over time** | High | High | `@nx/enforce-module-boundaries` CI gate; explicit cross-module ADR-002 violation detector |
| **PostgreSQL write saturation** | Medium | Low | PgBouncer + connection limits; horizontal read replicas; write-optimized schema |
| **FCM vendor lock-in** | Low | Medium | Abstract notification adapter; allow swap to OneSignal/Expo Push |
| **NestJS monorepo build time creep** | Medium | High | Nx caching; incremental builds; per-module test parallelization (ADR-014) |
| **Media storage costs underestimated** | Medium | Medium | CDN offload; aggressive compression; lifecycle policies (old media → cold storage) |
| **Mobile app + backend version skew** | High | Medium | API versioning (/api/v1, /api/v2) with backwards-compatible 6-month window |

---

## 13. EVOLUTIONARY ARCHITECTURE ROADMAP

This architecture is not static. It will evolve in controlled stages:

```
[NOW]         Phase 0: Documentation & Decisions (we are here)
    ▼
[~WEEK 2-3]   Phase 1: Monorepo setup, CI, Identity, lightweight monitoring
    ▼
[~WEEK 8-14]  Phase 2: Content module + Media Library
    ▼
[~WEEK 14-20] Phase 3: Engagement + Notifications + Admin
    ▼
[~WEEK 20-27] Phase 4: Hardening, Launch 🚀
    ▼
[MONTH 6]     Architecture Review: Is modular monolith sufficient?
    │         → Trigger: Are any modules >40% of load?
    ├─ NO → Continue optimizing monolith
    └─ YES → Strangler-Fig: extract hottest module → independent service
    ▼
[MONTH 12]    Infrastructure upgrade (metrics-driven):
              • PostgreSQL read replica + PgBouncer
              • Optional: k3s Kubernetes
              • Optional: Meilisearch search backend
              • Optional: full LGTM observability stack (ADR-011 upgrade)
              • Possibly: Event-driven architecture using Redis Streams / Kafka
```

---

## 14. FINAL DECISION SUMMARY

| # | Decision | Status |
|---|----------|--------|
| D-01 | **Modular Monolith** (not microservices, not layered monolith) | ✅ Final, documented in ADR-001 |
| D-02 | **NestJS + TypeScript strict + TypeORM** backend | ✅ Final |
| D-03 | **PostgreSQL 16 + Redis 7** data layer | ✅ Final |
| D-04 | **Nx monorepo** (backend + admin + mobile + shared libs) | ✅ Final |
| D-05 | **Docker Compose** on Hostinger VPS (no Kubernetes Phase 1) | ✅ Final |
| D-06 | **REST APIs** (JSON:API conventions) + OpenAPI 3.1 | ✅ Final |
| D-07 | **Clean Architecture** (4 concentric layers, domain-centric) | ✅ Final |
| D-08 | **DDD Bounded Contexts** (5 contexts, explicit Context Map) | ✅ Final |
| D-09 | **Lightweight Monitoring** (Uptime Kuma + /health + /ready + structured JSON logs) | ✅ Final |
| D-10 | **Security Defaults:** OWASP Top 10, TLS 1.3, JWT + rotating refresh, audit logging | ✅ Final |

All decisions above are **binding on all expert accounts**. No implementation work begins until:
1. Project Charter approved
2. This Architecture Vision approved
3. All ADRs finalized and linked
4. Phase 1 plan explicitly approved

---

## CHANGE LOG

| Version | Date | Author | Change Description |
|---------|------|--------|--------------------|
| 1.0.0 | 2026-08-07 | Chief Software Architect | Initial draft with C4 + Stack + Boundaries |
| 1.1.0 | 2026-08-09 | Chief Software Architect | Phase 0 consolidation: renamed to **Al-Fajr**; canonical **5 Bounded Contexts** (identity/content/engagement/notifications/admin); removed progress-tracking & bookmarks; **5 RBAC roles** (SuperAdmin/Admin/Editor/Moderator/User); removed video (Audio/PDF/Text/Image only); scale re-based to 1,000–5,000 users with rewrite-free growth path; Hostinger VPS specs (2 vCPU / ~4GB / ~200GB); **lightweight monitoring** (Uptime Kuma + /health + /ready + JSON logs) replacing OLGT/Prometheus/Grafana/Loki/Tempo; folder tree `al-fajr/` + `@al-fajr` scope; all 14 ADRs marked ACCEPTED; document APPROVED. |

---

> **STATUS: 🟢 APPROVED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)**
