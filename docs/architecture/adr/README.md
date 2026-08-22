# ARCHITECTURE DECISION RECORD — INDEX
# فهرس سجلات القرارات المعمارية

| ADR ID | Title | Status | Created Date | Decision Maker |
|--------|-------|--------|--------------|----------------|
| [ADR-001](ADR-001-architecture-pattern-modular-monolith.md) | Architecture Pattern: Modular Monolith for Phase 1 over Microservices and Layered Monolith | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-002](ADR-002-bounded-context-map-5-modules.md) | Bounded Context Map (5 Modules — Boundaries & Context Mapping) | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-003](ADR-003-microservices-extraction-trigger-criteria.md) | Microservices Extraction Trigger Criteria (When to Split the Monolith) | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-004](ADR-004-api-style-rest-json-api.md) | API Style: REST with JSON:API Conventions over GraphQL / gRPC | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-005](ADR-005-primary-database-postgresql-16.md) | Primary Database: PostgreSQL 16+ over MySQL / MongoDB / CockroachDB | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-006](ADR-006-orm-typeorm-0-3-x.md) | ORM / Data Mapper: TypeORM over Prisma / Drizzle / Knex | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-007](ADR-007-iac-phase-1-docker-compose-shell-scripts.md) | Infrastructure-as-Code: Docker Compose + Scripts over Terraform / Pulumi for Phase 1 | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-008](ADR-008-auth-strategy-jwt-rs256-rotating-refresh.md) | Authentication Strategy: JWT Access Tokens + Rotating Refresh Tokens | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-009](ADR-009-flutter-state-management-riverpod.md) | Flutter State Management: Riverpod 2.x over Bloc / Provider / GetX | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-010](ADR-010-react-admin-state-zustand-tanstack-query.md) | React State Management: Zustand + TanStack Query over Redux / MobX / Context | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-011](ADR-011-observability-lightweight-monitoring.md) | Observability: Lightweight Monitoring (Uptime Kuma + Health Checks + JSON Logs) over Full OLGT Stack | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-012](ADR-012-mobile-local-storage-isar-db.md) | Mobile Local Storage: Isar over Hive / sembast / SQLite (sqflite) | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-013](ADR-013-media-storage-s3-compatible-object-storage.md) | Media Storage: S3-Compatible Object Storage over Local Filesystem / DB BLOBs | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-014](ADR-014-monorepo-tooling-nx.md) | Monorepo Tooling: Nx over Turborepo / Lerna / Manual | ACCEPTED | 2026-08-07 | Chief Software Architect |
| [ADR-015](ADR-015-pg-uuidv7-build-strategy-docker-alpine.md) | pg_uuidv7 Build Strategy: Compile from Source with LLVM Symlinks in postgres:16-alpine | ACCEPTED (with documented risks) | 2026-08-18 | Infrastructure Team |

---

## Status Legend

| Status | Meaning |
|--------|---------|
| 🟡 PROPOSED | Decision drafted, open for stakeholder review and input |
| 🟢 ACCEPTED | Decision formally approved and binding on the project |
| 🔴 DEPRECATED | Decision no longer applies to the current architecture |
| 🟣 SUPERSEDED | Decision replaced by a newer ADR (linked in new ADR footer) |

---

## ADR Template (Michael Nygard Format — Mandatory)

Every ADR file in this directory SHALL follow this exact structure:

```markdown
# ADR-NNN: Short Descriptive Title

- Status: PROPOSED / ACCEPTED / DEPRECATED / SUPERSEEDED by ADR-XXX
- Deciders: Chief Software Architect + consulted SMEs
- Date: YYYY-MM-DD
- Supersedes: ADR-XXX (if replacing prior decision)
- Related: ADR-XXX, ADR-XXX (cross-references)

## 1. Context & Problem Statement

Describe the forces at play (technical, business, organizational, regulatory).
What problem are we trying to solve? Why is this decision needed NOW?

## 2. Decision

State the decision clearly, in one paragraph if possible.
What are we actually going to DO? Bulletize the concrete actions.

## 3. Alternatives Considered

Describe each alternative (minimum 2, ideally 3-4).
For each alternative, list PROS and CONS honestly.

### Alternative A: Name of First Alternative
- ✅ Pro: ...
- ❌ Con: ...

### Alternative B: Name of Second Alternative
- ✅ Pro: ...
- ❌ Con: ...

### Alternative C: ...

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A | Alternative B | Chosen Decision |
|-----------|--------------|---------------|-----------------|
| Cost / Phase 1 | | | |
| Performance | | | |
| Maintainability | | | |
| Team Learning Curve | | | |
| Security | | | |
| Scalability Path | | | |
| Vendor Lock-in Risk | | | |

## 5. Consequences

### Positive Outcomes (what we gain)
- ...

### Negative Outcomes / Trade-offs (what we accept)
- ...

### Neutral / Unknown (risks to monitor)
- ...

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

Under what measurable conditions do we re-open this decision?
- Metric X exceeds threshold Y for Z days
- New evidence or technology changes the trade-off analysis
- Regulatory / business requirement invalidates this decision

## 7. Links & References

- Project Charter §X.X
- Architecture Vision §X.X
- Technical Governance §X.X
- External links to standards, benchmarks, articles

---

*Decision Log:*
- YYYY-MM-DD: PROPOSED by [Name]
- YYYY-MM-DD: ACCEPTED — signed by Chief Software Architect
- YYYY-MM-DD: SUPERSEDED by ADR-NNN
```

---

> **Status (2026-08-09):**
> ADR-001 through ADR-014 are **ACCEPTED** — Phase 0 consolidation pass signed off by the Project Sponsor. These decisions are now binding on the project (project name **Al-Fajr**, 5 bounded contexts, lightweight monitoring, target scale 1,000–5,000 users in the first 6 months with a documented path to hundreds of thousands without a rewrite).
> Next: Phase 1 planning (system architecture, database design, API contract). No implementation code is written until the Phase 1 plan is explicitly approved.
