# ADR-014: Monorepo Tooling — Nx 19+ over Turborepo / Lerna 6+ / Manual pnpm workspaces with custom bash/Taskfile

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: DevOps Lead, Build & Release SMEs, Backend Lead, Mobile Lead
- **Date:** 2026-08-07 (Revised & accepted 2026-08-09)
- **Supersedes:** None (foundational repository-structure decision)
- **Related:** ADR-001 (Modular Monolith), ADR-002 (Bounded Context Map — 5 modules), ADR-004 (API Style REST + JSON:API), ADR-007 (IaC — Docker Compose), ADR-009 (Flutter Riverpod), ADR-010 (React Zustand + TanStack Query)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform is a **polyglot, multi-app monorepo** whose explicit structure drives the tooling requirements:

- **Repository contents (1 monorepo, ~10 contributor accounts committing in parallel):**
  ```
  apps/
    backend/        NestJS 10+ Modular Monolith (5 Bounded Context modules — ADR-002)
    admin/          React 18 SPA (Ant Design 5 + Zustand + TanStack Query — ADR-010)
    mobile/         Flutter 3.x Material 3 (Riverpod + Isar + offline audio/PDF — ADR-009/012)
    docs-site/      Docusaurus documentation site
  libs/
    shared-ts-types/         TypeScript DTOs + JSON:API types shared by backend + admin
    shared-ts-api-client/    TS REST client generated from the OpenAPI spec (ADR-004)
    dart-api-client/         Shared Dart HTTP client + Riverpod data layer for mobile
    shared-i18n-assets/      i18n translation JSON (AR/EN/FR/UR/MS) shared by all 3 apps
    shared-eslint-config/    Shared ESLint + Dart analyzer rules
    shared-test-utils/       Jest + Flutter test helpers + MSW setup
  infra/
    docker-compose/          Docker Compose YAML + Uptime Kuma monitoring profile (ADR-007/011)
    terraform-phase3/        (Future) Terraform for Phase 3 cloud
  docs/architecture/adr/     ADR files (this file lives here)
  ```
- **Builds run 50+ times/day across CI + local dev machines:**
  - **Per-PR CI:** `affected:lint + affected:test + affected:build` for ONLY the apps/libs changed by the PR (not the whole repo).
  - **Nightly CI:** full build of all apps, heavy tests, Playwright E2E, Flutter integration tests.
  - **Local dev:** `dev backend` → starts NestJS + PostgreSQL + Redis + MinIO via Docker Compose.
  - **Per-module parallelism:** the 5 Bounded Context modules (identity, content, engagement, notifications, admin — ADR-002) are worked on in parallel. A PR touching one module should re-run ONLY that module's tests + dependents → a 2–8 minute PR CI, not a 40–60 minute full-suite run.
- **Cache requirement (Nx remote cache):** a cold `build:backend` ≈ 25 min; a second run with no changes → <10 s (local cache); a CI runner reusing the shared remote cache → PR build drops from ~25 min → ~3 min.
- **Task-graph (DAG) requirement:** `shared-ts-types` changes → MUST rebuild `shared-ts-api-client` → then `admin` + `backend` (which import it) and their tests. Topological sort is mandatory; custom scripts don't provide it reliably.
- **Generators / scaffolding:** an engineer runs `nx generate @nx/nest:library content/domain --buildable` → a new NestJS lib with the standard tsconfig + jest + eslint + `project.json` in <10 s. Every Bounded Context module follows the identical structure — no "every engineer invents their own layout" chaos.
- **Flutter / Dart support:** most monorepo tools are TypeScript-only. We need first-class `flutter test` / `flutter build apk|ios` inside `apps/mobile/` in the SAME task graph as `@nx/nest` + `@nx/react`, and `affected:test` must include Dart tests when `libs/dart-api-client` changes.
- **Build orchestration + release (Phase 1 Hostinger VPS):** an Nx affected build of only what changed → package artifact → deploy to the VPS → reload. Independent deploy per app.
- **Cost (Phase 1 budget):** the Nx remote-cache free tier covers 500+ CI minutes/month + unlimited local cache; a modest paid tier only if we exceed it.
- **i18n assets shared by 3 apps:** `shared-i18n-assets/` changes → must trigger rebuild + typecheck of all 3 apps. Custom scripts can't enforce this DAG.
- **Architectural boundary enforcement (ADR-001):** an ESLint `enforce-module-boundaries` rule must FORBID cross-module imports of private implementation files (e.g. allow `@al-fajr/identity/domain` → `@al-fajr/content/domain` public API; FORBID `@al-fajr/identity/infrastructure` → `@al-fajr/content/infrastructure`). This rule is MANDATORY per ADR-001.

A wrong monorepo-tooling choice means: (a) 40–60 min PR CI → engineers context-switch instead of waiting → merge conflicts multiply, velocity halves; (b) a shared-types change where an engineer forgets to rebuild the affected mobile app → a runtime type error in production; (c) 10 engineers create 10 different NestJS-module layouts → 40% of review comments are about structure, not logic; (d) Flutter builds not in the task graph → the mobile team drifts onto a separate cadence → i18n translation-sync bugs; (e) the tool can't enforce `enforce-module-boundaries` → ADR-001's boundaries become honor-code → a Big Ball of Mud.

---

## 2. Decision

**✅ WE WILL ADOPT NRWL NX 19+ as the OFFICIAL MONOREPO BUILD SYSTEM, TASK ORCHESTRATOR, CACHE ENGINE, GENERATOR FRAMEWORK, AND ARCHITECTURAL-ENFORCEMENT TOOL for the Al-Fajr repository.**

**Nx plugins enabled Day 1:**
- `@nx/nest` — `apps/backend` (NestJS executors + generators)
- `@nx/react` + `@nx/vite` — `apps/admin`
- `@nxrocks/nx-flutter` (endorsed community plugin, maintained by Tinesoft) — `apps/mobile` + `libs/dart-api-client`
- `@nx/js` — shared TypeScript libs
- `@nx/eslint` — shared ESLint config lib + boundary rules
- `@nx/jest` — TS test runner
- `@nx/playwright` — (future) admin E2E testing
- `@nx/workspace` — generic custom executors (Flutter wrappers, i18n asset generation)

Concrete actions implementing this decision:
1. **Affected commands mandate on ALL CI pipelines:**
   - PR CI: `nx affected -t lint --base=origin/main --parallel` → `nx affected -t test --base=origin/main --parallel=4` → `nx affected -t build --base=origin/main --parallel=3`. A change to `libs/shared-ts-types` runs lint/test/build for `admin` + `backend` + `shared-ts-api-client` and their dependent tests. Independent module PRs run only that module's affected tests → PR CI budget <10 min (with a remote-cache hit, <3 min).
   - Nightly full CI: `nx run-many -t build --all --parallel` → `nx run-many -t test --all --parallel=4` → Flutter integration tests on an emulator.
2. **Local dev experience (all engineers):**
   - `nx dev backend` → `docker compose up -d` (PostgreSQL 16 + Redis 7 + MinIO + the Uptime Kuma monitoring profile) then NestJS serve; the task graph guarantees Compose comes up first.
   - `nx dev admin` → Vite dev server with HMR and auto-imported libs.
   - `nx dev mobile` → Flutter run on emulator with hot reload/restart.
   - The Nx Console VS Code extension lists all runnable tasks in the sidebar — no "10 commands across 5 terminals."
3. **Generators mandate — no manual scaffolding:**
   - New NestJS Bounded Context lib: `nx g @nx/nest:lib <context>/domain --buildable --importPath=@al-fajr/<context>/domain` → generates `tsconfig.lib.json`, `project.json`, `jest.config.ts`, `src/index.ts`, an ESLint config extending `@al-fajr/eslint-config`, and applies boundary tags automatically (`scope:<context>`, `type:domain`).
   - New React feature lib: `nx g @nx/react:lib admin/<feature> --bundler=vite --buildable`.
   - New Flutter feature: `nx g @nxrocks/nx-flutter:feature mobile/feature/<name>`.
4. **Architectural boundary enforcement via Nx project tags + `@nx/enforce-module-boundaries`:**
   ```jsonc
   // project tags (one scope per Bounded Context — ADR-002)
   // scope:identity | scope:content | scope:engagement | scope:notifications | scope:admin | scope:shared
   // type:domain | type:application | type:infrastructure | type:app
   "@nx/enforce-module-boundaries": ["error", {
     "depConstraints": [
       { "sourceTag": "scope:identity",  "onlyDependOnLibsWithTags": ["scope:identity", "scope:shared"] },
       { "sourceTag": "scope:content",   "onlyDependOnLibsWithTags": ["scope:content", "scope:shared"] },
       { "sourceTag": "type:infrastructure", "notDependOnLibsWithTags": ["type:presentation"] },
       { "sourceTag": "type:app", "onlyDependOnLibsWithTags": ["type:domain", "type:application", "type:infrastructure", "scope:shared"] }
     ]
   }]
   ```
   The lint rule **CI-enforces ADR-001**: a cross-module infrastructure import is a CI failure, not a review suggestion.
5. **Nx remote cache activated Day 1 (free tier):**
   - `cacheableOperations = ["build","test","lint","typecheck","flutter-build"]`.
   - The remote cache is shared across all contributor accounts + CI runners. Cold `nx build backend` (fresh clone) ≈ 25 min → a warm cache hit ≈ <10 s locally / ~3 min on CI.
   - Cost: free tier ≈ 500 CI minutes/month + unlimited local cache — expected to cover Year-1 usage; if exceeded, a modest paid tier. The ROI vs engineer CI-wait time is overwhelming.
6. **Task-graph DAG hard requirements (`nx.json` `targetDefaults`):**
   - Every `build` target `dependsOn: ["^build"]` → parent libs build before dependent apps.
   - `shared-ts-types:build` → `shared-ts-api-client:build` → `admin:build` + `backend:build`.
   - `shared-i18n-assets:typecheck` (validates i18n JSON + generates TS/Dart type wrappers) runs first → a missing translation key in any language fails all 3 apps' typecheck at CI.
   - `apps/mobile:test` `dependsOn: ["libs/dart-api-client:build"]`.
7. **Project Crystal / inferred tasks (Nx 19+):** targets inferred from `project.json` / `package.json`; Flutter commands auto-wrapped as first-class cacheable Nx targets via `@nxrocks/nx-flutter`.
8. **Custom executors for non-standard tasks:**
   - `i18n-validate` → JSON-schema-validates `shared-i18n-assets` keys against generated TS/Dart types.
   - `openapi-generate-ts-client` → regenerates `shared-ts-api-client` when the API spec changes (ADR-004). All custom executors are cacheable.
9. **Anti-patterns forbidden by lint + Danger.js CI:**
   - No `cd apps/backend && nest generate` — must use `nx g @nx/nest:*`.
   - No `pnpm test` inside an app — all commands via `nx run <project>:<target>`.
   - No `libs/` folder without a `project.json` (Danger.js warns).
   - No build logic in raw `scripts/*.sh` — all logic is an Nx executor or generator.

---

## 3. Alternatives Considered

### Alternative A: Turborepo (Vercel)
Vercel's TypeScript monorepo task runner — topological sort, remote cache, `turbo run build --filter=...`, minimalist config.

- ✅ **Pro:** Dead-simple config (a small `turbo.json`); gentle learning curve.
- ✅ **Pro:** Very fast task execution; excellent Vercel deploy integration for TS apps.
- ❌ **Con:** **TypeScript-only — no Dart/Flutter support.** `apps/mobile/` is outside Turborepo's universe. Flutter can only be shoehorned via `exec` commands whose outputs are not properly cacheable and whose affected-detection ignores Dart files. An `shared-i18n-assets` change would rebuild admin+backend but NOT the mobile Dart translation wrappers → the mobile app ships stale keys. **Deal-breaker for a polyglot repo.**
- ❌ **Con:** **No generators.** Pure task runner — engineers hand-copy lib scaffolding → inconsistent layouts, review noise.
- ❌ **Con:** **No architectural boundary rule.** No `depConstraints` equivalent → ADR-001 boundaries become honor-code → Big Ball of Mud within months.
- ❌ **Con:** **No codemods / migrations** for framework upgrades (e.g. NestJS 10→11) — hand-rolled bash.
- ❌ **Con:** Turborepo feature velocity has slowed (Vercel's focus is Turbopack/Next.js), whereas Nx ships major features every quarter.

### Alternative B: Lerna 6+ (runs on Nx under the hood)
Lerna reimplemented on top of the Nx task runner; strongest at versioning/publishing npm packages.

- ✅ **Pro:** Best-in-class npm publish/version/changelog — valuable IF we published packages publicly.
- ✅ **Pro:** Inherits Nx caching + task graph under the hood.
- ❌ **Con:** **Hybrid = worst of both worlds** — you maintain `nx.json` AND `lerna.json` AND workspaces; two config systems, ambiguous "`lerna run` vs `nx run`". Lerna's own docs say "if you need full Nx, use Nx directly."
- ❌ **Con:** **Flutter/Dart = same blind spot as Turborepo** — the Lerna team doesn't test or ship Flutter support.
- ❌ **Con:** Generators + `enforce-module-boundaries` technically inherit from Nx but are undocumented on the Lerna side → harder setup, rarer community examples.
- ❌ **Con:** **Publishing is our #1 unused feature** — we publish 0 public npm packages in Phase 1–2 (internal libs are `publishable=false`). Accepting hybrid complexity for zero benefit.

### Alternative C: pnpm workspaces + bash/Makefile/Taskfile custom scripts
Raw `pnpm` workspaces (`apps/*`, `libs/*`) + shell scripts / a `Taskfile.yml`. Maximum control, maximum custom.

- ✅ **Pro:** 100% control, nothing hidden behind abstraction.
- ✅ **Pro:** Zero new tooling dependencies; no remote-cache bill.
- ❌ **Con:** **No affected commands.** Every PR runs the whole test suite (~40 min). Recreating affected detection (git-diff → dependency graph → topological sort → cache keys) is effectively re-implementing 30% of Nx in fragile bash — a multi-week project nobody wants to maintain.
- ❌ **Con:** **No remote cache.** Every machine rebuilds cold (~25 min); the CI queue backs up and release candidates take hours.
- ❌ **Con:** **No task-graph / topological sort** — a hand-rolled dependency chain in bash is race-prone and unmaintainable as the DAG grows.
- ❌ **Con:** **No generators, no boundary enforcement, no Flutter integration** — all bespoke shell, all drift over time.
- ❌ **Con:** **Technical-debt snowball.** Within 6 months, 1000+ lines of subtle-bug-ridden CI shell; onboarding a new hire takes a week just on the scripts; a mid-project "rewrite the CI" becomes inevitable — a net loss vs Nx's modest cost.

### Alternative D: Nx 19+ (Nrwl) — Our Decision
Full-featured monorepo build system + dev tooling; TypeScript/JS first-class, Dart/Flutter via the endorsed community plugin. Affected commands, remote cache, task-graph DAG, generators, codemods, and boundary-enforcement lint rule.

- ✅ **Pro:** **#1 criterion — polyglot Dart/Flutter + TS + Docker in a single task graph.** `@nxrocks/nx-flutter` wraps Flutter tasks as cacheable Nx tasks; a `libs/dart-api-client` change makes `nx affected -t test` include `apps/mobile:test` automatically; an `shared-i18n-assets` change type-checks TS (admin+backend) AND Dart (mobile) via one graph. No other tool does this out-of-the-box for our stack.
- ✅ **Pro:** **Affected detection + remote cache = 80–90% CI-time reduction** — a 25 min full backend build → ~3 min cached; independent module PRs run 2–8 min. Hundreds of engineer-hours saved per year; the remote-cache cost is a rounding error against that.
- ✅ **Pro:** **Generators eliminate scaffolding bugs + inconsistency** — `nx g @nx/nest:lib` produces the identical standard structure every time; reviews focus on logic, not folder layout.
- ✅ **Pro:** **Architectural boundary enforcement via `@nx/enforce-module-boundaries` — ADR-001 becomes a CI failure, not honor-code.** Across the 5 Bounded Contexts, a forbidden `identity/infrastructure` → `content/infrastructure` import blocks the PR. This single feature justifies Nx for a modular monolith with >5 engineers.
- ✅ **Pro:** **Task-graph DAG (`dependsOn: ^build`)** — a shared-types change automatically rebuilds/tests all dependents; a missing translation key fails CI before it ever reaches production.
- ✅ **Pro:** **Nx Console (VS Code)** — sidebar task runner; a new hire is productive in days, not weeks.
- ✅ **Pro:** **`nx migrate` codemods** — a NestJS 10→11 upgrade migrates configs + runs codemods across all projects in hours, not days.
- ✅ **Pro:** **Budget-friendly** — free tier covers expected Year-1 CI minutes + unlimited local cache; a small paid tier only if we outgrow it. Strong ROI on saved engineer time.
- ✅ **Pro:** **Active investment** — Nrwl ships major features quarterly; official NestJS + React integration guides; large, healthy ecosystem.
- ⚠️ **Trade-off:** Initial learning curve (`nx.json`, `project.json`, tags, targets, executors, generators) ≈ 2–3 days. **Mitigation:** a Sprint-0 workshop, Nx Console, and the excellent step-by-step NestJS/React/Flutter cookbooks.
- ⚠️ **Trade-off:** `@nxrocks/nx-flutter` is a community (not first-party Nrwl) plugin. **Mitigation:** it is popular and actively maintained; the `nx:run-commands` executor is a raw fallback; worst case, ~2 weeks of custom Dart target support — not a blocker.
- ⚠️ **Trade-off:** ~14 `project.json` files + `nx.json` to configure. **Mitigation:** Nx workspace presets scaffold most of it in ~1 day; done once, pays back within Month 1.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alt A — Turborepo (Vercel) | Alt B — Lerna 6+ (Nx-under-hood hybrid) | Alt C — pnpm workspaces + bash/Taskfile | Alt D — Nx 19+ (Nrwl) ✅ CHOSEN |
|-----------|----------------------------|------------------------------------------|------------------------------------------|----------------------------------|
| **Polyglot — Dart/Flutter + TS in ONE task graph** | ❌ **FATAL — TS only**; Flutter via uncacheable `exec` | ⚠️ Inherits TS graph; Flutter undocumented | ❌ Shell-script workaround | ✅ **`@nxrocks/nx-flutter` (endorsed) + run-commands fallback** |
| **Affected + remote cache (PR CI time)** | ⚠️ Good for TS; no Dart affected | ⚠️ TS good; Flutter blind | ❌ **None — ~40 min/PR (whole repo)** | ✅ **Affected across Dart + TS → 2–8 min** |
| **Generators / scaffolding** | ❌ None — manual copy/paste | ⚠️ Inherited but docs messy | ❌ None — layout chaos | ✅ `@nx/nest` + `@nx/react` + Flutter generators |
| **Module-boundary lint (ADR-001 §4)** | ❌ None — honor-code (guaranteed drift) | ⚠️ Works but undocumented | ❌ Custom ESLint, multi-week | ✅ `@nx/enforce-module-boundaries` → CI-blocks cross-module infra imports |
| **Task-graph DAG (`dependsOn ^build`)** | ✅ Topological (TS only) | ✅ (from Nx) | ❌ Hand-rolled, race-prone | ✅ Full topological across Dart/TS/i18n |
| **i18n change → typecheck all 3 apps** | ❌ misses mobile (Dart) | ❌ same blind spot | ❌ custom shell | ✅ i18n lib → all 3 apps via DAG |
| **NestJS 10→11 codemod upgrade** | ❌ manual bash (days, bug-prone) | ⚠️ Nx migrate but config messy | ❌ hand-written sed/grep | ✅ `nx migrate` → hours, auto-codemods |
| **Nx Console GUI (VS Code)** | ❌ CLI only | ⚠️ works, confusing config | ❌ none | ✅ first-class sidebar task runner |
| **New-hire learning curve** | ✅ simplest (`turbo.json`) | ⚠️ medium (two configs) | ⚠️ easy if bash-expert, else weeks | ⚠️ 2–3 days (workshop + Console) |
| **Maintainer momentum 2026–2028** | ❌ slowing (Turbopack focus) | ⚠️ feature-complete/stagnant | ❌ you are the maintainer | ✅ Nrwl active, quarterly majors |
| **Year-1 cost (tool + CI-wait)** | ⚠️ free tier exceeded early; Flutter bugs | ⚠️ hybrid cost, half the features | ❌ "free" tool, huge CI-wait + maintenance | ✅ ~$0–$600 tool; hundreds of engineer-hours saved |
| **ADR-001 boundary integrity (12 mo)** | ❌ drift → Big Ball of Mud | ⚠️ likely drift (undoc. edges) | ❌ 0% enforcement | ✅ 100% CI-enforced — merge blocked on violation |
| **MVP delivery impact** | ⚠️ fast start → Month-3 rework | ⚠️ medium start → config drift | ❌ fast start → Month-4 CI rewrite | ✅ +2–3 days setup → net earlier via saved rework |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **PR CI drops from ~40 min → ~3 min** — the biggest day-to-day velocity win. Engineers stay in flow instead of context-switching; merge-conflict churn falls; the remote-cache bill is negligible against the engineer-hours saved.
2. **ADR-001 boundary integrity is guaranteed by `@nx/enforce-module-boundaries`** — across the 5 Bounded Contexts, no engineer can silently couple modules; the modular monolith stays modular 12 months on.
3. **Flutter/Dart is a first-class citizen in the same task graph** — a Dart lib change runs mobile tests; an i18n change type-checks all 3 apps; the polyglot repo builds as one.
4. **Generators give 100% consistent lib structure** — zero copy/paste drift, far less "move this file" review noise.
5. **Shared i18n type-safety** — never again ship an app missing an AR/EN/FR/UR/MS key; TS/Dart wrappers are generated and CI-checked.
6. **Framework upgrades via `nx migrate`** — NestJS 10→11 across all projects in hours, not days.
7. **Nx Console onboarding** — a new hire runs any task from the sidebar; productive in days.
8. **Distributed remote cache** — a teammate's cold build becomes another's instant cache hit.
9. **Budget-friendly** — free tier expected to cover Year-1 usage; a small paid tier at most.

### Negative Outcomes / Trade-offs (accepted, with mitigations)
1. **2–3 day Nx learning curve for the team.** **Mitigation:** a Sprint-0 workshop, Nx Console, and step-by-step NestJS/React/Flutter cookbooks.
2. **`@nxrocks/nx-flutter` is a community plugin (abandonment risk ~low).** **Mitigation:** it is popular and active; `nx:run-commands` is a raw fallback; worst case ~2 weeks of custom Dart targets.
3. **1–3 day initial repo setup (`project.json` × ~14 + `nx.json`).** **Mitigation:** Nx presets scaffold most of it in ~1 day; done once.
4. **`nx.json` config can feel complex.** **Mitigation:** keep it minimal — one `scope:<context>` tag per module + a handful of `type:*` tags; the schema is well-documented.
5. **Remote-cache cost if we exceed the free tier.** **Mitigation:** monitor CI minutes; the paid tier is transparent and small; explore nonprofit discounts.

### Neutral / Unknown (risks to monitor)
1. **Graph performance as the repo grows past ~20 projects.** **Mitigation:** enable the Nx Daemon; monitor `nx graph` timing.
2. **`@nxrocks/nx-flutter` compatibility on future Nx major upgrades.** **Mitigation:** pin plugin versions; test upgrades on a staging branch first.
3. **TS↔Dart type parity for shared DTOs.** **Mitigation:** boundary lint + contract tests generated from the OpenAPI spec (ADR-004).
4. **pnpm symlink / peer-dependency edge cases.** **Mitigation:** pin `packageManager`; pnpm 9+ is fully supported by Nx 19+.

---

## 6. Reversal / Exit Criteria (When to Re-Open This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Affected + cache fails to deliver <10 min PR CI):** With correct setup and a working remote cache, the average PR build exceeds 10 min for 6 consecutive months, AND the DevOps Lead certifies in writing that the root cause is structural Nx inefficiency (not repo size or a misconfigured custom executor).
   - **Action:** Evaluate Turborepo for the TS portion while keeping Nx boundary/generator tooling.

2. **TRIGGER 2 (Nx remote-cache pricing shock):** Nrwl raises prices >200% with no grandfathering such that our annual bill exceeds a hard budget ceiling, AND a competing remote cache is <50% of the equivalent cost.
   - **Action:** Migrate the cache backend (self-hosted Nx cache or an alternative), keeping Nx itself.

3. **TRIGGER 3 (`@nxrocks/nx-flutter` abandoned):** The plugin averages critical bugs unfixed >60 days with no maintainer stepping forward, AND the `run-commands` fallback cannot preserve Flutter affected/caching.
   - **Action:** Evaluate `melos` for the Dart/Flutter portion alongside Nx for TS.

4. **TRIGGER 4 (Team rejection):** >40% mobile/backend attrition within 12 months where exit data attributes friction primarily to monorepo tooling, AND a simpler tool scores materially higher in team satisfaction.
   - **Action:** Reassess against pnpm + custom scripts, accepting the slower CI trade-off.

We **explicitly do NOT revisit** this decision:
- Because of individual learning-curve complaints in the first weeks.
- Over Nx Console UX debates.
- Before 12 months of production + cost metrics.
- Without 3+ consecutive metric-trigger months and CSA + DevOps-Lead co-signatures.

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §6 Team & Collaboration, §7 Technology Stack, §10 Admin Product, §11 Mobile Product, §15 Budgets
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §1 Monorepo Structure, §13 Build & Release Pipeline
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §7 Code Style & Linting, §10 CI/CD, §13 Architectural Compliance
- [ADR-001 Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) — the boundary rules that `enforce-module-boundaries` implements
- [ADR-002 Bounded Context Map (5 modules)](ADR-002-bounded-context-map-5-modules.md) — the `scope:*` tags map 1:1 to these 5 contexts
- [ADR-004 API Style: REST + JSON:API](ADR-004-api-style-rest-json-api.md) — OpenAPI → `shared-ts-api-client` generator
- [ADR-007 IaC: Docker Compose](ADR-007-iac-phase-1-docker-compose-shell-scripts.md) — `infra/docker-compose` + Uptime Kuma monitoring profile
- [ADR-009 Flutter State Management: Riverpod](ADR-009-flutter-state-management-riverpod.md)
- [ADR-010 React Admin State: Zustand + TanStack Query](ADR-010-react-admin-state-zustand-tanstack-query.md)
- External: Nx 19 Documentation — nx.dev
- External: `@nxrocks/nx-flutter` — github.com/tinesoft/nxrocks
- External: Nx `enforce-module-boundaries` — nx.dev/features/enforce-module-boundaries
- External: Nx remote caching (Nx Replay / Nx Cloud) — nx.dev/ci
- External: "Turborepo vs Nx" comparison (2026) — monorepo.tools

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Sent for DevOps Lead + Mobile Lead + Backend Lead + Sponsor review.
- 2026-08-09: ACCEPTED (revised) — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; package scope **`@al-fajr/*`** (was `@salih/*`); **5** Bounded Context modules (was 7) with `scope:{identity,content,engagement,notifications,admin}` tags per ADR-002; monitoring reference aligned to ADR-011 lightweight stack (Uptime Kuma profile, not OLGT/Grafana provisioning); corrupted/garbled §3–§7 prose, tables, and decision log fully rewritten for clarity; relative doc links.
