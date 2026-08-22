# ADR-001: Architecture Pattern — Modular Monolith (Bounded Contexts) for Phase 1

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: BKE, DBA, DEV, SEC
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-002 (Bounded Contexts), ADR-003 (Extraction Triggers), ADR-007 (IaC)

---

## 1. Context & Problem Statement

The Al-Fajr Educational & Religious Platform has explicit requirements:
- **Phase 1 deployment target: Hostinger VPS** (raw Linux VPS, not managed Kubernetes)
- **Scale target:** 1,000–5,000 registered users in the first 6 months post-launch, with an **architectural requirement** that the design scale to **hundreds of thousands of users later without a fundamental rewrite** — the architecture must *enable* that growth, not be provisioned as if that scale already exists on day one
- **Team structure:** 10 expert accounts collaborating in parallel, requiring **clear ownership boundaries** within a unified codebase
- **Delivery imperative:** We need to ship an MVP quickly — we cannot spend months on infrastructure before delivering value
- **Phase 1 budget constraint:** Budget-conscious; no enterprise PaaS or Kubernetes cluster spend in Phase 1

We must choose the correct architectural pattern for Phase 1. Three viable alternatives exist. Getting this wrong will either (a) delay MVP by 6+ months, or (b) force a catastrophic rewrite as the user base grows. Historical data from Shopify, GitHub, Stack Overflow, and Discord shows this is the most consequential early decision a scale-up makes.

---

## 2. Decision

**✅ WE WILL BUILD A MODULAR MONOLITH with explicit Bounded Contexts as natural service-extraction boundaries.**

Concrete actions implementing this decision:
1. A single NestJS application (`apps/backend/`) will contain all 5 Bounded Contexts as independent NestJS modules (per ADR-002: `identity`, `content`, `engagement`, `notifications`, `admin`).
2. Each module internally follows the 4-layer Clean Architecture triad: `domain/` → `application/` → `infrastructure/` → `presentation/`.
3. **No cross-module database access.** Modules may communicate only via: (a) published/received Domain Events on an in-process Event Bus, or (b) HTTP calls to each other's public REST API (same process, explicit contracts). No direct imports of another module's repository.
4. An internal `@ts-safe/module-boundaries` ESLint rule + architecture unit tests will FORBID cross-boundary import violations. Violations break the CI build.
5. Each module = a **candidate for future microservice extraction**. Bounded Context boundaries are chosen today such that a future Strangler-Fig extraction is mechanically straightforward (rewrite Event Bus transport to gRPC/Kafka, move DB schema to independent cluster).
6. When a module is shown (via 30 days production metrics) to consume **>40% of CPU or DB resources**, and other cost-reduction tactics are exhausted → ADR-003 triggers a microservice extraction.

---

## 3. Alternatives Considered

### Alternative A: Microservices from Day 1 (Decompose Immediately)
Split the system into 5 independent NestJS microservices from Phase 1. Each service has: independent deploy, independent DB schema, network API (gRPC or REST).

- ✅ **Pro:** Architectural purity; each service scales independently
- ✅ **Pro:** Isolated blast radius; one service crash does not take down the whole platform
- ✅ **Pro:** Clear team boundaries (one microservice per expert)
- ❌ **Con:** **Catastrophic for Phase 1 delivery.** Network boundaries + distributed transactions (Sagas) + service discovery + Kubernetes + CI per service = **6-12 weeks of pure infrastructure work before first feature ships.**
- ❌ **Con:** Hostinger VPS is an anti-pattern for microservices. We would have to self-host Kubernetes (k3s) with all its complexity, or deploy 5 PM2 clusters manually on one box. Neither is acceptable for a small Phase 1 team.
- ❌ **Con:** Data consistency is orders of magnitude harder. Simple operations (user registers → welcome notification fires → default engagement record created) become distributed sagas with failure compensation logic.
- ❌ **Con:** Cost overrun. Resource utilization per-service is poor on VPS; network hops add latency; observability stack must be distributed-trace-native.
- ❌ **Con:** Distributed monolith anti-pattern risk. If boundaries are wrong (and they will be, first time), we cannot easily shift logic between services.

### Alternative B: Traditional Three-Layer Monolith (Controller → Service → Repository)
One NestJS app. But instead of Bounded Context modules, a traditional cross-cutting layer structure:
```
controllers/ (all controllers together)
services/    (all services together)
repositories/(all repositories together)
entities/    (all entities together)
```

- ✅ **Pro:** Fastest to start. Familiar pattern.
- ✅ **Pro:** Single deploy, single DB, least infrastructure.
- ❌ **Con:** **100% chance of Big Ball of Mud by 50K users.** Zero enforceable boundaries. Every module ends up depending on every other. Team of 10 experts creates merge conflicts on every PR.
- ❌ **Con:** No path to microservices without COMPLETE REWRITE. Layers are horizontal — boundaries do not map to business domains.
- ❌ **Con:** Ownership is impossible. "Who owns User entity?" → Everyone → Nobody. Bugs in production with no clear owner.
- ❌ **Con:** Historical precedent. This is the architecture that creates the rewrite-or-die cliff every startup hits at ~2-5 years. We explicitly prevent this.

### Alternative C: Modular Monolith (Our Decision)

- ✅ **Pro:** Single deploy. MVP ships fast. No distributed systems overhead in Phase 1.
- ✅ **Pro:** ACID transactions across contexts where genuinely needed (avoid sagas in Phase 1).
- ✅ **Pro:** VPS-friendly. One app cluster + PgBouncer + Redis. DevOps burden is manageable.
- ✅ **Pro:** Clean ownership map. Each of the 10 expert accounts owns a module. PRs within a module rarely conflict.
- ✅ **Pro:** Gradual evolutionary path. Every boundary = future microservice boundary. Strangler-Fig extractions are mechanical and safe when **proven necessary by metrics**, not premature optimization.
- ✅ **Pro:** Used by Shopify, GitHub, Stack Overflow, Discord, GitLab for their initial growth phases. Industry consensus (2020-2026) has shifted: modular monolith is the default Phase 1 recommendation for teams under 50 engineers.
- ⚠️ **Trade-off:** Single process blast radius. A crash in Module X theoretically crashes the whole app. Mitigated: (a) PM2 cluster mode auto-restarts, (b) BullMQ isolates heavy CPU work from API handlers, (c) health checks + auto-restart, (d) each module has its own error boundary via NestJS exception filters.
- ⚠️ **Trade-off:** Single DB write bottleneck at scale. Mitigated: (a) PgBouncer connection pooling, (b) read replicas planned for Phase 2, (c) table partitioning in schema, (d) PostgreSQL 16 performance, (e) Redis cache for reads.
- ⚠️ **Trade-off:** Requires DISCIPLINE. Boundaries must be enforced in CI or we degenerate to Alternative B. Mitigated: ESLint import rules, architecture unit tests (ArchUnit), CSA code reviews.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — Microservices Day 1 | Alternative B — Layered Monolith | Alternative C — Modular Monolith ✅ CHOSEN |
|-----------|------------------------------------|----------------------------------|-------------------------------------------|
| **MVP Delivery Time** | ❌ 6-9 months (infra overhead) | ⚠️ 3-5 months (fast start, but coupling slows) | ✅ 4-6 months (optimal) |
| **Scalability to hundreds of thousands of users** | ✅ Native (horizontal) | ❌ Must rewrite | ✅ Gradual — extract modules when bottleneck proven |
| **Hostinger VPS Fit** | ❌ Anti-pattern — needs orchestration | ✅ Perfect | ✅ Perfect (single app cluster) |
| **Team Parallelism (10 accounts)** | ✅ Excellent (independent repos) | ❌ Everyone steps on everyone | ✅ Excellent (module-level ownership) |
| **Data Consistency** | ❌ Eventual consistency everywhere (sagas) | ✅ ACID everywhere | ✅ ACID in Phase 1; eventual on extraction |
| **Ops Cost (Phase 1)** | ❌ 5-10x higher (k3s, mesh, multi-CI) | ✅ Minimal | ✅ Minimal |
| **Path to Microservices** | — (already there) | ❌ Full rewrite required | ✅ Strangler-Fig per-module (mechanical) |
| **Testing Cost/Effort** | ❌ Contract tests × N² service pairs | ⚠️ Easy until coupling | ✅ In-process integration tests (cheap) |
| **Failure Isolation** | ✅ Perfect | ❌ Worst (fully coupled) | ⚠️ Good + mitigations (PM2, queues, health) |
| **Learning Curve (new dev)** | ❌ Weeks (service topology) | ✅ 1-2 days | ✅ 1-2 days (modules well-named) |
| **Vendor / Tech Lock-in** | ⚠️ k8s/infra lock-in | ⚠️ Monolith rewrite lock-in | ✅ No lock-in. Easy to extract any module. |
| **Budget Alignment** | ❌ Exceeds Phase 1 budget | ✅ Excellent | ✅ Excellent |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Optimal MVP speed.** Phase 1 features ship in weeks, not months.
2. **Clear ownership for 10 accounts.** Each expert owns a module. Minimal PR conflict.
3. **Optionality preserved.** We are not locked into either extreme. We can move to microservices when (and ONLY when) production load metrics prove we must. No premature optimization.
4. **ACID transactions in Phase 1.** Simplified business logic. Fewer distributed failure modes to handle.
5. **Excellent observability.** Single process = traces never span network in Phase 1. Easy to profile end-to-end.
6. **Battle-tested pattern.** Shopify handled $100B GMV on modular monolith before extracting services. Stack Overflow served 100M+ monthly visitors. We are in excellent company.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Blast radius:** one buggy module → whole app crash. **Mitigation:** PM2 cluster mode + per-module NestJS exception filters + BullMQ queue isolation + rate limiting per-route.
2. **Single DB write bottleneck at scale.** **Mitigation:** PgBouncer, read replicas in Phase 2, partitioning, Redis reads, ADR-003 triggers.
3. **Discipline required.** Boundaries need enforcement. **Mitigation:** ESLint `import/no-restricted-paths` + ArchUnit-style Jest tests + CSA reviews + module owner code review.
4. **One large deploy (rolling restart on every change).** **Mitigation:** Canary deploys via PM2 reload; feature flags (LaunchDarkly/open-source alternative) for gradual rollout; hot-reload Phase 2 if needed.
5. **Docker image grows large.** **Mitigation:** Multi-stage build, pnpm/yarn dedupe, only production `node_modules`, Nx affected builds for caching.

### Neutral / Unknown (risks to monitor)
1. **Do our module boundaries match true business domains?** We will reassess at Phase 1 end (after IAM + Content modules built). If boundaries are wrong, we reshape ADR-002 while we still have a single process.
2. **Will NestJS's DI container scale to 5 modules cleanly?** Yes — 50+ module monoliths are documented. We will monitor startup time > 15s as warning threshold.
3. **Will monorepo build times be acceptable?** Nx caching should keep incremental builds under 60s. We will set CI budget: >10min build triggers PFE review.

---

## 6. Reversal / Exit Criteria (When to Re-Open This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Performance):** Any single module accounts for **>40% of total production API RPS or >40% of PostgreSQL DB time**, confirmed by 30 days of production metrics, AND optimization tactics (query tuning, caching, indexing, read replica offload) have been exhausted with < 20% improvement.
   - **Action:** Extract that single module to its own NestJS microservice per Strangler-Fig pattern. Update ADR-003.
   - **This is NOT a failure of Modular Monolith — it is exactly the design intent.**

2. **TRIGGER 2 (Team Scale):** The team grows beyond **40 software engineers**, and module-level ownership cannot be subdivided cleanly.
   - **Action:** Begin Phase 3 migration to Kubernetes + Service Mesh, extracting services on demand.

3. **TRIGGER 3 (Failure):** In production, the monolith process crashes > 10 times per week due to intra-module cross-contamination that cannot be isolated.
   - **Action:** CSA declares emergency extraction of offending modules; this ADR is updated.

4. **TRIGGER 4 (New Evidence):** A new technology/architecture pattern emerges with peer-reviewed evidence of 10x superiority for this exact workload.
   - **Action:** CSA evaluates via new ADR; this ADR is potentially superseded.

We **explicitly do NOT revisit** this decision:
- Because "microservices sound cool" or due to hype cycles
- Before production launch
- Without 30 days of real production metrics as evidence
- Without CSA sign-off

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §6 Phases & Milestones, §8 Risk Register
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §3 Architectural Style, §4 C4 Component View, §5 Bounded Context Map
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §3 Decision-Making, §13 Violation (boundary enforcement), §15 Architectural Compliance Enforcement
- [ADR-002 Bounded Context Map](ADR-002-bounded-context-map-5-modules.md)
- [ADR-003 Extraction Triggers](ADR-003-microservices-extraction-trigger-criteria.md)
- External: Martin Fowler — MonolithFirst (martinfowler.com/bliki/MonolithFirst.html)
- External: Shopify Engineering — Deconstructing the Monolith (shopify.engineering)
- External: Kelsey Hightower — Monolith -> modular monolith -> microservices timeline

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Sent for Sponsor review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; 5 bounded contexts (per ADR-002); target scale 1,000–5,000 users in the first 6 months with a documented scaling path (no day-one over-provisioning).
