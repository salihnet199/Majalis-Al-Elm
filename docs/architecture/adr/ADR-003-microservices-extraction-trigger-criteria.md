# ADR-003: Microservices Extraction Trigger Criteria — When to Split the Modular Monolith

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: BKE, DBA, DEV, SEC, PFE
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-001 (Modular Monolith), ADR-002 (Bounded Context Map + Extraction Paths), ADR-007 (IaC)

---

## 1. Context & Problem Statement

Per ADR-001, the Al-Fajr Platform is built as a **Modular Monolith** for Phase 1. The entire strategic value of that pattern is its evolutionary path: each Bounded Context module = a future microservice boundary. However, the most dangerous phase in a modular monolith's lifecycle is **the transition decision itself**.

If we extract TOO EARLY:
- We pay distributed systems tax (network, sagas, service discovery, CI/CD per service) for zero proven benefit
- Hostinger VPS becomes operationally unmanageable (self-hosted orchestration or manual multi-deploy)
- We cement wrong boundaries before production data teaches us what the real boundaries should be

If we extract TOO LATE:
- Single DB write bottleneck causes cascading failures under load
- A single hot module degrades performance for ALL other modules sharing the process
- Team parallelism hits the wall (one large deploy = all hands on deck)

The **worst possible outcome is premature extraction (worse than extracting too late). The industry is littered with failed startups that moved to microservices at 5,000 users and went bankrupt on infrastructure costs before finding product-market fit.

Three alternative philosophies exist for WHEN to extract:
1. Extract immediately (from day one)
2. Use measurable, objective trigger criteria (evidence-based)
3. Never extract — scale the monolith vertically forever

---

## 2. Decision

**✅ WE WILL EXTRACT A MODULE TO A MICROSERVICE ONLY WHEN OBJECTIVE, MEASURABLE TRIGGER CRITERIA ARE MET AND SUSTAINED FOR 30 CONSECUTIVE DAYS. NO EXCEPTIONS.**

### Trigger 1 (Performance / Resource Saturation — PRIMARY TRIGGER)

Any single Bounded Context module meets ALL of the following:

1. **CPU/DB Metric (Any one of these:**
   - The module accounts for **>40% of total production API RPS**, confirmed by Prometheus `http_server_requests_seconds_count` per module route prefix
   - OR the module accounts for **>40% of PostgreSQL total query time** (sum of `pg_stat_statements` grouped by table prefix `id_`, `ct_`, `eg_`, `nt_`, `ad_`)
   - OR the module accounts for **>40% of PostgreSQL total CPU usage** (per-process CPU attributable via `pg_stat_activity` grouped by query table access patterns)

2. **AND Optimization Exhaustion Check (ALL standard optimization tactics have been attempted with <20% improvement on the primary metric:**
   - Query tuning + indexing reviewed by DBA
   - Redis caching (read-through, write-behind where applicable)
   - Read replica offload (for read-heavy workloads
   - Table partitioning (time-series or large tables)
   - Connection pool tuning (PgBouncer)
   - Query batching / N+1 elimination
   - Background job offload to BullMQ worker
   - CDN offload (for media/content workloads)

3. **AND Duration: Metrics are sustained for **30 CONSECUTIVE DAYS** (not a one-time spike; not a batch-job anomaly).

If ALL three conditions are true → the module is a **candidate for extraction**.

### Trigger 2 (Team Scale — ORGANIZATIONAL TRIGGER)

The engineering organization grows to **>40 full-time software engineers**, AND module-level ownership cannot be cleanly subdivided further within the monorepo** (5 modules × 8 engineers per module = theoretical ceiling before Conway's Law forces boundary pressure).

- 40 engineers = 5 modules × 8 engineers each. Beyond this, per-module team sizes exceed the "two-pizza team" heuristic (6-8 people).
- Trigger 2 activates independent of Trigger 1. Even if no module is a performance bottleneck, organizational scaling pressure may justify early extraction of 1-2 modules to give growing teams clear deployment/operational independence.

### Trigger 3 (Reliability / Failure Isolation — EMERGENCY TRIGGER)

The monolith process crashes **>10 times per week** due to **intra-module cross-contamination** (root-caused by Module A's code path corrupting Module B's shared memory / connection pool / DI state), AND attempts at isolation within the monolith (PM2, exception filters, queue isolation) have failed to reduce crashes below 3/week for 3 consecutive weeks.

- This is an **emergency extraction trigger**. Action: CSA declares emergency extraction of offending modules.
- Note: "Crashes from bugs in Module A that Module A's own exception filter could have caught" do NOT count. The crash must be provably due to cross-module contamination.

### Trigger 4 (Regulatory / Data Sovereignty — EXCEPTIONAL TRIGGER)

A new regulatory requirement (e.g., data residency in KSA-only, GDPR-style data export for EU users, PCI-DSS if payments added later) **cannot be met within a shared-DB monolith** and requires physical separation of a module's data plane.

- Extraction scope limited to the module(s) affected by the regulation only.

### Extraction Process Checklist (Activated When Any Triggers Fire)

1. **CSA convenes Extraction Review Board** (CSA + BKE + DBA + DEV + PFE) within 5 business days
2. **Confirm trigger criteria are met** via Grafana dashboards audit (30-day data exported and verified)
3. **Select extraction target** from ADR-002 Extraction Paths (ordered by complexity: BC04 → BC02 → BC03 → BC01 → BC05)
4. **Draft extraction plan**:
   - Week 1-2: Stand up new NestJS microservice skeleton in monorepo (gRPC internal API + Kafka event consumer)
   - Week 2-3: Logical replication of target prefix tables (e.g., `nt_*`) to new PostgreSQL schema; dual-write validation
   - Week 3-4: Cut Event Bus transport from in-process → Kafka; run both in parallel (shadow traffic); API gateway routes `%` of traffic to new service
   - Week 4-5: 100% cutover; remove old module code from monolith; run 7 days with rollback option
   - Week 5-6: Remove dual-write; decommission old code paths; update ADR-001 and this ADR
5. **Write post-extraction retro** at 30 days. Success metrics: P99 latency improved/stable, crash rate <2/week, deploy frequency ≥1/day on new service.

---

## 3. Alternatives Considered

### Alternative A: Extract Microservices Immediately (Day 1)

Build 5 independent NestJS microservices from MVP launch. Distributed from the start.

- ✅ **Pro:** Never need to plan for a "transition" — start distributed, stay distributed
- ✅ **Pro:** Perfect failure isolation; one service crash = one feature down
- ✅ **Pro:** Team boundaries 100% independent deploy cadence
- ❌ **Con:** **Catastrophic for MVP timeline.** Network boundaries + Sagas + Kafka cluster + service discovery + k3s on Hostinger VPS + CI/CD per service = 8-12 weeks of pure infrastructure work before first feature ships. Budgeted Phase 1 timeline is 4-6 months; 3 months of infra = 50% MVP slippage.
- ❌ **Con:** Hostinger VPS anti-pattern. We would need to self-host k3s (single-node Kubernetes defeats the purpose) or manually deploy 5 PM2 clusters. Neither is operationally sane.
- ❌ **Con:** Distributed transactions (Saga pattern) for simple flows like "user registers → welcome notification fires → default engagement record created → audit log". In monolith = 1 DB transaction; in microservices = 4 services, 4 compensating transactions, 4 failure modes to design for.
- ❌ **Con:** Observability must be distributed-trace-native from day one. Tempo/OpenTelemetry mandatory. High cost.
- ❌ **Con:** Boundaries are set in stone BEFORE production teaches us the real ones. Industry data: 60-70% of microservice boundaries are wrong first time and require re-architecting anyway.
- ❌ **Con:** Resource utilization is poor on a single VPS. 5 Node.js processes + 5 PostgreSQL schemas + Redis + Kafka + Nginx = memory contention even on 16GB VPS.

### Alternative B: Evidence-Based Trigger Criteria (Our Decision — Chosen)

Stay modular monolith. Extract only when proven necessary by 30 days of production metrics.

- ✅ **Pro:** MVP ships fast. No distributed systems tax in Phase 1. ACID transactions preserved.
- ✅ **Pro:** Extraction when BENEFIT is proven by data, not hype. Every extraction is justified.
- ✅ **Pro:** Hostinger VPS optimal fit. One app cluster. Operationally manageable by one DevOps expert.
- ✅ **Pro:** Industry best practice 2020-2026. Shopify, GitLab, Discord, Stack Overflow ALL followed this exact pattern.
- ✅ **Pro:** Trigger criteria are MEASURABLE and OBJECTIVE. No emotional debates ("should we extract yet?") are resolved by Grafana dashboards.
- ✅ **Pro:** Strangler-Fig extraction = mechanical, low-risk. ADR-002 extraction paths reduce each extraction to a 6-week checklist.
- ⚠️ **Trade-off:** Blast radius shared. A crash in Module A can theoretically crash the whole process. **Mitigated by:** PM2 cluster with 4 workers (one crash = 25% capacity loss for <30s auto-restart; BullMQ isolates heavy jobs; per-module NestJS exception filters; rate limiting; WAF at edge.
- ⚠️ **Trade-off:** Shared DB write bottleneck. **Mitigated by:** PgBouncer pooling; read replicas in Phase 2; table partitioning; Redis caching; Trigger 1 activates at 40% precisely to head off this bottleneck BEFORE it causes outage.
- ⚠️ **Trade-off:** Requires discipline. Boundaries enforced in CI. **Mitigated by:** ESLint rules + ArchUnit tests + DBA review + CSA sign-off.

### Alternative C: Never Extract (Scale Vertically Forever)

Never extract. Scale the monolith vertically forever. Larger VPS → bigger VPS → biggest VPS → eventually maybe multi-primary PostgreSQL.

- ✅ **Pro:** Simplest possible. Zero transition risk.
- ✅ **Pro:** ACID forever. Zero distributed systems complexity ever.
- ❌ **Con:** **Hard ceiling on scale.** PostgreSQL single-primary write throughput has a physical limit (~20-30k write TPS on the largest available VPS. As we grow toward hundreds of thousands of users with a meaningful DAU write rate, we will eventually approach this.
- ❌ **Con:** Single point of failure for write plane. One PostgreSQL crash = platform offline until failover completes.
- ❌ **Con:** Team scale ceiling. 40+ engineers working on one deployable = merge conflicts, 2-hour rolling deploys, no independent release cadence.
- ❌ **Con:** No independent scalability per-module. If Notifications is 10x load, we can't independently scale Notifications without scaling Identity + Admin too (waste).
- ❌ **Con:** Vendor lock-in to biggest-VPS only. Cannot move to multi-cloud later without rewrite.
- ❌ **Con:** Explicitly violates Project Charter §2.1 Objective 002 "scale to hundreds of thousands of users without architectural rewrite".

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — Extract Day 1 | Alternative B — Trigger-Based ✅ CHOSEN | Alternative C — Never Extract |
|-----------|--------------------------------|---------------------------------------|---------------------------------|
| **MVP Delivery Timeline** | ❌ 8-12 months (3 months pure infra) | ✅ 4-6 months (optimal) | ✅ 4-5 months (fastest) |
| **Phase 1 Ops Complexity (VPS)** | ❌ Anti-pattern; k3s or 5× PM2 clusters | ✅ 1× app cluster; manageable | ✅ Simplest possible |
| **Data Consistency Model** | ❌ Eventual everywhere (sagas) | ✅ ACID in Phase 1; eventual on extract | ✅ ACID forever |
| **Path to Hundreds of Thousands of Users** | ✅ Native horizontal | ✅ Gradual; extract bottlenecks only | ❌ Hard ceiling before that scale |
| **Team Scale to 40+ Engineers** | ✅ Perfect isolation | ⚠️ Good until Trigger 2 fires; then split | ❌ Chaos; one deploy = all hands |
| **Failure Isolation** | ✅ Per-service | ⚠️ Shared process (mitigated) | ❌ Worst (fully coupled) |
| **Testing Cost Phase 1** | ❌ Contract tests × 5² = 25 test suites | ✅ In-process tests (cheap) | ✅ In-process tests (cheapest) |
| **Cost Phase 1 Budget Fit** | ❌ 5-10× infra cost | ✅ VPS budget-perfect | ✅ Minimal cost |
| **Boundary Correctness Confidence** | ❌ 30-40% correct (pre-production guesses) | ✅ 80-90% correct (production-informed) | ⚠️ Doesn't matter (one codebase) |
| **Transition Risk** | — (already there) | ✅ Low; Strangler-Fig gradual | ❌ None; but hard ceiling hit = rewrite |
| **Phase 1 DevOps Headcount Requirement** | ❌ 2-3 DevOps full time | ⚠️ 1 DevOps (manageable load) | ✅ 0.5 DevOps |
| **Project Charter Compliance** | ❌ Violates §3.1 VPS target, §6 MVP timeline | ✅ Aligns §2.1 scale + §3.1 VPS | ❌ Violates §2.1 Obj-002 scaling path |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Zero premature extraction risk.** Every microservice we ever build will be one we PROVED we needed with data. Industry consensus: this is the #1 predictor of startup infrastructure success in 2020s.
2. **Objective trigger criteria END DEBATE.** "Should we extract?" meetings are replaced with "Does Module X meet Trigger 1? Show me the 30-day Grafana export." Politics/hype eliminated.
3. **Strangler-Fig is the lowest-risk extraction pattern known.** ADR-002 documents each module's path. A 6-week extraction plan is a checklist, not research.
4. **Aligned with Project Charter §2.1.** Scale to hundreds of thousands of users without full architectural rewrite. ✓
5. **Aligned with Architecture Vision §3.2.** "Extract when load testing proves a module is a bottleneck." ✓
6. **Team scaling trigger (Trigger 2) respects Conway's Law.** When 40 engineers join, they get independent deploy boundaries matching their team structure.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Blast radius is shared in Phase 1.** A memory leak in Module X affects all modules. **Mitigation:** (a) PM2 cluster mode with `max_memory_restart` per worker; (b) BullMQ queues isolate CPU-heavy work (transcoding, notification fanout) from API handlers; (c) per-module NestJS Exception Filters catch errors before they reach the process boundary; (d) Nginx WAF + per-route rate limiting prevent abuse cascading.
2. **Shared DB = noisy-neighbor problem.** A long-running report query in BC05 Admin can slow down BC01 Identity login queries. **Mitigation:** (a) PgBouncer transaction-level pooling; (b) PostgreSQL statement_timeout set per-user (admin user gets 30s; identity user gets 2s); (c) Read replicas added in Phase 2 — all BC05 analytics queries offloaded to replica automatically via TypeORM replication config.
3. **Trigger 1 set at 40% is conservative.** Could we go to 60%? Maybe. But 40% gives us 2x headroom before the bottleneck becomes an outage. We err on the side of safety. **Mitigation:** CSA can relax Trigger threshold to 50% after 6 months of stable production if no bottleneck incidents.

### Neutral / Unknown (risks to monitor)
1. **Will 30 days be long enough to distinguish signal from noise?** If we see a module at 42% for 29 days then drops to 38% due to a caching fix → we made the right call. The 30-day rule prevents whipsaw. We will revisit the duration after the first extraction.
2. **Can we really extract a module in 6 weeks?** BC04 Notifications (simplest, event-driven, no outbound cross-module writes) is the test case. If BC04 takes >8 weeks, we update the extraction plan timelines and potentially add Trigger criteria.
3. **Will Trigger 2 (40 engineers) fire before Trigger 1?** Possible if business grows engineering faster than user base. If we reach 40 engineers before the user base saturates any module → organizational pressure exceeds technical pressure. Both triggers are OR'd — either is sufficient.

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER A: False Negative** — A module causes a production outage (≥30 mins P99 latency or ≥1 hr downtime) due to shared monolith resources, AND post-incident analysis determines that extraction BEFORE 40% threshold would have prevented the outage.
   - **Action:** CSA lowers Trigger 1 threshold from 40% → 30% and convenes immediate extraction of the offending module. Retro this ADR.

2. **TRIGGER B: False Positive** — First extraction completes, post-extraction 30-day retro shows <10% improvement in P99 latency, zero crash rate improvement, and ops cost increased >50%.
   - **Action:** Triggers were too aggressive. CSA raises Trigger 1 threshold from 40% → 50% and adds additional requirement of >$X monthly cost savings justification. Retro this ADR.

3. **TRIGGER C: Paradigm Shift** — A new technology (e.g., PostgreSQL 18 with built-in connection pooling + workload-dependent query routing + row-level security namespacing) materially changes the shared-DB trade-off calculus.
   - **Action:** CSA evaluates via new ADR. Could extend Trigger 1 to 60-70% or modify extraction checklist. This ADR potentially superseded.

4. **TRIGGER D: Acquisition / Merger / Platform Pivot** — Business requires multi-region active-active HA before any module hits Trigger 1.
   - **Action:** Immediate extraction of the 1-2 modules most critical to multi-region (BC01 Identity and BC02 Content). Update this ADR.

We **explicitly do NOT revisit** this decision:
- Due to microservices hype cycles or "FAANG does it" arguments
- Before production launch
- Without 30 days of production metrics as evidence
- Without CSA sign-off and post-incident data (for Trigger A)

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §2.1 Business Objectives (Obj-001 MVP, Obj-002 path to hundreds of thousands of users, Obj-004 99.9% SLA), §3.1 Scope (Hostinger VPS target, Phase 1 budget)
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §3.2 Modular Monolith Rationale ("extract when load testing proves bottleneck"), §5 Bounded Context Map + Strangler-Fig Path
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §3.1 Class A decisions (this is Class A), §13 Violation, §15 Architectural Compliance (boundary enforcement mechanisms)
- [ADR-001 Architecture Pattern — Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) §2 Decision item 6 (extraction trigger reference), §6 Reversal Criteria (the triggers referenced there are defined formally HERE)
- [ADR-002 Bounded Context Map](ADR-002-bounded-context-map-5-modules.md) §2.5 Extraction Paths (the mechanical extraction checklist this ADR operationalizes)
- External: Martin Fowler — StranglerFigApplication (martinfowler.com/bliki/StranglerFigApplication.html)
- External: Shopify Engineering — Deconstructing the Monolith: Designing the Extraction Plan (shopify.engineering)
- External: Team Topologies (Matthew Skelton & Manuel Pais) — Conway's Law, Cognitive Load per Stream-Aligned Team, "two-pizza team heuristic
- External: Google SRE Book — Chapter 6 Distributed Periodicals, Chapter 23 Managing Critical State

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Defined 4 triggers + 6-week extraction checklist. Sent for Sponsor + PFE + DBA + DEV review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; 5 bounded contexts; scale framing aligned to a documented path to hundreds of thousands of users (no 1M/500K day-one claims); removed out-of-scope progress reference; relative doc links.
