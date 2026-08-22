# ADR-004: API Style — REST with JSON:API Conventions over GraphQL / gRPC for MVP

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: BKE, MOB, FEA, SEC, PFE
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-001 (Modular Monolith), ADR-005 (PostgreSQL), ADR-008 (Auth Strategy)

---

## 1. Context & Problem Statement

The Al-Fajr Platform exposes APIs to three consumers:
1. **Flutter Mobile App** (iOS + Android, 5 languages, RTL/LTR) — primary user-facing consumer
2. **React Admin SPA** — internal content team / moderator consumer
3. **Future internal NestJS microservices** (Phase 2+, post ADR-003 extraction trigger) — internal service-to-service consumer

The API style choice cascades into: frontend architecture (data fetching libraries), caching strategy (CDN, Redis), backend controller structure, observability (logging/tracing per endpoint), team learning curves, and Phase 2 microservice internal API choices.

A wrong choice here causes:
- **GraphQL too early:** Massive N+1 query explosion, cache invalidation nightmares, impossible CDN caching, security attack surface (depth/complexity attacks), 6+ months of backend resolver tuning before MVP stabilizes
- **gRPC externally:** Flutter gRPC-web support is immature; React SPA needs Envoy/grpc-gateway proxy; debugging tools for gRPC-web are limited compared to REST
- **REST-only (no convention):** Every engineer reinvents pagination/filtering/error format; 3 client teams (MOB/FEA/Internal) write 3 different parsing layers; no reusability

Three concrete alternatives evaluated, with Phase 1 MVP constraints (Hostinger VPS, no dedicated API gateway beyond Nginx, Flutter 3.x + React 18 clients, no courses/quizzes/certificates in MVP).

---

## 2. Decision

**✅ WE WILL USE REST with JSON:API v1.1 CONVENTIONS for ALL external-facing APIs (Mobile + Admin). Internal cross-module calls within the monolith use HTTP in-process. Phase 2+ microservice INTERNAL APIs may use gRPC; external surface remains REST JSON:API.**

### 2.1 JSON:API Conventions Enforced (Mandatory Minimum)

| Area | JSON:API Convention | Our Implementation |
|------|--------------------|--------------------|
| **Media Type** | `application/vnd.api+json` | Content-Type header for all responses. 415 Unsupported Media Type for other types on write endpoints. |
| **Top-Level Structure** | `{ "data": ..., "errors": ..., "meta": ..., "links": ..., "included": ... }` | All responses MUST use this envelope. NEVER return raw resource at top level. |
| **Resource Objects** | `{ "type": "...", "id": "...", "attributes": {...}, "relationships": {...} }` | UUIDv7 for `id` (ADR-005). `type` = kebab-case plural (`users`, `audio-contents`, `comments`). |
| **URL Structure** | Plural resource collections: `GET /api/v1/users`, `GET /api/v1/audio-contents/{id}` | All API routes prefixed `/api/v1/`. `/v1` in path (not header) for cache-friendly routing. |
| **CRUD Verbs** | GET (read), POST (create), PATCH (update partial), DELETE (remove) | NO `POST /updateUser`. PATCH with JSON:API resource object for partial updates. PUT forbidden (full replace only; not used). |
| **Collection Filtering** | `?filter[field]=value&filter[field][op]=value` | NestJS `QueryFilter` pipe validates. `filter[status]=published`, `filter[createdAt][gte]=2026-01-01`. |
| **Collection Sorting** | `?sort=-createdAt,title` | Minus = descending. Maximum 3 sort fields per request. PFE enforced via CI perf budget. |
| **Collection Pagination** | `?page[number]=1&page[size]=20` (page-based) OR `?page[cursor]=base64&page[size]=20` (cursor for infinite scroll) | Mobile list endpoints default to cursor pagination (Flutter infinite scroll). Admin table endpoints default to page-based. Default `page[size]=20`, max `page[size]=100` (hard limit enforced). |
| **Related Resource Inclusion** | `?include=author,category` | Side-load related resources in `included[]` array. Max 2 include levels. N+1 prevention: TypeORM `find({ relations: [...] })` used. |
| **Sparse Fieldsets** | `?fields[users]=id,name,avatar&fields[comments]=id,body` | Reduces payload size. Critical for Flutter mobile performance on low-bandwidth MENA networks. |
| **Error Format** | `{ "errors": [{ "id": "...", "status": "404", "code": "USER_NOT_FOUND", "title": "...", "detail": "...", "source": { "pointer": "/data/attributes/email" }, "meta": {...} }] }` | All errors (validation, auth, business, 5xx) use this format. No ad-hoc `{ "message": "error" }` ever. Custom exception filter in NestJS core module enforces this. |
| **Rate Limit Headers** | `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset` | Redis-backed rate limiting per endpoint class (auth endpoints: strictest, content read: most lenient). 429 Too Many Requests returns JSON:API error with `code=RATE_LIMITED`. |
| **Hypermedia Links** | `links.self`, `links.next`, `links.prev`, `links.first`, `links.last` | Collection responses MUST include pagination links. Single resource responses include `links.self`. |

### 2.2 API Surface Architecture

```
┌────────────────────────────────────────────────────────────────────┐
│                        API LAYER ARCHITECTURE                      │
├────────────────────────────────────────────────────────────────────┤
│                                                                    │
│  External Clients                    External API Surface          │
│  ┌────────────────┐                 ┌─────────────────────────┐   │
│  │ Flutter Mobile │───HTTPS/TLS 1.3▶│  /api/v1/*              │   │
│  │  (iOS+Android) │                 │  REST + JSON:API v1.1   │   │
│  └────────────────┘                 │  JWT RS256 Bearer Auth  │   │
│                                     │  Rate Limiting (Redis)  │   │
│  ┌────────────────┐                 │  Cache: CDN + Redis     │   │
│  │  React Admin   │───HTTPS/TLS 1.3▶│  Pagination + Filtering │   │
│  │    SPA         │                 │  (NestJS Controllers)   │   │
│  └────────────────┘                 └────────────┬────────────┘   │
│                                                  │                │
│                                                  ▼                │
│                                     ┌─────────────────────────┐   │
│                                     │  NestJS Module Public   │   │
│                                     │  Presentation Layer     │   │
│                                     │  (Controllers + DTOs)   │   │
│                                     └────────────┬────────────┘   │
│                                                  │                │
│    Internal (Monolith In-Process)                ▼                │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Module → Module Query API calls / Domain Events Bus        │  │
│  │  (ADR-002 Cross-Boundary Rules — Direct Imports FORBIDDEN)  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Phase 2+ Internal (Post-Extraction Microservices)                 │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Service → Service: gRPC (Protobuf, internal only)          │  │
│  │  via Kafka events + gRPC internal API                       │  │
│  │  External surface: STILL REST JSON:API via API Gateway      │  │
│  └─────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

### 2.3 Concrete Actions

1. NestJS Core Module ships: `JsonApiExceptionFilter` (enforces error format), `JsonApiResponseInterceptor` (enforces envelope/links), `PaginationPipe` (enforces page/cursor rules), `SparseFieldsInterceptor`, `RateLimitGuard`.
2. Each of 5 Bounded Context modules publishes a Public Query Controller + Public Command Controller under `/api/v1/{resource-group}`.
3. OpenAPI 3.1 spec auto-generated from NestJS via `@nestjs/swagger` plugin; JSON:API extensions via vendor extensions (`x-json-api`).
4. Flutter client: Riverpod + `json_api` Dart package for standardized parsing. No custom response mapping.
5. React Admin: `@json-api/client` or `react-query` with custom JSON:API fetcher hook. No custom parsing per endpoint.
6. Security: Nginx WAF + JSON Schema validation at edge for all POST/PATCH bodies before they reach NestJS. SEC team defines max depth/complexity per endpoint class.

---

## 3. Alternatives Considered

### Alternative A: GraphQL (Full External API in GraphQL)

Single `/graphql` endpoint for Mobile + Admin. Queries for reads, Mutations for writes. Apollo Server (NestJS `@nestjs/graphql`) + DataLoader for N+1.

- ✅ **Pro:** Flexibility. Frontend fetches exactly what it needs, no overfetching. Mobile and Admin can share one schema yet fetch differently shaped data.
- ✅ **Pro:** Evolve API without versioning. Add fields without breaking old clients.
- ✅ **Pro:** GraphQL subscriptions for realtime (e.g., notification count, new comment on a watched content).
- ❌ **Con:** **Caching is HARD.** HTTP-level caching (CDN, browser, Nginx proxy cache) does not work — every GraphQL POST is a POST to one endpoint. Response caching requires custom GraphQL CDN (e.g., Stellate, $$$) or per-client cache (Apollo Cache). MVP budget = no paid CDN add-ons.
- ❌ **Con:** **N+1 query explosion risk.** Dataloader must be wired for EVERY resolver. A single missing DataLoader on the mobile home feed query (50 content cards × author × category × tags) = 151 DB hits per request. At even a modest sustained request rate this multiplies into thousands of DB queries/second. DB dead. Requires 2-3 months of resolver tuning + load testing before MVP launch.
- ❌ **Con:** **Security attack surface.** Depth attacks (query nested 20 levels), complexity attacks (100 fields × aliases × fragments = 10,000 resolver executions), batching attacks. Must implement depth limit, complexity limit, query cost analysis, persisted queries. All custom development work.
- ❌ **Con:** **NestJS GraphQL + TypeORM integration is weaker than REST.** TypeORM relations vs GraphQL `@ResolveField` creates two sources of truth. DataLoader queries bypass ORM-level caching.
- ❌ **Con:** **Team learning curve high.** MOB (Flutter) + FEA (React) + BKE (Backend) all must learn GraphQL idioms. Flutter GraphQL ecosystem is smaller than REST (packages are less maintained).
- ❌ **Con:** **Error surface harder to debug.** One endpoint → one log line → 100 different queries. Correlating a slow request in mobile to a specific query shape requires custom tracing instrumentation.
- ❌ **Con:** **MVP scope doesn't need it.** MVP content types are FIXED. Admin endpoints are well-defined. The "flexibility" benefit GraphQL offers is not required when the product surface is already locked in the Charter.

### Alternative B: gRPC Internal + REST External (Hybrid)

Phase 1 external: REST (custom convention, NOT JSON:API). Phase 1 internal: ALSO use NestJS microservices transport (TCP or Redis pub/sub) with protobuf contracts "pretending" we're microservices. All backend internal interfaces defined as `.proto` files.

- ✅ **Pro:** Internal contracts strongly-typed via Protobuf. Future gRPC extraction (ADR-003) = zero contract rewrite.
- ✅ **Pro:** NestJS supports hybrid REST + Microservice transport natively.
- ❌ **Con:** **MVP phase = 100% in-process monolith.** The TCP/microservice transport layer adds serialization overhead for inter-module calls that are direct function calls in memory. Every cross-module call goes through TCP loopback on Hostinger VPS. Performance WORSE than direct function call + adds latency.
- ❌ **Con:** **Protobuf contracts for EVERYTHING slows MVP.** Every entity, every DTO, every event defined twice (TypeScript interface + .proto file). Code generation step in CI. BKE velocity cut ~30%.
- ❌ **Con:** **REST external convention NOT defined.** This alternative explicitly skips JSON:API. We end up with the worst of both: REST without caching/error/filter standards, plus protobuf overhead without distributed benefits.
- ❌ **Con:** **Maintenance burden.** Two contract systems to maintain (REST DTOs + protobuf) for 5 modules, 50+ resources, 200+ endpoints.
- ❌ **Con:** **Debugging harder.** Internal call stack traces jump through TCP transport; OTel spans harder to correlate.

### Alternative C: REST-only with JSON:API v1.1 Conventions (Our Decision — Chosen)

External surface: REST + JSON:API conventions. Internal: in-process HTTP calls (NestJS same-process) + Domain Events Bus. Phase 2 microservice internal = gRPC (optional, decision deferred to ADR-003 extraction time).

- ✅ **Pro:** **Caching is TRIVIAL.** GET `/api/v1/audio-contents?page[size]=20` → CDN-cacheable. GET `/api/v1/audio-contents/{id}` → browser-cacheable + Redis cache key = URL. Nginx `proxy_cache` works out of the box. Mobile Flutter HTTP cache works. Zero custom caching work in MVP.
- ✅ **Pro:** **N+1 query prevention BAKED IN via JSON:API `include` + TypeORM `relations`.** `?include=author,category` → one TypeORM query with JOINs = one DB round-trip. Query builder in NestJS controller forces us to think about relations at code time. No DataLoader required.
- ✅ **Pro:** **Uniform error/pagination/filtering format.** Three client teams (MOB/FEA/Internal) use ONE parser. `json_api` Dart package + `@json-api/client` TS package. No custom per-endpoint serialization logic.
- ✅ **Pro:** **Observability native.** Each endpoint = unique URL = a stable, greppable key in our structured JSON logs (ADR-011 lightweight monitoring). Slow endpoint? Filter logs by route `/api/v1/comments?filter[contentId]=xxx`. Per-request correlation IDs make tracing fast. Debugging is fast without a heavy metrics stack.
- ✅ **Pro:** **NestJS integration is FIRST-CLASS.** Controllers + DTOs + Pipes + Guards = clean, idiomatic. Swagger/OpenAPI auto-generated. Every NestJS tutorial/Stack Overflow answer uses REST.
- ✅ **Pro:** **Security surface small.** Each endpoint has a single HTTP method + single URL shape. Rate limit per endpoint class. Input validation via DTOs + class-validator. WAF blocks malformed GETs/POSTs before NestJS even sees them.
- ✅ **Pro:** **Lowest team learning curve.** REST is universal. Flutter `http` + `json_api` package. React `axios` / `react-query` with JSON:API fetcher. All 10 expert accounts know REST.
- ⚠️ **Trade-off:** Overfetching possible. Mobile list endpoint returns 3 fields it doesn't need because Admin same endpoint uses 8. **Mitigation:** Sparse fieldsets (`fields[]`) allow the mobile to request only the fields it uses per request. Also: if a route genuinely needs two different shapes (mobile vs admin), we create two separate NestJS controllers (`PublicContentController` + `AdminContentController`) with different response types and permission models. This is EXPLICITLY allowed.
- ⚠️ **Trade-off:** Evolve requires `/v2` some day. Adding fields to `attributes` is non-breaking; removing requires `/api/v2/`. **Mitigation:** We design schemas with extensibility (extra JSONB `attributes_extra` column per table for unforeseen fields). Version bump frequency expected: once every 12-18 months, acceptable.
- ⚠️ **Trade-off:** No native realtime in JSON:API spec (beyond SSE/WebSocket which we can bolt on). **Mitigation:** Real-time features (notifications badge, new comment) use FCM push + periodic poll (every 60s) in MVP. If realtime becomes a Phase 2 priority, ADD a `/ws/notifications` WebSocket endpoint (sidecar) — do NOT abandon REST JSON:API.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — GraphQL Full | Alternative B — gRPC Int + REST Ext (No Convention) | Alternative C — REST + JSON:API ✅ CHOSEN |
|-----------|------------------------------|---------------------------------------------------|------------------------------------------|
| **MVP Delivery Speed** | ❌ +3 months (resolver tuning, DataLoader, security) | ⚠️ -1 month (protobuf doubles contract work) | ✅ Fastest — NestJS REST is native |
| **N+1 Query Risk** | ❌ HIGH (Dataloader gaps = DB death) | ⚠️ MEDIUM (no standard includes) | ✅ LOW (TypeORM relations + `include` param) |
| **CDN / HTTP Caching** | ❌ IMPOSSIBLE (single POST endpoint) | ⚠️ Possible (no convention = bespoke cache keys) | ✅ TRIVIAL (URL = cache key) |
| **Error Format Standard** | ⚠️ GraphQL errors (non-standard format) | ❌ Every endpoint reinvents errors | ✅ JSON:API errors enforced globally |
| **Security Attack Surface** | ❌ Large (depth/complexity/batch attacks) | ⚠️ Medium (REST + no input validation standard) | ✅ Small (per-endpoint shape, WAF-friendly) |
| **Team Learning Curve (Flutter + React + Backend)** | ❌ High (all 3 teams learn GraphQL) | ⚠️ Medium (proto + custom REST) | ✅ Lowest (REST universal) |
| **Observability / Debug** | ❌ Hard (one endpoint = 100 query shapes) | ⚠️ Medium (no convention = log correlation hard) | ✅ Easiest (URL = unique trace identifier) |
| **NestJS + TypeORM Integration Quality** | ⚠️ Medium (resolver + ORM = 2 truths) | ⚠️ Medium (protobuf layer adds friction) | ✅ BEST (Controllers = ORM queries, native) |
| **Payload Overfetching (Mobile on MENA low-bandwidth)** | ✅ BEST (exact field control) | ⚠️ Bad (no sparse fields standard) | ✅ GOOD (sparse fields `fields[]` param) |
| **Phase 2 Microservice Extraction Prep** | ⚠️ GraphQL federation future option | ✅ BEST (proto contracts day 1) | ⚠️ Acceptable (internal API layer contracts defined; gRPC added at extraction) |
| **Hostinger VPS Resource Usage** | ❌ Heaviest (resolver overhead, DataLoader) | ⚠️ Medium (TCP transport for in-process = wasted cycles) | ✅ Lightest (no extra layers) |
| **Project Charter MVP Scope Alignment** | ❌ Overengineered (MVP surface is KNOWN) | ⚠️ Premature optimization for extraction | ✅ Optimal (MVP-focused; path preserved) |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **MVP ships 2-3 months faster than GraphQL.** No resolver tuning, no Dataloader wiring, no security hardening beyond standard REST WAF patterns.
2. **Caching is a solved problem.** Nginx proxy_cache + CDN offload + Redis HTTP cache = 3 tiers of caching for free. Content read endpoints hit CDN first → Redis → PostgreSQL. DB load dramatically reduced for the 80% read-heavy workload.
3. **Uniform error/pagination/filtering surface.** Flutter mobile team writes one error parser, one pagination parser, one filter parser. Admin team reuses same packages. 50% reduction in client-side network layer code.
4. **Observability is native.** Structured JSON logs carry per-route method, path, status, and latency (ADR-011). A "Top 10 Slowest Endpoints" view is a simple log query. PFE traces slow requests in <5 minutes via correlation IDs.
5. **Lowest team learning curve.** Every expert account already knows REST. No GraphQL certification or training needed.
6. **WAF security best practices apply natively.** OWASP Core Rule Set covers our shape. No custom GraphQL rule engines needed.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Overfetching on shared endpoints.** Mobile and Admin share `GET /api/v1/audio-contents/{id}`; Admin needs metadata mobile doesn't. **Mitigation:** (a) Sparse fieldsets (`?fields[audio-contents]=id,title,duration`) for mobile; (b) Per-consumer controllers EXPLICITLY ALLOWED: `PublicAudioContentController` (mobile shape) + `AdminAudioContentController` (admin shape) with independent caching and permission models.
2. **API versioning required periodically.** Removing fields or changing types requires `/api/v2/`. **Mitigation:** JSONB `attributes_extra` column in every content table for future extensibility. Extend attributes via JSONB field rather than schema changes. Version frequency expected: 12-18 months.
3. **No native subscriptions/realtime.** Notification badges and comment updates in MVP won't be instant. **Mitigation:** (a) FCM push notifications for high-priority events; (b) Client-side polling every 60s for comment threads (configurable per user); (c) Phase 2: add dedicated `/ws/` WebSocket endpoint sidecar for realtime features without abandoning REST JSON:API main surface.

### Neutral / Unknown (risks to monitor)
1. **Will sparse fieldsets deliver enough payload savings?** If Flutter team reports mobile payload sizes >100KB average on home feed, PFE audits. If problem persists, we introduce per-mobile optimized controllers.
2. **JSON:API envelope overhead.** Every response has `{data:{type,id,attributes}}` instead of `{...fields...}`. Roughly 10-15% payload overhead. Mitigated by Brotli compression at Nginx (compresses envelope well). If payload budget is still exceeded, PFE evaluates.
3. **Phase 2 gRPC for internal — will deferred decision cause rework?** Unlikely. At extraction time (ADR-003), we translate NestJS Controller DTO classes → `.proto` via protobuf-es or similar. The translation is mechanical. The risk is bounded by the 6-week extraction timeline in ADR-003.

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Payload Size):** Average Flutter mobile home feed response payload > 150KB for 60 consecutive days, AND sparse fieldsets + per-route optimization reduce it by <20%.
   - **Action:** CSA evaluates introducing a parallel `/graphql-public` endpoint ONLY for the mobile home feed (NOT full API migration). Sidecar Apollo Server that routes to existing REST services. Main surface remains REST JSON:API.

2. **TRIGGER 2 (Frontend Query Diversity):** React Admin team reports >100 unique dashboards/filter combinations, each requiring a new custom REST endpoint, AND endpoint proliferation velocity >20/month for 3 consecutive months.
   - **Action:** CSA evaluates adding Admin-only GraphQL query endpoint (write operations still REST). Main mobile surface remains REST JSON:API.

3. **TRIGGER 3 (Extraction Volume):** ≥3 modules extracted to microservices (ADR-003 Trigger 1/2 fires 3+ times), AND internal service-to-service calls exceed 50,000/day and internal REST JSON:API overhead (HTTP JSON parse/serialize) shows up as >15% of total CPU in profiles.
   - **Action:** Migrate INTERNAL service-to-service calls to gRPC (Protobuf). EXTERNAL API surface (Mobile + Admin) remains REST JSON:API via API Gateway translation. No external API change.

4. **TRIGGER 4 (Realtime Mandate):** Business requirement for realtime collaborative features (e.g., live study groups, real-time moderated Q&A with 1000+ concurrent viewers) that cannot be met via FCM + polling.
   - **Action:** Evaluate GraphQL subscriptions vs WebSocket sidecar. If GraphQL wins, add it as a sidecar endpoint for realtime only. Main CRUD surface remains REST JSON:API.

We **explicitly do NOT revisit** this decision:
- Because "GraphQL is modern" or hype-based arguments without data
- Before MVP launch and 6 months of production traffic data
- For the entire external API surface (partial additions sidecar-acceptable only)
- Without CSA sign-off + PFE payload/cpu metrics proving the need

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §3.1 Scope (Mobile App, Admin SPA, Backend API — 5 languages RTL/LTR), §2.1 Obj-003 P99 <200ms, §8 Risk Register (Mobile Performance)
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §2.1 P-08 (Observable by Default), §4.1 System Context (Flutter + React Clients), §5 Non-Functional Requirements (Security, Performance)
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §2.1 RACI (SEC, PFE consulted), §3.1 Class A Decision
- [ADR-001 Architecture Pattern — Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) §2 (Module presentation layers)
- [ADR-005 Primary DB — PostgreSQL 16](ADR-005-primary-database-postgresql-16.md) (JSONB for translatable fields, tsvector for search — integrates with sparse fields)
- [ADR-008 Auth Strategy — JWT RS256](ADR-008-auth-strategy-jwt-rs256-rotating-refresh.md) (Bearer token format for REST Authorization header)
- External: JSON:API v1.1 Specification (jsonapi.org/format/1.1)
- External: Phil Sturgeon — APIs You Won't Hate (REST conventions + JSON:API advocacy)
- External: Netflix Tech Blog — Why Netflix (mostly) sticks with REST for their external API
- External: How Shopify Scaled Their API — REST + JSON:API patterns to 100K merchants

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Defined JSON:API conventions table, API layer diagram, 4 reversal triggers. Sent for Sponsor + BKE + MOB + FEA review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; removed out-of-scope progress reference from the N+1 example; observability aligned to ADR-011 lightweight monitoring (structured JSON logs, not Prometheus/Grafana); relative doc links.
