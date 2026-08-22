# ADR-011: Observability — Lightweight Monitoring (Uptime Kuma + `/health` + `/ready` + Structured JSON Logs) over Full LGTM/OLGT Stack / SaaS APM

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: DevOps Lead, SRE SMEs, Backend Lead
- **Date:** 2026-08-07 (Revised & accepted 2026-08-09)
- **Supersedes:** None (foundational production reliability decision)
- **Related:** ADR-001 (Modular Monolith), ADR-003 (Extraction Triggers), ADR-005 (PostgreSQL), ADR-007 (IaC — Docker Compose), ADR-013 (Media Storage)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform needs **proportionate** production observability for Phase 1 — enough to detect outages, triage incidents, and honour the reliability objective, without over-provisioning a monitoring stack that is larger than the application it observes.

- **Phase 1 Infrastructure:** A single, right-sized **Hostinger VPS** (~4 GB RAM / 2 vCPU per ADR-007), raw Linux, no managed K8s, no managed services. Any self-hosted observability components share that same modest CPU/RAM/disk budget with the NestJS app, PostgreSQL 16, and Redis 7.
- **Phase 1 Scale:** **1,000–5,000 users in the first 6 months**, with a documented architectural path to hundreds of thousands **without rewrite** (Charter §2.1 Obj-002). At this scale, a full distributed-tracing + log-aggregation + metrics-TSDB cluster is disproportionate — it would consume more RAM than the application itself.
- **What we genuinely need on Day 1:**
  1. **Uptime detection:** Is the API up? Is the admin SPA reachable? Is TLS about to expire? → alert a human within minutes of an outage.
  2. **Liveness / readiness:** Can the process serve traffic? Are its dependencies (PostgreSQL, Redis, disk) healthy? → drive container restart + deploy gating.
  3. **Structured, correlatable logs:** Every HTTP request, slow query (>200 ms), auth event, media pipeline event, notification send, and BullMQ job outcome — emitted as structured JSON with a correlation/trace ID, searchable on disk.
- **Budget constraint (Phase 1):** **ZERO per-month SaaS observability cost** (Charter forbids paid monitoring SaaS in Phase 1).
- **Data residency (future):** GCC / KSA / MENA user data. No user PII (email, phone, name) may leave the VPS to a foreign SaaS — this rules out all foreign-based observability SaaS by default.
- **No premature complexity, but no dead-ends:** Instrumentation must be **upgrade-ready**. When scale, microservice extraction (ADR-003), or MTTR pain justifies a full LGTM stack (Loki + Grafana + Tempo + Mimir/Prometheus) or a managed APM, we must be able to graduate **without rewriting business logic** — the same principle that makes the Modular Monolith extractable.

A wrong observability choice at this stage means either: (a) a ~5.5 GB monitoring stack that starves a 4 GB VPS and makes the app *slower and less reliable* — the opposite of the goal; or (b) vendor-locked SaaS instrumentation that violates the budget and data-residency constraints and requires a full re-instrumentation project later.

---

## 2. Decision

**✅ WE WILL DEPLOY A LIGHTWEIGHT MONITORING SETUP for Phase 1: application `/health` + `/ready` probes, structured JSON logging to the Docker json-file driver, and a single self-hosted Uptime Kuma container for external uptime + TLS + alerting — all behind an opt-in `monitoring` Docker Compose profile (ADR-007). Instrumentation is kept behind a thin abstraction so a full OpenTelemetry + LGTM stack can be adopted later with zero business-logic rewrite.**

Concrete actions implementing this decision:

1. **Health & Readiness Endpoints (NestJS, `@nestjs/terminus`):**
   - `GET /health` — **liveness**: process is up and the event loop is responsive. Cheap, no external calls. Used by PM2 / container restart policy.
   - `GET /ready` — **readiness**: checks PostgreSQL (`SELECT 1`), Redis (`PING`), and free disk headroom. Used to gate deploys and to signal "safe to route traffic." Returns JSON `{ status, checks: { db, redis, disk }, version, uptime_s }`.
   - Both endpoints are unauthenticated but rate-limited and expose **no PII**.

2. **Structured JSON Logging (application-native, no aggregation backend in Phase 1):**
   - NestJS logger (pino-based) emits **one JSON object per event** to stdout. Docker's `json-file` log driver captures it with rotation (`max-size`, `max-file` per ADR-007) — no Loki, no Elasticsearch.
   - **Mandatory indexed fields on every line:** `app` (`al-fajr-api`), `service` (`http|bullmq|auth|media`), `level` (`DEBUG|INFO|WARN|ERROR`), `module` (`identity|content|engagement|notifications|admin`), `method`, `status`, `trace_id`, `latency_ms`, and — when applicable/authenticated — `user_role`, `content_type`.
   - **Correlation without a tracing backend:** a request-ID middleware assigns/propagates `trace_id` (from an inbound header or newly generated) across the request, its DB/Redis calls, and any BullMQ job it enqueues. Logs are therefore end-to-end correlatable by `trace_id` via `grep`/`jq` on disk — no Tempo required.
   - Raw logs persist under `/var/log/al-fajr/` on the VPS, rotated by `logrotate`. Forensic search = `jq`/`grep -rE` directly on disk.

3. **Uptime Kuma (single container, `monitoring` profile):**
   - Self-hosted **Uptime Kuma** (~200–400 MB RAM incl. its embedded SQLite) runs external black-box monitors: HTTP(S) checks against `/health`, `/ready`, the public API base, and the admin SPA; **TLS certificate-expiry** monitoring; optional keyword checks.
   - **Alerting:** on downtime / cert-expiry / degraded readiness → notify via email + Telegram/Slack webhook (Uptime Kuma has 90+ built-in notifiers, all free).
   - Status history + a public/private status page come built-in — covering the "is it up?" question that dominates Phase-1 operations.

4. **Host & container basics (no TSDB):**
   - Lightweight host/disk/RAM checks via a small cron script that writes JSON metrics into the log stream and trips an Uptime Kuma push monitor if a threshold (e.g. disk >80%, RAM >85%) is breached. No Prometheus TSDB, no Grafana, in Phase 1.

5. **Upgrade-Ready Instrumentation Abstraction (the anti-dead-end guarantee):**
   - All logging/metrics go through a thin internal port (`ObservabilityPort` — `log()`, `metric()`, `span()` no-op-able). Phase 1 wires it to pino + a no-op tracer.
   - The `trace_id` propagation and structured fields are **already OpenTelemetry-shaped**, so the future upgrade is: add `@opentelemetry/sdk-node` + an OTLP exporter and point it at an LGTM backend — **zero changes to controllers, services, or repositories.**

6. **Reliability objective:** the platform's availability/latency objectives (Charter §9) are tracked in Phase 1 by Uptime Kuma uptime percentages + on-disk latency logs (`latency_ms` percentiles computed ad hoc with `jq`). Formal SLO dashboards + error-budget burn alerts arrive with the LGTM upgrade (see Reversal Criteria), not before they are warranted.

---

## 3. Alternatives Considered

### Alternative A: Full LGTM / OLGT Stack self-hosted (OpenTelemetry + Loki + Grafana + Tempo + Prometheus)

Grafana Labs' "big tent" open-source observability: OpenTelemetry instrumentation, Loki for logs, Tempo for traces, Prometheus for metrics, Grafana as the unified UI. Every component Apache-2.0.

- ✅ **Pro:** World-class, unified correlation (log → trace → metric in two clicks). The gold standard for a mature platform.
- ✅ **Pro:** Fully self-hosted → $0 SaaS cost and 100% data-residency compliant.
- ✅ **Pro:** Zero application lock-in when instrumented via pure OpenTelemetry — migrating backends is one exporter-config line.
- ✅ **Pro:** Proven linear scale path to 10M+ users (Grafana Cloud itself runs on it).
- ❌ **Con:** **Disproportionate RAM footprint for Phase 1.** Hard-capped, the stack is ~5.5 GB RAM (Loki ~1 ␣GB, Tempo ~1.5 GB, Prometheus ~2 GB, Grafana ~512 MB, OTel Collector ~512 MB). On the right-sized **4 GB** Phase-1 VPS this is **impossible**; even on a larger box it would dwarf a 1,000–5,000-user app. It would make the platform *less* reliable, not more.
- ❌ **Con:** **Operational weight unjustified at current scale.** 5–6 extra containers, retention tuning, Alertmanager routing, dashboard provisioning — 2–4 hrs/month of SRE care for telemetry almost nobody is reading yet at this user count.
- ➡️ **Disposition:** **Not rejected — deferred.** This is the explicit, pre-designed **upgrade target**. Our instrumentation is kept OTel-shaped precisely so we adopt LGTM the moment scale/MTTR/extraction (ADR-003) justifies it — see §6 Reversal Criteria.

### Alternative B: ELK Stack (Elasticsearch + Logstash + Kibana + APM) self-hosted

- ✅ **Pro:** Elasticsearch full-text log search is unrivalled for ad-hoc forensics.
- ❌ **Con:** **Even heavier than LGTM.** Elasticsearch alone needs ~4 GB heap + ~2 GB FS cache (6–8 GB min); with Logstash + Kibana + beats the stack is 8.5–12.5 GB — multiples of the entire Phase-1 VPS. Immediate fail.
- ❌ **Con:** Disk-I/O intensive (Lucene merges) → would throttle co-located PostgreSQL latency.
- ❌ **Con:** SSPL licensing adds legal surface area for any future managed offering.
- ➡️ **Disposition:** Rejected for Phase 1 and not the preferred future upgrade (LGTM is lighter and OTel-native).

### Alternative C: SaaS APM (Datadog / New Relic / Grafana Cloud)

- ✅ **Pro:** Zero infrastructure, best-in-class UX, one-click correlation, no self-hosting toil.
- ❌ **Con:** **Violates the Phase-1 zero-SaaS budget.** Even conservative usage runs $150+/month — exceeding the entire Phase-1 infrastructure budget.
- ❌ **Con:** **Data-residency veto.** PII in logs (phone, email, name) would leave the VPS to US/EU regions; no KSA/UAE region exists for the major vendors as of 2026 → blocks PDPL/ADGM compliance for MENA expansion.
- ➡️ **Disposition:** Rejected for Phase 1. (Grafana Cloud with a future MENA region remains a possible managed path once budget/residency allow — one OTLP exporter change away, thanks to the abstraction.)

### Alternative D: Lightweight Monitoring — Uptime Kuma + `/health` + `/ready` + Structured JSON Logs (Our Decision)

Proportionate, self-hosted, near-zero overhead; upgrade-ready by design.

- ✅ **Pro:** **Tiny footprint — fits the 4 GB VPS with room to spare.** Uptime Kuma ~200–400 MB; structured logging to the Docker json driver is effectively free (the app logs anyway). Total marginal observability RAM ≈ **200–400 MB vs LGTM's ~5.5 GB** — a **~14× reduction** — leaving the RAM budget for NestJS workers + PostgreSQL buffers + Redis.
- ✅ **Pro:** **$0 cost, forever.** Uptime Kuma is MIT-licensed; JSON logging + `/health` are application-native. No SaaS bill, no free-tier trap.
- ✅ **Pro:** **100% data-residency compliant.** All logs + monitoring stay on the VPS. Phase-2 move of the VPS into KSA/UAE = compliant with zero code change.
- ✅ **Pro:** **Covers the questions that actually matter at this scale:** *Is it up? Is TLS about to expire? Are dependencies healthy? What happened in request `trace_id=…`?* — all answered without a tracing cluster.
- ✅ **Pro:** **Correlatable logs without a backend.** `trace_id` propagation + `jq`/`grep` on disk gives end-to-end request tracing for a single-node monolith — the 20% of tracing value for ~1% of the cost.
- ✅ **Pro:** **No dead-end.** OTel-shaped fields + `ObservabilityPort` mean the LGTM (or Grafana Cloud) upgrade is additive, not a rewrite. We buy simplicity now and keep the option open.
- ✅ **Pro:** **Trivial to operate.** Uptime Kuma is a single container with a friendly UI; the whole setup is one `monitoring` compose profile. Onboarding a new engineer ≈ 1 hour.
- ⚠️ **Trade-off:** **No unified dashboards / distributed-trace waterfall / metrics TSDB in Phase 1.** Deep multi-service latency debugging is not one-click. **Mitigation:** single-node monolith means most latency is answerable from `latency_ms` logs + slow-query logs; the LGTM upgrade path is pre-designed for when this stops being true.
- ⚠️ **Trade-off:** **Log search is `grep`/`jq`, not indexed full-text.** **Mitigation:** mandatory structured fields make targeted queries fast; `logrotate` bounds volume; if forensic search becomes a recurring need, that is itself a Reversal trigger toward Loki.
- ⚠️ **Trade-off:** **No historical metrics retention (no TSDB).** **Mitigation:** Uptime Kuma retains uptime/response-time history; deeper trend retention arrives with Prometheus/Mimir in the upgrade.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alt A — Full LGTM/OLGT (self-hosted) | Alt B — ELK (self-hosted) | Alt C — SaaS APM (Datadog/NR) | Alt D — Lightweight (Uptime Kuma + `/health` + JSON logs) ✅ CHOSEN |
|-----------|--------------------------------------|---------------------------|-------------------------------|---------------------------------------------------------------------|
| **Observability RAM footprint** | ❌ **~5.5 GB** — impossible on 4 GB VPS | ❌ **8.5–12.5 GB** — multiples of the VPS | ✅ 0 MB on-box (SaaS) | ✅ **~200–400 MB** — fits with headroom |
| **Phase-1 monthly cost** | ✅ $0 (self-hosted) | ✅ $0 (self-hosted) | ❌ **$150+/mo** — exceeds infra budget | ✅ **$0** — MIT/app-native |
| **Fit for 1,000–5,000 users** | ❌ Over-provisioned; slows the app | ❌ Fails outright | ⚠️ Works but unaffordable | ✅ **Proportionate — right-sized** |
| **Data residency (PDPL/ADGM)** | ✅ On-VPS | ✅ On-VPS | ❌ **US/EU only — veto** | ✅ **On-VPS** |
| **Uptime + TLS-expiry alerting** | ✅ Grafana/Alertmanager | ⚠️ Watcher setup | ✅ Built-in | ✅ **Uptime Kuma built-in** |
| **Liveness / readiness probes** | ✅ | ✅ | ✅ | ✅ **`/health` + `/ready` (Terminus)** |
| **Log correlation (trace_id)** | ✅ Tempo waterfall | ⚠️ APM bridge config | ✅ One-click | ⚠️ **`trace_id` + `jq`/`grep` (sufficient for single node)** |
| **Distributed tracing waterfall** | ✅ First-class | ✅ APM | ✅ First-class | ❌ Not in Phase 1 (upgrade path ready) |
| **Metrics TSDB / historical trends** | ✅ Prometheus 13-mo | ✅ Metricbeat | ✅ SaaS | ⚠️ Uptime Kuma history only |
| **Operational load (SRE hrs/mo)** | ⚠️ 2–4 hrs | ❌ 16–24 hrs | ✅ <1 hr | ✅ **<1 hr** |
| **Application lock-in** | ✅ Zero (pure OTel) | ⚠️ ECS creep | ⚠️ Dashboards/monitors lock-in | ✅ **Zero — OTel-shaped, port-abstracted** |
| **Upgrade path to full stack** | — (is the target) | ⚠️ Lateral | ⚠️ Contractual | ✅ **Additive: add OTel SDK + exporter, no app rewrite** |
| **VPS Phase-1 fitness — Pass/Fail** | ❌ FAIL (RAM) | ❌ FAIL (RAM/IO) | ❌ FAIL (budget + residency) | ✅ **PASS — every constraint met with headroom** |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Monitoring that is smaller than the app it monitors.** ~200–400 MB vs LGTM's ~5.5 GB frees the RAM budget for NestJS workers + PostgreSQL buffers + Redis — the user-facing app runs *faster and more reliably* because observability isn't starving it.
2. **$0 cost and 100% data-residency compliant from Day 1.** No SaaS bill, no PII leaving the VPS; a Phase-2 move to a KSA/UAE VPS is compliant with zero code change.
3. **The Day-1 operational questions are answered.** "Is it up? Is TLS expiring? Are DB/Redis healthy? What happened in this request?" — all covered by Uptime Kuma + `/health`/`/ready` + correlatable JSON logs.
4. **No dead-end.** Because instrumentation is OTel-shaped and port-abstracted, adopting the full LGTM stack (or Grafana Cloud) later is **additive** — add the SDK + exporter, touch zero business logic. We keep the exact same "extract only when proven necessary" discipline as ADR-003, applied to observability.
5. **Near-zero operational load.** One `monitoring` compose profile, one friendly container, <1 hr/month of care — appropriate for a small team focused on shipping features.
6. **Proportionate engineering.** We spend Phase-1 effort on the product, not on babysitting a telemetry cluster that a few-thousand-user platform does not yet need.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **No unified dashboards / distributed-trace waterfall / metrics TSDB in Phase 1.** **Mitigation:** single-node monolith latency is answerable from `latency_ms` + slow-query logs; the LGTM upgrade is pre-designed and triggers on real signals (§6).
2. **Log search is `grep`/`jq`, not indexed full-text.** **Mitigation:** mandatory structured fields make targeted queries fast; recurring forensic-search need is itself a Loki trigger.
3. **No long-term metrics retention beyond Uptime Kuma history.** **Mitigation:** acceptable at this scale; Prometheus/Mimir arrive with the upgrade when trend analysis is genuinely needed.
4. **Uptime Kuma is self-hosted (single point for external checks).** **Mitigation:** it is a **Tier-2** service — if it is down, the app is still up; `restart: always` in compose; optionally a second free external check (e.g. a cron `curl` from a different host) as belt-and-braces.

### Neutral / Unknown (risks to monitor)
1. **When exactly does the app outgrow lightweight monitoring?** Watched signals: sustained multi-thousand concurrent users, MTTR pain from missing traces, or ADR-003 microservice extraction. Any of these fires the LGTM upgrade (§6).
2. **Log volume growth.** If BullMQ/media logging balloons, disk fills. **Mitigation:** `logrotate` caps + an Uptime Kuma disk-usage push monitor at 80%; DEBUG disabled in production by default.
3. **Uptime Kuma project longevity.** Active MIT project as of 2026; worst case it is a drop-in-replaceable black-box checker (e.g. Gatus) — no application coupling.

---

## 6. Reversal / Exit Criteria (When to Upgrade / Re-Open This Decision)

This decision is revisited — **upgrading toward the full LGTM stack (Alternative A)** — when **any** of:

1. **TRIGGER 1 (Scale / Distributed Tracing Need):** The platform sustains a load where single-node log correlation is no longer sufficient — e.g. **>25,000 monthly active users** or **>150 req/s sustained peak** for 30 consecutive days — **OR** ADR-003 microservice extraction fires for any module (distributed tracing across services becomes necessary).
   - **Action:** Stand up the LGTM stack (Loki + Grafana + Tempo + Prometheus) on an appropriately upgraded / dedicated node; wire the existing `ObservabilityPort` to `@opentelemetry/sdk-node` + OTLP exporter. **Zero business-logic rewrite.** Uptime Kuma + `/health`/`/ready` remain as black-box monitors.

2. **TRIGGER 2 (MTTR Pain):** Over a 90-day window, ≥3 Tier-1 incidents have MTTR materially worsened (>2×) by the absence of unified dashboards or trace waterfalls, certified in writing by the DevOps Lead.
   - **Action:** Adopt LGTM as above (or Grafana Cloud if budget + a MENA region are available).

3. **TRIGGER 3 (Forensic Search Need):** Full-text log forensics over long windows becomes a recurring operational requirement that structured-label `jq`/`grep` cannot serve.
   - **Action:** Introduce Loki (with Bloom filters) as the log backend first; add Tempo/Prometheus if/when Triggers 1–2 also apply.

4. **TRIGGER 4 (Budget + Regional SaaS):** Phase-3 budget formally includes observability SaaS spend **and** a PDPL/ADGM-compliant KSA/UAE region opens for a chosen vendor (e.g. Grafana Cloud/Datadog).
   - **Action:** Change the OTel Collector/exporter destination — one config line — thanks to the vendor-neutral abstraction. App code untouched.

We **explicitly do NOT** stand up a heavy stack:
- Because "real platforms have Grafana" — without a scale/MTTR/extraction trigger above.
- Before the app genuinely needs distributed tracing.
- On a VPS tier where the stack would starve the application.
- Without CSA + DevOps Lead co-sign on the trigger evidence.

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §6 Phase 1 Deployment Architecture (Hostinger VPS), §9 Reliability & SLO Targets, §14 Data Residency & Privacy Requirements, §15 Cost Center Budget Constraints
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §10 Observability & Telemetry Architecture, §11 Security & Compliance (Data Residency)
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §10 Incident Response & MTTR Targets, §14 SLO & Error Budget Policy
- [ADR-001 Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md)
- [ADR-003 Microservices Extraction Triggers](ADR-003-microservices-extraction-trigger-criteria.md) — (extraction fires the distributed-tracing / LGTM upgrade)
- [ADR-005 Primary DB: PostgreSQL 16](ADR-005-primary-database-postgresql-16.md) — (`/ready` DB probe; slow-query structured logs)
- [ADR-007 IaC: Docker Compose](ADR-007-iac-phase-1-docker-compose-shell-scripts.md) — (`monitoring` compose profile hosts Uptime Kuma; `json-file` log driver + rotation)
- [ADR-013 Media Storage: S3-Compatible](ADR-013-media-storage-s3-compatible-object-storage.md) — (future Tempo/Prometheus long-term block storage target on LGTM upgrade)
- External: Uptime Kuma (MIT) — github.com/louislam/uptime-kuma
- External: NestJS Terminus Health Checks — docs.nestjs.com/recipes/terminus
- External: pino — structured JSON logging for Node.js — getpino.io
- External: OpenTelemetry (v1.x OTLP Specification, 2026) — opentelemetry.io (the upgrade-path instrumentation standard)
- External: Grafana Labs "LGTM Stack" Reference Architecture — grafana.com/docs/lgtm (the deferred upgrade target)
- External: KSA PDPL Royal Decree M/45 + 2025 Implementing Regulations — data.gov.sa; UAE ADGM Data Protection Regulations 2021

---

*Decision Log:*
- 2026-08-07: PROPOSED — Original draft specified the full OLGT/LGTM stack (OpenTelemetry + Loki + Grafana + Tempo + Prometheus, ~5.5 GB RAM). Sent for DevOps Lead + Sponsor + Legal review.
- 2026-08-09: ACCEPTED (revised) — Signed by Project Sponsor as part of the Phase 0 consolidation pass. **Binding decision:** replace the full OLGT stack with **lightweight monitoring** (Uptime Kuma + `/health` + `/ready` + structured JSON logs, ~200–400 MB) proportionate to the 1,000–5,000-user Phase-1 scale on the right-sized 4 GB VPS. The LGTM stack is retained as the pre-designed, OTel-ready **upgrade target** (Reversal Triggers 1–4). Applied: project name **Al-Fajr**; relative doc links; file renamed to `ADR-011-observability-lightweight-monitoring.md`.
