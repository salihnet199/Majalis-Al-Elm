# PROJECT CHARTER
# ميثاق المشروع

| Field | Value |
|-------|-------|
| Project Name | Majlis Al-Alim (مجالس العالم) — Educational & Religious Platform |
| Project Code | AF-EDU-001 |
| Version | 1.2.0 |
| Status | 🟢 APPROVED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09) |
| Created Date | 2026-08-07 |
| Last Updated | 2026-08-09 |
| Author | Chief Software Architect |
| Input From | Sponsor Stakeholder Questionnaire Round 1 + Consolidated Sponsor Decision (2026-08-09) |

---

## 1. EXECUTIVE SUMMARY

This document formally authorizes the existence of the **Majlis Al-Alim (مجالس العالم)** Educational & Religious Platform project. It defines the project's purpose, objectives, scope, stakeholders, high-level requirements, and the authority granted to the project team.

The project delivers an educational and religious platform consisting of a native mobile application (Flutter), a modern admin dashboard (React), and a robust backend (NestJS). The Phase 1 launch targets a **modest, focused audience of 1,000–5,000 users within the first six months**, on a single cost-conscious VPS. The architecture is deliberately designed so that growth to **hundreds of thousands of users** is a **rewrite-free scaling path** (stateless services, modular monolith with a documented Strangler-Fig extraction trigger) — capability that is **enabled by design, not provisioned on day one**.

---

## 2. PROJECT PURPOSE & JUSTIFICATION

### 2.1 Business Drivers

| # | Driver | Description |
|---|--------|-------------|
| 1 | Accessible Da'wah & Education | Deliver high-quality educational and religious content to a focused audience across geographic boundaries |
| 2 | Modern User Experience | Provide a seamless, intuitive mobile-first experience that meets today's consumer expectations |
| 3 | Operational Efficiency | Enable administrators and content creators to manage the platform efficiently through a dedicated control panel |
| 4 | Future-Proof Investment | Build an architecture that can evolve and scale with demand, avoiding costly re-engineering |
| 5 | Sound Data Foundation | Establish a clean, well-modeled data foundation for future reporting and continuous improvement |

### 2.2 Business Objectives

```
OBJECTIVE-001: Achieve a minimum viable platform (MVP) ready for production launch
  → Target: End-to-end core functionality, security, and performance validated

OBJECTIVE-002: Support 1,000-5,000 registered users within the first six months
  → Architectural baseline: rewrite-free path to hundreds of thousands of users
    (stateless services + Strangler-Fig extraction trigger documented in ADR-003)

OBJECTIVE-003: P99 API response time under 200ms for core endpoints
  → Architectural baseline: horizontal scalability enabled (not day-one provisioned)

OBJECTIVE-004: Reliable single-VPS availability with fast, tested recovery
  → Health/readiness checks, automated snapshots, restore drill

OBJECTIVE-005: Zero critical security findings in independent review
  → OWASP Top 10 mitigations as standard architectural baseline
```

### 2.3 Success Criteria (Definition of Done at Project Level)

- [ ] All functional requirements met and acceptance tests pass
- [ ] Load testing validates core-endpoint P99 < 200ms at the Phase 1 traffic baseline with 0% error rate
- [ ] Security review: 0 critical, 0 high severity findings
- [ ] Documentation complete: architecture, API, operations, runbooks
- [ ] CI/CD pipelines operational with automated quality gates
- [ ] Monitoring, health checks, and structured logging fully in place (lightweight stack)
- [ ] Disaster recovery plan documented and tested (RTO < 4h, RPO < 1h)
- [ ] Production environment successfully deployed and smoke-tested

---

## 3. PROJECT SCOPE

### 3.1 In Scope

| Category | Deliverables |
|----------|-------------|
| **Mobile Application (iOS + Android)** | Flutter cross-platform app. Features: 5-method authentication, multi-language (5+ languages, RTL Arabic + LTR), audio player with background/lock-screen support, PDF viewer, offline downloads (audio + PDFs), comments + Q&A, FCM notifications. Material 3 design language. **No video.** **No automatic progress/resume tracking and no bookmarks in Phase 1.** |
| **Backend API** | NestJS monorepo with modular monolith architecture (5 Bounded Context Modules). REST APIs v1, JWT access (RS256) + rotating refresh tokens + phone OTP + OAuth2 (Google/Apple/Facebook), RBAC **5-role model** (SuperAdmin · Admin · Editor · Moderator · User), async notifications (3 channels: FCM Push + Email + SMS), Redis caching/sessions/rate limits, BullMQ job queues (media processing, notifications) |
| **Admin Dashboard (React SPA)** | Content team tooling: media library (audio/PDF/image/text upload, transcoding status), content publishing workflow (Drafts/Published), comments moderation, Q&A moderation, user management + role assignment, system audit log viewer, basic operational metrics. Ant Design 5 + Tailwind UI. |
| **Database** | PostgreSQL 16 relational schema with TypeORM migrations, UUIDv7 PKs, soft deletes, global i18n table for translatable fields, Redis 7 session + token + hot-content cache, S3-compatible object storage (env-configurable; e.g. Cloudflare R2) for audio/PDF/images |
| **DevOps** | Docker multi-stage containerization (backend, admin-frontend, nginx, db, redis), Docker Compose local-dev + production-compose profiles, GitHub Actions CI/CD, release versioning SemVer, backup automation with restore drill |
| **Infrastructure** | Hostinger VPS (2 vCPU / ~4 GB RAM / ~200 GB NVMe SSD, Ubuntu 24.04 LTS), Nginx edge reverse proxy with TLS 1.3 termination + gzip/brotli compression, CDN for media offload, **lightweight monitoring** (Uptime Kuma + `/health` + `/ready` via `@nestjs/terminus` + structured JSON logs via pino), PgBouncer pooling |
| **Security** | TLS only, short-lived JWT + refresh token rotation + Redis invalidation, brute-force rate limiting, 5-way auth hardening, audit logging (admin actions), OWASP Top 10 baseline, secure headers (Helmet), no DRM requirement in MVP |
| **Testing** | Jest/Vitest unit tests (≥70% coverage), NestJS Supertest integration tests, Flutter widget tests, Playwright admin E2E, k6 load test at the Phase 1 traffic baseline, Snyk/osv-scanner vulnerability scanning in CI |
| **Documentation** | Architecture docs (this doc + Vision + Governance), 14 ADRs, OpenAPI 3.1 auto-generated Swagger UI, PostgreSQL schema docs, deployment runbooks, contributor onboarding guide |

### 3.2 Out of Scope (MVP / Phase 1)

- [ ] **Courses / Quizzes / Certificates** — explicitly excluded in MVP. Architecture hooks preserved for a future version; schema kept simple (standalone Content items only).
- [ ] **Progress / resume tracking & Bookmarks / Favorites** — explicitly removed from Phase 1 scope per Sponsor Consolidated Decision (2026-08-09). No `last_position_ms`, no automatic resume, no saved lists. Future demand → a separate future ADR/addition.
- [ ] **Video content** — no video, no live streaming, in any phase of the current scope.
- [ ] Payment / Subscriptions / Donations — fully excluded (entirely free)
- [ ] Advanced / Full-text Search — deferred; MVP ships minimal browse/filter only
- [ ] DRM / Screen-capture Prevention / Watermarking — explicitly no in MVP
- [ ] User-Generated Content (UGC) uploads — team uploads only
- [ ] Public editor/author profile pages — content editors are internal, not public profiles
- [ ] Microservices decomposition — architecturally ready but deferred (Strangler-Fig trigger in ADR-003)
- [ ] Multi-region HA — single region first
- [ ] PWA / Flutter Web — only native iOS + Android + React Admin SPA
- [ ] AI/ML recommendation features — hooks preserved, deferred
- [ ] Advanced observability stack (Prometheus/Grafana/Loki/Tempo) — deferred Phase-2+ upgrade; Phase 1 uses the lightweight stack above

### 3.3 Assumptions

1. Hostinger VPS resources are sized per the Phase 1 baseline (2 vCPU / ~4 GB RAM / ~200 GB SSD)
2. A production domain will be provisioned later; until then `majlis-alim.app` is used as an **env-configurable placeholder** (`API_DOMAIN` / `ADMIN_DOMAIN` / `S3_*`), never hardcoded
3. Firebase project for Cloud Messaging will be available
4. Content team will provide structured content formats per specifications
5. Budget is available for essential third-party services (email provider, SMS, CDN/object storage)

### 3.4 Constraints

| Constraint | Detail |
|-----------|--------|
| **Hosting** | Primary deployment target: Hostinger VPS (2 vCPU / ~4 GB RAM / ~200 GB NVMe SSD, Ubuntu 24.04 LTS); not managed Kubernetes at Phase 1 |
| **Mobile Tech** | Flutter for iOS + Android (no native split). Material 3 design system. |
| **Backend Tech** | NestJS / Node.js ecosystem only (monorepo with Nx) |
| **Frontend Tech** | React ecosystem for Admin dashboard SPA only (Ant Design 5 + Tailwind) |
| **Database** | PostgreSQL 16 as primary; Redis 7 for cache/sessions/queues. No other databases in MVP. |
| **Content Types (Fixed MVP)** | ONLY 4 types: AUDIO · PDF/BOOK · TEXT/ARTICLE · IMAGE. **No video, no live, no course bundles.** |
| **Authentication (Fixed MVP)** | 5 methods required: Email+Password · Phone OTP · Google · Apple · Facebook. All content gated after login. |
| **Authorization (Fixed MVP)** | **5 RBAC roles ONLY: SuperAdmin · Admin · Editor · Moderator · User.** No Instructor/Parent/Student roles. |
| **Internationalization** | MVP MUST ship with i18n-ready architecture for 5+ languages from Day 1, RTL Arabic + LTR (English/others). No later retrofit. |
| **Signup Minimal PII** | Only "Full Name" required at signup. Email/phone = auth identifier only. |
| **Budget** | Phase 1 budget conscious — open-source self-hosted preferred where feasible |
| **Timeline** | Flexible, no hard MVP deadline |
| **UI/UX Design** | No design team; leverage Material 3 (Flutter) + Ant Design 5 (Admin) design systems exclusively |

---

## 4. HIGH-LEVEL REQUIREMENTS

### 4.1 Core Functional Domains (5 Bounded Context Modules)

```
Module 01 — identity: Identity & Access Management (IAM)
  ├─ 5 Authentication Methods (MVP REQUIRED):
  │   ├─ Email + Password (argon2id)
  │   ├─ Phone Number + OTP (SMS provider, env-configurable)
  │   ├─ OAuth 2.0: Google Sign-In
  │   ├─ Sign in with Apple
  │   └─ Facebook Login
  ├─ JWT Access Tokens (RS256, short-lived 15 min)
  ├─ Rotating Refresh Tokens (Redis invalidation, token-family reuse detection)
  ├─ RBAC: 5 Roles (canonical):
  │   ├─ SuperAdmin (all permissions, immutable)
  │   ├─ Admin (platform administration, user & role management)
  │   ├─ Editor (CRUD content, publish, media library)
  │   ├─ Moderator (moderate comments/Q&A, suspend users)
  │   └─ User (default authenticated end-user; no privileged actions)
  ├─ Permission guard on every endpoint (default deny)
  ├─ Session management + device listing + revoke session
  ├─ Account recovery (email reset, phone OTP reset)
  └─ GDPR: Export user data, Delete my account (hard delete PII, audit retained 7yr)

Module 02 — content: Content Management & Media Library
  ├─ 4 Content Types ONLY (fixed MVP):
  │   ├─ AUDIO: long-form lectures, Quran recitations (multi-hour, offline download)
  │   ├─ BOOK / PDF: books (up to 1000 pages, offline PDF viewer)
  │   ├─ TEXT / ARTICLE: articles, blog posts, fatwa-style answers
  │   └─ IMAGE: infographics, diagrams, standalone images
  │       (NO video — fixed MVP constraint)
  ├─ Content CRUD + Workflow (Draft → Review → Published)
  ├─ Media Library: direct S3-compatible upload stream, presigned URLs
  │   └─ Audio transcoding (OPUS/AAC variants for network speed), PDF thumbnail generator
  ├─ Taxonomy System: Categories (hierarchical), Tags, Authors attribution
  ├─ Translations attached per content (i18n 5+ languages, translatable_fields via i18n table)
  ├─ Public Visibility: All content ONLY after auth (NO anonymous access)
  └─ Scheduled Publish date feature

Module 03 — engagement: Community
  ├─ Comments System (per content item): threaded replies, upvotes, moderation status
  ├─ Questions & Answers Forum (Q&A) with Editor answer badge
  ├─ User Activity feed (recent public activity) — NO private progress/resume state
  ├─ User Language & Theme Settings (RTL Arabic / LTR other), audio playback speed
  └─ User Profile page (public display name = signup full name, optional bio + avatar)
      NOTE: NO progress tracking, NO resume position, NO bookmarks/favorites/saved lists
            in Phase 1 (removed per Sponsor Consolidated Decision 2026-08-09).

Module 04 — notifications: Notifications (3 Channels):
  ├─ FCM Push Notifications (mobile app foreground + background)
  ├─ Email Notifications (Q&A answer reply, password recovery, etc.)
  ├─ SMS Notifications (OTP auth, high-priority announcements only)
  ├─ In-App Notification Center (unread badge, mark all read)
  ├─ Notification Preferences per channel per type (opt-out per category)
  ├─ Announcements from Admin to all users / segments
  └─ Async via BullMQ queue to avoid blocking the API request cycle

Module 05 — admin: Administration & Operations (Dashboard SPA scope)
  ├─ User Management: list, filter, suspend, unsuspend, role change, view profile, audit actions
  ├─ Moderation Queue: reported comments, Q&A flagged; Moderator action log
  ├─ Media Usage Dashboard: storage totals, file counts, top content
  ├─ Basic Operational Metrics:
  │   ├─ Active users (DAU/WAU/MAU)
  │   ├─ Top content: most played audio, most opened PDF, most read article
  │   └─ Auth Method Breakdown (signups via email/social/otp)
  ├─ System Audit Log: all admin actions, all role changes, all deletes (immutable log)
  ├─ Application-level Config: feature flags, maintenance mode banner
  └─ Backup & Restore: trigger manual backup, view backup history
```

Note: The 5 bounded contexts are **fixed**. There is no 6th or 7th module; adding one requires explicit prior Sponsor approval with written justification. Courses/quizzes/certificates and progress/bookmarks are out of scope (§3.2).

### 4.2 Non-Functional Requirements (NFRs)

| NFR ID | Category | Requirement | Baseline Target |
|--------|----------|-------------|-----------------|
| NFR-001 | Performance | API response time | P50 < 50ms, P95 < 100ms, P99 < 200ms |
| NFR-002 | Performance | Concurrent load (Phase 1 baseline) | Comfortably serve the 1,000-5,000 user base; headroom for burst |
| NFR-003 | Availability | Production uptime | Best-effort single-VPS; health/readiness checks + auto-restart |
| NFR-004 | Availability | Recovery time | RTO < 4 hours, RPO < 1 hour |
| NFR-005 | Scalability | Horizontal scaling | Stateless services; add nodes without rewrite |
| NFR-006 | Scalability | User capacity | 1,000-5,000 Phase 1; rewrite-free path to hundreds of thousands |
| NFR-007 | Security | Data in transit | TLS 1.3 only, HSTS enforced |
| NFR-008 | Security | Data at rest | AES-256 encryption for PII |
| NFR-009 | Security | Compliance | GDPR, OWASP Top 10, secure headers |
| NFR-010 | Security | Authentication | JWT + short-lived tokens + refresh rotation |
| NFR-011 | Usability | Mobile app rating | Target 4.5+ store rating |
| NFR-012 | Maintainability | Code coverage | Minimum 70% unit tests, 80% critical paths |
| NFR-013 | Maintainability | Build time | CI pipeline completes in < 15 minutes |
| NFR-014 | Observability | Logging | Structured JSON logs (pino), Docker json-file + logrotate under /var/log/majlis-alim |
| NFR-015 | Observability | Monitoring | Uptime Kuma + `/health` + `/ready` (terminus) + trace_id correlation |

---

## 5. STAKEHOLDERS

| Role | Name/Group | Responsibilities | Contact |
|------|-----------|-----------------|---------|
| **Project Sponsor** | Client / Product Owner | Funding, vision, requirements sign-off, go/no-go decisions | Active |
| **Chief Software Architect** | Architecture Lead | All technical decisions, architecture, code standards, risk management | Active |
| **Backend Team Lead** | Expert 02 (NestJS) | Backend implementation, API design, database, integration | Pending |
| **Mobile Team Lead** | Expert 03 (Flutter) | Mobile app architecture, UX implementation, app store delivery | Pending |
| **Frontend Team Lead** | Expert 04 (React) | Admin dashboard SPA implementation | Pending |
| **Database Expert** | Expert 05 (PostgreSQL/Redis) | Schema design, performance, migration strategy | Pending |
| **DevOps Engineer** | Expert 06 (Docker/Cloud) | Infrastructure, CI/CD, monitoring, deployment | Pending |
| **Security Expert** | Expert 07 (CyberSec) | Threat modeling, security reviews, penetration test | Pending |
| **QA Lead** | Expert 08 (Testing) | Test strategy, automation, load testing, quality gates | Pending |
| **Performance Engineer** | Expert 09 (Optimization) | Profiling, bottleneck analysis, tuning | Pending |
| **Product Manager** | TBD | Backlog, prioritization, UAT sign-off | TBD |
| **Content Team** | TBD | Content ingestion, review, quality assurance | TBD |

---

## 6. PROJECT PHASES & MILESTONES

### Phase Lifecycle (Sequential with gated approvals)

```
Phase 0: Foundation & Architecture  ← CURRENT PHASE (consolidation complete)
  ├─ Milestone 0.1: Project Charter signed
  ├─ Milestone 0.2: Architecture Vision + Governance approved
  ├─ Milestone 0.3: Solution Design (C4, DB, API) complete
  ├─ Milestone 0.4: ADRs for all major decisions documented
  └─ Gate: Architecture Review Board sign-off

Phase 1: Core Infrastructure & IAM
  ├─ Milestone 1.1: CI/CD pipelines operational
  ├─ Milestone 1.2: Infrastructure as Code provisioned
  ├─ Milestone 1.3: identity module (auth + RBAC) complete & tested
  ├─ Milestone 1.4: Lightweight monitoring & structured logging live
  └─ Gate: Security + Quality Review

Phase 2: Content & Media Library
  ├─ Milestone 2.1: content module (CMS backend)
  ├─ Milestone 2.2: Admin dashboard (CMS + User Management)
  ├─ Milestone 2.3: Mobile app: Browse, Content view, Offline downloads
  ├─ Milestone 2.4: Media library: upload, transcoding, presigned delivery
  └─ Gate: Integration + Load Testing

Phase 3: Engagement & Notifications
  ├─ Milestone 3.1: engagement module — Comments, Q&A
  ├─ Milestone 3.2: notifications module — Push + Email + SMS + In-App
  ├─ Milestone 3.3: admin module — operational metrics dashboards
  └─ Gate: User Acceptance Testing (UAT)

Phase 4: Hardening & Production
  ├─ Milestone 4.1: Performance tuning & load testing passed
  ├─ Milestone 4.2: Security audit passed (0 critical/high)
  ├─ Milestone 4.3: Disaster recovery drill successful
  ├─ Milestone 4.4: Production deployment + smoke test
  └─ Gate: Go-Live Approval

Phase 5: Post-Launch & Scale
  ├─ Milestone 5.1: 30-day stability period
  ├─ Milestone 5.2: Strangler-Fig extraction analysis (per ADR-003 trigger)
  └─ Ongoing: Continuous improvement
```

---

## 7. HIGH-LEVEL BUDGET & TIMELINE (TENTATIVE)

> ⚠️ **PENDING**: These estimates are placeholders. Detailed estimation will occur during Phase 1 planning.

| Phase | Estimated Duration | Team Size |
|-------|-------------------|-----------|
| Phase 0: Foundation | 2-3 weeks | Architect + Sponsor |
| Phase 1: Core + IAM | 4-6 weeks | Full team |
| Phase 2: Content & Media | 6-8 weeks | Full team |
| Phase 3: Engagement + Notifications | 4-6 weeks | Full team |
| Phase 4: Hardening + Prod | 3-4 weeks | Full team |
| **Total MVP Estimate** | **~20-27 weeks (~5-7 months)** | |

---

## 8. RISK REGISTER (INITIAL)

| Risk ID | Risk Description | Likelihood | Impact | Mitigation Strategy |
|---------|-----------------|------------|--------|---------------------|
| R-001 | Scope creep beyond MVP | High | High | Strict change control, backlog grooming, MVP freeze gate |
| R-002 | Underestimation of content complexity | Medium | High | Content modeling workshops early, build CMS first |
| R-003 | VPS single point of failure | Medium | Critical | Automated snapshots, tested restore runbook, documented scale-out path |
| R-004 | Security breach / data leak | Low | Critical | Threat modeling, secure defaults, review, encryption |
| R-005 | Team coordination overhead | High | Medium | Clear roles/conventions, PR review standards, integration branches |
| R-006 | Flutter performance on low-end devices | Medium | Medium | Performance budget, profile on target devices, lazy rendering |
| R-007 | PostgreSQL write bottleneck at scale | Low | Medium | Connection pooling (PgBouncer), read replicas plan, partitioning DDL |
| R-008 | Inconsistent quality across parallel workstreams | High | High | Architecture gate reviews, code standards, PR templates, CI quality gates |
| R-009 | Missing/ambiguous requirements cause rework | High | Medium | This document + ADRs + discovery questions in Phase 0 |
| R-010 | Third-party service downtime (FCM, email, etc.) | Medium | Medium | Fallback mechanisms, retry/backoff, multi-vendor evaluation |

---

## 9. AUTHORITY & APPROVALS

### Approvals Required Before Progressing

| Gate | Approver(s) | Artifact |
|------|------------|----------|
| Project Initiation | Sponsor + Architect | This Project Charter |
| Architecture Baseline | Architect + Tech Leads | Architecture Vision, Solution Design, ADRs |
| Phase Transition | Architect + Sponsor | Phase Completion Report, Risk Status |
| Production Go-Live | All Stakeholders | UAT Sign-off, Load Test Report, Security Report |

### Authority Granted

- **Chief Software Architect** is hereby authorized to:
  - Make all technical decisions binding on the project
  - Approve or reject any implementation, design, or code
  - Initiate ADRs for architectural decisions
  - Halt work on any component found non-compliant
  - Approve/reject all pull requests affecting architecture
  - Escalate risks and issues to the Sponsor

---

## 10. APPENDICES

### Appendix A: Glossary

| Term | Definition |
|------|-----------|
| ADR | Architecture Decision Record |
| C4 | Context → Container → Component → Code (architecture model) |
| CI/CD | Continuous Integration / Continuous Deployment |
| FCM | Firebase Cloud Messaging |
| IAM | Identity & Access Management |
| MVP | Minimum Viable Product |
| NFR | Non-Functional Requirement |
| P99/P95 | 99th/95th percentile latency |
| RBAC | Role-Based Access Control |
| RPO/RTO | Recovery Point Objective / Recovery Time Objective |
| RPS | Requests Per Second |
| SLA | Service Level Agreement |
| SLI | Service Level Indicator |
| OTP | One-Time Password (SMS-based 2nd factor or passwordless auth) |
| OAuth2 | Open Authorization 2.0 standard (Google/Apple/Facebook login) |
| i18n | Internationalization / multi-language architecture |
| RTL | Right-To-Left text rendering (Arabic, Hebrew, etc.) |
| S3-compatible | Object storage API compatible with AWS S3 (Cloudflare R2, Backblaze B2, MinIO self-host) |
| CDN | Content Delivery Network |
| MFA | Multi-Factor Authentication |
| Strangler-Fig | Incremental extraction pattern for evolving a modular monolith toward services |

### Appendix B: References

- Architecture Vision → See [ARCHITECTURE_VISION.md](architecture/ARCHITECTURE_VISION.md)
- Technical Governance → See [TECHNICAL_GOVERNANCE.md](governance/TECHNICAL_GOVERNANCE.md)
- Architecture Decision Records → See [docs/architecture/adr/](architecture/adr/)

---

## CHANGE LOG

| Version | Date | Author | Change Description |
|---------|------|--------|--------------------|
| 1.0.0 | 2026-08-07 | Chief Software Architect | Initial draft |
| 1.1.0 | 2026-08-07 | Chief Software Architect | Incorporated Sponsor Q&A Round 1. Scope: 5 modules, 4 content types, 5 auth methods, i18n 5+ languages RTL/LTR, minimal signup. |
| 1.2.0 | 2026-08-09 | Chief Software Architect | Phase 0 consolidation per Sponsor Consolidated Decision: project renamed **Al-Fajr (الفجر)**; code `SAF-EDU-001`→`AF-EDU-001`; scale rebased to 1,000-5,000 (rewrite-free growth path); **progress tracking & bookmarks removed entirely** (Module 03 → Community); RBAC fixed to canonical **5 roles** (SuperAdmin/Admin/Editor/Moderator/User, no Instructor/Parent/Student); monitoring rebased to lightweight stack (Uptime Kuma + terminus + pino); VPS specs fixed (2 vCPU / ~4 GB / ~200 GB, Ubuntu 24.04); **no-video** reaffirmed; domain `al-fajr.app` documented as env-configurable placeholder; broken `file:///` links replaced with relative links; status **APPROVED**. |

---

> **STATUS: 🟢 APPROVED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09). This Project Charter, together with the Architecture Vision and Technical Governance, forms the signed-off Triple Foundation of the project. No implementation code proceeds until the Phase 1 plan is explicitly approved.**
