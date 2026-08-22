# TECHNICAL GOVERNANCE
# الحوكمة التقنية للمشروع

| Field | Value |
|-------|-------|
| Document ID | AF-GOV-TECH-001 |
| Version | 1.1.0 |
| Status | 🟢 APPROVED — Project Sponsor (Phase 0 consolidation) |
| Created Date | 2026-08-07 |
| Last Updated | 2026-08-09 |
| Author | Chief Software Architect |
| Enforcement Owner | Chief Software Architect |
| Project | Majlis Al-Alim (مجالس العالم) |

---

## 1. EXECUTIVE SUMMARY

This document is **non-negotiable, binding law** for all accounts (expert contributors) on this project. The Chief Software Architect (CSA) is the sole and final interpreter and enforcer of this governance.

The purpose of this governance is to:
- **Prevent chaos** when 10 expert accounts work in parallel
- **Guarantee architectural integrity** — no account violates the Architecture Vision
- **Enforce quality floors** — no substandard code passes review
- **Preserve optionality** — the path from modular monolith to microservices stays open
- **Create audit trails** — every decision, every code change, is traceable

Any account found violating these rules will have their work **rejected** by the CSA and must rework it **before** it may enter the codebase.

---

## 2. TEAM ROLES, ACCOUNTABILITIES & RACI MATRIX

### 2.1 The 10 Account Team Structure

| # | Account / Role | Code | Scope of Responsibility | Approves Work From | Reports To |
|---|---------------|------|------------------------|--------------------|------------|
| **01** | **Chief Software Architect** | CSA | All technical decisions, architecture, standards, ADRs, ALL final approvals | Everyone | Project Sponsor |
| 02 | Backend / NestJS Expert | BKE | All NestJS modules (5 bounded contexts), APIs, events, queues, DB schema implementation | CSA approves designs; BKE approves backend PRs (architectural) | CSA |
| 03 | Flutter / Mobile Expert | MOB | Flutter app architecture, all features, offline support, FCM, store publishing | CSA approves architecture; MOB approves mobile PRs | CSA |
| 04 | React / Admin Dashboard Expert | FEA | Admin SPA, all pages/features, React state, integration with backend API | CSA approves architecture; FEA approves frontend PRs | CSA |
| 05 | PostgreSQL / Redis DBA Expert | DBA | Schema optimization, indexing, migrations strategy, query perf, Redis configs, backups, HA plan | CSA + BKE approve DBA work that affects code | CSA |
| 06 | DevOps / Docker / Cloud Expert | DEV | Infra scripts, Docker, CI/CD pipelines, monitoring, deployment, TLS, VPS hardening | CSA approves infra architecture; DEV approves CI/CD PRs | CSA |
| 07 | Security / CyberSec Expert | SEC | Threat models, pen test, security reviews, dependency audit, incident response runbooks, WAF rules | CSA approves security standards; SEC has VETO on any security-failing PR | CSA |
| 08 | QA / Testing Expert | QAE | Test strategy, test plans, automated test review, load test scripts, E2E coverage, quality gates in CI | CSA approves strategy; QAE gates PR merge (quality sign-off) | CSA |
| 09 | Performance Engineer | PFE | Profiling, bottleneck analysis, benchmarking, perf tuning, Flutter jank reduction, query optimization | CSA approves perf plan; PFE may block PRs failing perf budget | CSA |
| 10 | AI / Documentation Expert (if used as Doc) | DOC | This is the documentation/coordination account; writes ADRs, maintains docs, runs architecture reviews | CSA approves all published docs | CSA |

### 2.2 RACI Matrix for Key Activities

R = Responsible (does the work)
A = Accountable (final yes/no)
C = Consulted (input before decision)
I = Informed (after decision)

| Activity | CSA (01) | BKE (02) | MOB (03) | FEA (04) | DBA (05) | DEV (06) | SEC (07) | QAE (08) | PFE (09) |
|----------|----------|----------|----------|----------|----------|----------|----------|----------|----------|
| **Architecture decision (ADR)** | **A** | C | C | C | C | C | C | I | C |
| **Backend module design** | **A** | **R** | I | I | C | I | C | I | C |
| **Mobile feature design** | **A** | C | **R** | I | I | I | C | I | C |
| **Admin dashboard feature** | **A** | C | I | **R** | I | I | C | I | C |
| **Database migration** | **A** | C | I | I | **R** | I | C | C | C |
| **CI/CD pipeline change** | **A** | C | C | C | I | **R** | C | C | I |
| **Security audit finding** | **A** | C | C | C | C | C | **R** | I | I |
| **Test strategy** | **A** | C | C | C | I | I | C | **R** | C |
| **Performance budget breach** | **A** | C | C | C | C | I | I | I | **R** |
| **Pull Request (any) merge** | **A** (if arch) | C (if backend) | C (if mobile) | C (if FE) | I | I | C (sec) | C (qa) | C (perf) |

---

## 3. DECISION-MAKING PROCESS

### 3.1 Decision Classification

| Class | Definition | Required Approver(s) | Example |
|-------|-----------|----------------------|---------|
| **Class A: Architectural** | Affects system structure, cross-module contracts, tech stack, ADRs | CSA (SOLE AND FINAL) + SEC consulted for security-class | Choosing REST over GraphQL; new bounded context |
| **Class B: Major Design** | Impacts a single module's internal architecture, API contracts within a module, data model changes | CSA (if cross-cutting) OR relevant Tech Lead (if isolated) + DBA consulted for data | Designing User entity fields; picking controller patterns |
| **Class C: Implementation** | Local decisions, implementation details, naming within a file, algorithm choice for bounded function | Responsible Expert (self) + code review peer | Variable naming; choosing a sort algorithm |

### 3.2 How to Make Any Decision

```
Step 1: Classify the decision (A / B / C)
Step 2: If Class A or B → check if ADR exists / required
  → YES: follow existing ADR (no re-debate unless CSA says otherwise)
  → NO: if NEW decision, propose rationale + alternatives, submit to CSA
Step 3: For all classes: document in PR description / ADR / code comments
Step 4: If 2+ experts disagree → escalate to CSA. CSA's ruling is FINAL.
```

### 3.3 Architecture Decision Record (ADR) Process

```
WHEN an ADR is REQUIRED:
  ✅ Any Class A decision
  ✅ Any decision that changes Architecture Vision
  ✅ Any new technology, framework, or library
  ✅ Any cross-module boundary or interface
  ✅ Any security baseline change
  ✅ Any NFR trade-off (perf vs cost, etc.)

ADR FILE FORMAT (Mandatory, per Michael Nygard template):
  1. Title (short, descriptive)
  2. Status (Proposed / Accepted / Deprecated / Superseded by ADR-XXX)
  3. Context (forces at play, problem statement)
  4. Decision (what we will actually do, stated clearly)
  5. Consequences (good, bad, neutral — be honest)
  6. Alternatives Considered (minimum 2 alternatives, with pros/cons)

ADR FILE NAMING: ADR-NNN-title.md  (NNN = sequential 3-digit number)
ADR STORAGE: docs/architecture/adr/
ADR APPROVER: CSA (signature in PR = ADR becomes Accepted)
```

---

## 4. DEVELOPMENT WORKFLOW (GIT FLOW + CONVENTIONAL COMMITS)

### 4.1 Branching Strategy (Git Flow — Strict)

```
production ←───────────────────────────────┐ (immutable, tagged releases only)
   │                                        │
   │ hotfix/AF-123-fix-auth-bug            │ (branches from production, PR to production+develop)
   │                                        │
staging ←──────────────────────────────┐    │ (release candidate integration branch)
   │                                   │    │
   │ release/v1.2.0                    │    │ (branches from develop, PR to staging + develop back-merge)
   │                                   │    │
develop ←───────┬──────────┬───────────┤    │ (main integration, always green)
   │             │          │           │    │
   │ feature/    │ feature/ │ bugfix/   │    │
   │ AF-01-auth │ AF-042- │ AF-099-  │    │
   │             │ content  │ crash     │    │
   │             │          │           │    │
   ▼             ▼          ▼           ▼    ▼
 ┌─────────────────────────────────────────────────┐
 │    Work Happens Here: feature/bugfix branches    │
 │    → short-lived (max 2-3 days, max 400 files)  │
 │    → one logical change per branch              │
 └─────────────────────────────────────────────────┘
```

### 4.2 Branch Naming Rules (ENFORCED IN CI)

```
PATTERNS (exact match regex):
  feature/AF-<ticket-number>-<kebab-case-desc>
  bugfix/AF-<ticket-number>-<kebab-case-desc>
  hotfix/AF-<ticket-number>-<kebab-case-desc>
  release/v<major>.<minor>.<patch>
  chore/AF-<ticket-number>-<kebab-case-desc>

EXAMPLES:
  ✅ feature/AF-042-content-cms-endpoints
  ✅ bugfix/AF-101-login-refresh-token
  ✅ release/v1.0.0
  ❌ feature/my-branch (no ticket, wrong desc format)
  ❌ AF-042 (no type prefix)
  ❌ main (never commit to main/develop/production directly)
```

### 4.3 Conventional Commits (ENFORCED IN CI via commitlint)

```
PATTERN (Conventional Commits 1.0.0, mandatory):
  <type>(<scope>): <subject in english, imperative, lowercase, max 72 chars>
  [BLANK LINE]
  [optional body explaining WHY (not WHAT)]
  [BLANK LINE]
  [optional footer(s): Refs #AF-042, BREAKING CHANGE:, etc.]

TYPES ALLOWED:
  feat:     New feature for the user (corresponds to MINOR in semver)
  fix:      Bug fix (corresponds to PATCH)
  perf:     Performance improvement
  refactor: Code change that neither fixes a bug nor adds a feature
  style:    Formatting, missing semicolons, etc. (no code logic change)
  test:     Adding tests or correcting tests
  docs:     Documentation only changes
  chore:    Build process, tooling, dependencies, CI config, etc.
  revert:   Revert previous commit(s)
  sec:      Security-related change (custom type for this project)
  arch:     Architecture / ADR related change (custom type)

EXAMPLES:
  ✅ feat(identity): add refresh token rotation endpoint
  ✅ fix(content): handle null author in content-item dto mapping
  ✅ perf(db): create GIN index on ct_content_item.search_vector
  ✅ docs(adr): add ADR-001 modular monolith decision
  ✅ sec(auth): increase bcrypt cost factor from 10 to 12
  ✅ arch(monorepo): restructure backend modules to clean architecture layers
  ❌ my commit message (no type)
  ❌ Feat(Auth): ADDED Login (capitalization violation)
  ❌ feat: some change that is way too long for a subject line and exceeds seventy two characters causing a violation
```

### 4.4 Semantic Versioning (Release Tags)

```
Format: v<MAJOR>.<MINOR>.<PATCH>  (preceding v is required)

Rules:
  MAJOR = Breaking change to public API / database / mobile app compatibility
  MINOR = New feature in backwards-compatible manner
  PATCH = Backwards-compatible bug fixes, perf improvements, security patches

Examples:
  v1.0.0   (initial production release)
  v1.0.3   (3 bugfix patches)
  v1.1.0   (new backwards-compatible endpoint)
  v2.0.0   (removal of /api/v1 endpoints, breaking migration)
```

---

## 5. PULL REQUEST & CODE REVIEW PROCESS (NON-NEGOTIABLE)

### 5.1 PR Pre-Flight Checklist (Author MUST complete before requesting review)

```markdown
## PR Checklist (fill ALL boxes [x] before submitting)

- [ ] I have read and understood the Architecture Vision & Technical Governance documents
- [ ] My branch follows the naming pattern: {type}/AF-{ticket}-{desc}
- [ ] All commits follow Conventional Commits format (verified by commitlint)
- [ ] I have run `lint`, `format`, and `build` locally — all pass
- [ ] I have written **UNIT TESTS** for new logic (coverage ≥ 70% on changed code)
- [ ] I have written **INTEGRATION TESTS** if this crosses module boundaries
- [ ] I have updated the relevant **documentation** (API docs, ADRs, runbooks)
- [ ] I have added **migration DOWN script** if this PR modifies DB schema
- [ ] I have verified no **new security vulnerabilities** (npm audit / osv-scanner)
- [ ] I have considered **performance impact** and noted any expensive operations
- [ ] I have tagged the correct reviewers based on the RACI matrix
- [ ] I have attached **screenshots / screencasts** for UI changes
```

### 5.2 PR Size Rules

| PR Size | Lines Changed | File Count | Review SLA | Max Age (before split required) |
|---------|--------------|------------|------------|---------------------------------|
| Tiny | < 50 | < 5 | 2 hours | 1 day |
| Small | 50-200 | 5-15 | 4 hours | 2 days |
| Medium | 200-500 | 15-40 | 1 business day | 3 days |
| Large | 500-1000 | 40-80 | 2 business days | 5 days |
| **Too Large — REJECTED** | > 1000 | > 80 | N/A — CSA must authorize exception | Split immediately |

### 5.3 Reviewers Assignment Rules

Based on change scope, the PR author requests review from:

```
MANDATORY REVIEWERS:
  ├─ If Backend code changes → BKE (Expert 02)
  ├─ If Mobile/Flutter changes → MOB (Expert 03)
  ├─ If React/Admin changes → FEA (Expert 04)
  ├─ If Database schema/migration changes → DBA (Expert 05) + BKE
  ├─ If Docker/CI/CD/Infra changes → DEV (Expert 06)
  ├─ If Security-class change (auth, crypto, permissions) → SEC (Expert 07) ← HAS VETO
  ├─ If test strategy / CI quality gate changes → QAE (Expert 08)
  ├─ If performance-critical path changes → PFE (Expert 09)
  └─ If ARCHITECTURAL change (any) → CSA (Expert 01) ← FINAL APPROVER
```

### 5.4 Code Review SLA

- Reviewers must respond with approval or comments within the SLA in §5.2
- If SLA is exceeded, the PR author may ping the reviewer once; then escalate to CSA
- CSA reserves the right to approve/reject ANY PR regardless of other approvals
- **Minimum 2 approvals required** for any PR > 200 LOC (at least one domain expert + one cross-functional)

### 5.5 Merge Conditions (ALL required, blocked in CI)

```
✅ All required reviewers approved (no requested changes open)
✅ No merge conflicts with target branch (rebase required)
✅ CI pipeline: 100% green (lint, build, tests, security scan)
✅ Code coverage: ≥ 70% line coverage on changed code; ≥ 80% on critical paths
✅ No unresolved discussion threads on GitHub
✅ No TOO-LARGE PR without CSA waiver
✅ SEC expert has NOT exercised security veto
✅ CSA has approved if this is a Class A / Class B design PR
✅ Documentation updated (verified by DOC reviewer if applicable)
```

---

## 6. CODE STANDARDS

### 6.1 Naming Conventions (Cross-Language Baseline)

| Artifact | Convention | Example |
|----------|-----------|---------|
| Files & Folders (TypeScript / JS / Markdown / Config) | kebab-case | `user-profile.module.ts`, `refresh-token.guard.ts` |
| Flutter Dart files | snake_case | `auth_repository.dart`, `login_page.dart` |
| Classes / Interfaces / Types (TS, Dart, Swift, Kotlin) | PascalCase | `UserService`, `RefreshTokenStrategy` |
| Methods / Functions / Variables (TS, Dart) | camelCase | `getUserById()`, `isEmailVerified` |
| Constants (all languages) | UPPER_SNAKE_CASE | `MAX_LOGIN_ATTEMPTS = 5`, `JWT_ACCESS_TTL` |
| Database tables | snake_case, plural, BC-prefixed | `id_users`, `ct_content_items`, `eg_comments` |
| Database columns | snake_case, singular | `id`, `created_at`, `email_address`, `password_hash` |
| API routes | kebab-case, plural nouns | `/api/v1/users`, `/api/v1/content-items` |
| Environment Variables | UPPER_SNAKE_CASE | `DATABASE_URL`, `REDIS_HOST`, `JWT_SECRET` |
| Git branches | type/AF-NNN-desc (§4.2) | `feature/AF-042-content-cms` |
| Pull request titles | Conventional commit format | `feat(identity): add refresh token rotation` |
| CSS classes (Tailwind utility-first OK) | kebab-case | `.page-header`, `.btn-primary` |

### 6.2 TypeScript / NestJS Code Standards

```typescript
// ✅ DO: strict mode enforced in tsconfig
{
  "compilerOptions": {
    "strict": true,                    // NON-NEGOTIABLE
    "noImplicitAny": true,             // NON-NEGOTIABLE
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "forceConsistentCasingInFileNames": true
  }
}

// ✅ DO: use Zod for ALL API input validation (class-validator for DTOs in Nest)
// ✅ DO: PURE functions — no side effects in domain/application layer
// ✅ DO: All async functions return Promise<T>, never Promise<any>
// ✅ DO: Error handling: custom domain exceptions, never throw raw Error()
// ✅ DO: Decorators for cross-cutting concerns (@Transactional, @Cacheable, etc.)

// ❌ NEVER:
// ❌  any type (there is ALWAYS a way to type it correctly — ask CSA if stuck)
// ❌  // @ts-ignore or eslint-disable (justify with comment + CSA approval if truly needed)
// ❌  Synchronous file system / crypto / JSON.parse on hot paths
// ❌  console.log() in production code (use injected Logger with proper levels)
// ❌  Direct instantiation (new Service()) — use NestJS DI everywhere
```

### 6.3 Dart / Flutter Code Standards

```yaml
# analysis_options.yaml (enforced)
include: package:flutter_lints/flutter.yaml

linter:
  rules:
    - prefer_const_constructors
    - prefer_const_declarations
    - prefer_final_locals
    - sort_pub_dependencies
    - always_put_required_named_parameters_first
    - avoid_dynamic_calls
    - avoid_print          # ✅ use debugPrint / logger
    - no_logic_in_create_state
    - sized_box_for_whitespace
```

```dart
// ✅ DO: Null safety enabled (Dart 3+ sound null safety) — NON-NEGOTIABLE
// ✅ DO: Riverpod providers for all state access; no global variables
// ✅ DO: Widget build() methods must be PURE (no side effects, no network calls)
// ✅ DO: Feature-first folder structure (NOT layer-first)
// ✅ DO: Named constructors with required params; avoid positional bool args

// ❌ NEVER:
// ❌  dynamic keyword (there is ALWAYS a proper type)
// ❌  print() — use debugPrint in debug, Logger in prod
// ❌  setState() across widget boundaries — use Riverpod
// ❌  1000+ line widgets — EXTRACT components! max 200 LOC per file
// ❌  Hardcoded colors/strings; use Theme extensions + .arb localization files
```

### 6.4 React / Frontend Code Standards

```typescript
// tsconfig.json strict mode (same as backend — MANDATORY)

// ✅ DO: Functional components + hooks ONLY; NO class components
// ✅ DO: Server state = TanStack Query (useQuery, useMutation); NOT Zustand/Context
// ✅ DO: Client state = Zustand stores; NO Redux, NO Context drilling
// ✅ DO: Zod for ALL form validation (frontend AND backend share schema types)
// ✅ DO: Accessibility (a11y): semantic HTML, proper aria-*, keyboard-navigable
// ✅ DO: Performance: memoization only where profiling PROVES it's needed
// ✅ DO: Shared Types (apps/admin-dashboard) ↔ shared lib package ↔ backend DTOs

// ❌ NEVER:
// ❌  any type (same as backend — strict)
// ❌  useEffect for data fetching (use TanStack Query/useSWR instead)
// ❌  Prop drilling > 2 levels deep (lift to Zustand store)
// ❌  console.log in production code (use proper logger; remove before merge)
// ❌  Direct DOM manipulation (use refs only when React has no primitive)
```

### 6.5 Database / SQL Standards

```sql
-- ✅ DO: Primary key = UUIDv7 (or BIGSERIAL if CSA-approved for high-write tables)
-- ✅ DO: Every table has:
--        id (PK), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
--        updated_at TIMESTAMPTZ NOT NULL DEFAULT now() via trigger,
--        deleted_at TIMESTAMPTZ NULL (soft delete unless DBA approves hard-delete)
-- ✅ DO: Foreign keys named: fk_<child_table>_<parent_table>_<column>
-- ✅ DO: Index naming: idx_<table>_<column(s)>_<qualifier>
-- ✅ DO: Migration scripts are IMMUTABLE once merged; NEW migration to change
-- ✅ DO: Every migration has UP and DOWN scripts tested in CI
-- ✅ DO: EXPLAIN ANALYZE for every query in hot path (≥ 1 req/min)

-- ❌ NEVER:
-- ❌  SELECT * — explicitly name columns
-- ❌  Entity column names that are reserved words (user → app_user or users)
-- ❌  On-disk encryption omitted for PII columns
-- ❌  Cascade delete unless business-reviewed (default: restrict)
```

---

## 7. API DESIGN STANDARDS (REST JSON:API)

### 7.1 Endpoint Conventions

```
Base URL: /api/v1/{resource}   (versioned from day one)

HTTP Method Semantics (STRICT, verified in e2e tests):
  GET      → Read-only retrieval; never mutates state; 200 OK / 304 Not Modified / 404
  POST     → Create new resource (collection); returns 201 Created with Location header
  PUT      → Full replace of existing resource (idempotent); 200 OK
  PATCH    → Partial update; 200 OK
  DELETE   → Delete / soft-delete; 204 No Content (no body)

Pagination: Cursor-based for large datasets, offset-based for small admin tables
  ✅ /api/v1/content-items?after=<cursor>&limit=20
  ✅ Response includes: { data: [...], meta: { hasNextPage, hasPrevPage, nextCursor, total } }

Filtering / Searching / Sorting:
  ✅ /api/v1/content-items?filter[category]=islamic&sort=-published_at,title
  ✅ /api/v1/content-items?search=quran (maps to tsquery when search_vector available)

Errors: RFC 7807 / Problem Details format
  ✅ {
       type: "https://docs.majlis-alim.app/errors/validation-failed",
       title: "Validation Failed",
       status: 422,
       detail: "Email format is invalid",
       instance: "/api/v1/auth/register",
       errors: [{ field: "email", message: "Invalid email format" }]
     }
```

---

## 8. QUALITY GATES (ALL AUTOMATED IN CI + MANUAL GATES)

### 8.1 CI Pipeline Quality Gates

```
Pull Request Pipeline (runs on every push to feature/bugfix branch):
  1. 🔒 Security Checks
     ├─ osv-scanner / npm audit — fail on HIGH or CRITICAL vulns
     ├─ Secret scanning (gitleaks) — fail if ANY secret detected
     └─ SAST (Semgrep with OWASP ruleset) — block on critical findings

  2. 📋 Static Analysis
     ├─ TypeScript strict type-check (tsc --noEmit) — fail on any error
     ├─ ESLint (all rules) — fail on error (warn OK)
     ├─ Prettier format check — fail if diff exists
     ├─ commitlint — fail on bad commit messages
     └─ Dart analyze + flutter_lints (if mobile changes)

  3. 🧪 Tests (with coverage gate)
     ├─ Unit tests (Jest / flutter_test / vitest) — fail on any test failure
     ├─ Coverage: new/changed code ≥ 70% line coverage, critical paths ≥ 80%
     ├─ Integration tests (if touched)
     └─ Architecture tests (ArchUnit or import-lint) — fail on boundary violations

  4. 🏗️ Build
     ├─ Backend: Docker build — multi-stage, no dev deps in image
     ├─ Frontend: Production build — size budget check (<= N KB per chunk)
     └─ Mobile: Flutter analyze + build APK (release mode) for size regression check

  5. 🚀 Schema Check (if migration exists)
     ├─ Migration forward (UP) on empty test DB — must succeed
     ├─ Migration rollback (DOWN) — must succeed
     ├─ Idempotency: run migration twice — must not error
     └─ DBA review required for any migration altering > 100K-row tables

  6. ⏱️ Performance Budget Check (PFE enforced, optional in PR)
     └─ If touches hot path: k6 smoke benchmark, compare against baseline
```

### 8.2 Manual / Phase Gates

| Gate | Occurs At | Approvers Required | Artifact Required |
|------|-----------|-------------------|-------------------|
| **Gate 0: Architecture Baseline** | Post-Phase 0 | CSA + Sponsor | Charter + Vision + ADRs signed off |
| **Gate 1: Phase 1 Complete** | Post-Phase 1 | CSA + SEC + DEV | IAM module, CI/CD live, Monitoring live, SEC review report |
| **Gate 2: Phase 2 Complete** | Post-Phase 2 | CSA + BKE + DBA + MOB + FEA | Content module + media library; integration test report; load test report |
| **Gate 3: Phase 3 Complete** | Post-Phase 3 | CSA + All Experts | Engagement + Notifications + Admin modules; UAT plan; UAT results |
| **Gate 4: Production Go-Live** | Immediate before deploy | Sponsor + CSA + SEC + DEV + QAE | Load test passed; security audit (0 crit/high); DR drill report; go/no-go checklist |

---

## 9. SECURITY GOVERNANCE

### 9.1 Security Baseline Checks (SEC Expert = VETO POWER)

```
EVERY CODE PATH MUST:
  ✅ Validate ALL input with Zod/class-validator (allowlists, not blocklists)
  ✅ Enforce authentication (unless explicitly marked @Public() decorator)
  ✅ Enforce authorization (RBAC/CASL) on every mutation endpoint
  ✅ Sanitize output — no PII returned to unauthorized callers
  ✅ Parameterize ALL queries (no SQL injection surface)
  ✅ Log security events: failed auth, permission denied, rate limit hit, admin actions
  ✅ Rate limit ALL public endpoints (auth endpoints = stricter)
  ✅ CSP, HSTS, X-Frame-Options, X-Content-Type-Options headers on ALL responses

DATA HANDLING:
  ✅ Passwords: argon2id or bcrypt (cost factor ≥ 12, tune per CPU budget)
  ✅ Tokens: JWT RS256 asymmetric signing (NOT HS256 shared secret), short-lived (15 min access)
  ✅ Secrets: NEVER in repo. Use env vars, Doppler, 1Password, etc.
  ✅ PII at rest: AES-256-GCM column-level encryption via application
  ✅ GDPR: user data export & delete endpoints, audit log of erasure actions
```

### 9.2 Incident Response (Pre-Approved Runbook)

```
Security Incident Severity Levels:
  SEV-1 (CRITICAL): Breach confirmed, data exposed, system compromised
    → Actions: Notify CSA + Sponsor IMMEDIATELY; activate DR plan; forensic; postmortem in 72h
  SEV-2 (HIGH): Vulnerability found, no confirmed breach but exploitable
    → Actions: Hotfix branch; fix deployed < 24h; full security review after
  SEV-3 (MEDIUM): Weakness with low exploitability
    → Actions: Fix in next release; track as tech debt
  SEV-4 (LOW): Cosmetic / informational
    → Actions: Backlog, fix within 1 month
```

---

## 10. DEPENDENCY MANAGEMENT

```
LIBRARY ADDITION / UPGRADE PROCESS:
  Step 1: Justify — why can't existing library do this? Document in PR.
  Step 2: If > 1000 weekly downloads impact → ADR-XXX required
  Step 3: License check — MIT/Apache-2.0 preferred; NO GPL unless explicitly authorized
  Step 4: Security check — osv-scanner, age of package, maintainer count, last release
  Step 5: CSA sign-off (required for all new runtime deps, not dev deps)

AUTOMATION:
  ✅ RenovateBot / Dependabot: opens PRs for minor/patch upgrades weekly
  ✅ Auto-merge: ONLY patch versions, CI passes, no test changes required
  ✅ Major versions: PR + CSA review + manual testing + changelog review
  ✅ Lock file: committed (package-lock.json, pubspec.lock, pnpm-lock.yaml — YES committed)
```

---

## 11. DATA GOVERNANCE & BACKUPS

```
DATABASE:
  ✅ Only DBA + CSA approve destructive schema changes
  ✅ All migrations reviewed by DBA; irreversible operations (DROP TABLE) need CSA + Sponsor sign-off
  ✅ PII columns: marked in schema comment → encrypted + never logged

BACKUPS (DEV + DBA co-own):
  ✅ PostgreSQL pg_basebackup daily; WAL archive continuous
  ✅ Encrypted before write to backup storage (AES-256-GCM)
  ✅ Monthly restore drill: restore to staging DB, run integrity + smoke tests, log results
  ✅ 3-2-1 Rule: 3 copies of data, 2 media types, 1 offsite (object storage bucket different region)
```

---

## 12. COMMUNICATION PROTOCOL

Since we are 10 AI accounts working asynchronously:

```
STANDARD COMMUNICATION PATTERNS:
  1. Decisions → ADR file OR PR discussion thread (NOT chat without trace)
  2. Status updates → Phase Completion Report (per Charter §6 phases)
  3. Cross-team clarifications → GitHub Discussion (architecture tag)
  4. Security-sensitive issues → Private GitHub Security Advisory (NOT public)
  5. CSA daily architecture check-in → review all open PRs for architectural issues

PHASE COMPLETION REPORT FORMAT (delivered by Expert to CSA at phase end):
  Executive Summary (1 para)
  What Was Completed (bullets, cross-referenced to Milestone list)
  What Was NOT Completed + Why (risks/issues)
  Code/Artifacts Changed (PR numbers, commit SHAs, file links)
  Quality Metrics (test coverage %, lint errors, build time trend)
  Open Risks / Technical Debt Found
  Recommendations for Next Phase
  Suggested Checklist Items for CSA Architecture Review
```

---

## 13. VIOLATION & ESCALATION

```
VIOLATION LEVELS & CONSEQUENCES:

  Level 0: Minor (naming, formatting)
    → Reviewer requests fix in PR; author fixes before merge
    → Repeat offender (3+ in one PR): CSA notified, PR flagged for quality

  Level 1: Moderate (architecture boundary violation, missing tests, lint error ignored)
    → CSA notified; PR BLOCKED until fixed; author must re-read relevant doc sections
    → Author writes 1-page reflection to CSA on what they learned

  Level 2: Severe (security regression, data loss possibility, intentional bypass of gates)
    → CSA EXERCISES VETO: PR closed; branch deleted if needed
    → Immediate stop-work on that expert's current task until architecture review held
    → Report to Sponsor (if in Charter escalation matrix)

  Level 3: Critical (data breach, credential leak, secret in repo)
    → CSA IMMEDIATELY halts ALL project work; SEC expert activates incident response
    → Incident postmortem document + root cause analysis required
    → Full repo audit + secret rotation

ESCALATION PATH:
  PR Review Comment → Expert-to-Expert Discussion → CSA Arbitration → Sponsor (if budget/scope)
  Once CSA rules: Decision is BINDING. Re-debate only permitted with NEW evidence + CSA invitation.
```

---

## 14. COMPLIANCE CHECKLIST (MONITORED MONTHLY BY CSA)

| Check | Frequency | Owner |
|-------|-----------|-------|
| All ADRs up to date with current implementation | Monthly | CSA + DOC |
| Governance document followed (random PR sample of 5 PRs) | Monthly | CSA |
| Security baseline audit (OWASP Top 10 automated scan) | Monthly | SEC + DEV |
| Backup restore drill + integrity check | Monthly | DEV + DBA |
| Dependency audit + upgrade pass | Weekly (Renovate) + Monthly review | DEV + SEC |
| Performance regression check (k6 hot path benchmarks) | Per release | PFE |
| Code coverage trend review | Per release | QAE + CSA |
| Tech debt backlog review | Per Phase | CSA + all Leads |

---

## 15. ARCHITECTURAL COMPLIANCE ENFORCEMENT (TECHNOLOGICAL GUARDRAILS)

Because humans make mistakes, the architecture is **enforced by tooling**, not just policy.

| Rule | Enforcement Mechanism |
|------|----------------------|
| No cross-module DB joins | ESLint rule forbidding `Repository` from another module; ArchUnit-style test; CI build fail |
| Domain layer has no external deps | TypeScript import path blacklist (eslint-plugin-import); CI build fail on violation |
| API versioning required | NestJS global prefix + lint rule that all controllers are under `/api/v:version/*` |
| Strict TypeScript | `tsc --noEmit --strict` runs in CI; build fail on any error |
| Conventional Commits | commitlint + Husky pre-commit hook; PR title check action |
| Branch naming | GitHub Actions branch name regex check; block bad branches before CI even runs |
| Secrets in code | gitleaks pre-commit hook + GitHub Secret Scan; push BLOCKED if any |
| Security headers | Helmet.js + E2E test that verifies headers present |
| Auth required by default | NestJS global guard; @Public() decorator opt-in; test that 99% of endpoints return 401 without token |
| Migration idempotency | CI step: applies migration twice; must pass without error |

---

## 16. FINAL DECLARATION

This Technical Governance document is **LIVING** — updated by CSA via PR with Sponsor notification. However, no expert account may violate it pending an update. The process to change it is: Expert proposes change via GitHub Issue → CSA evaluates → If CSA approves → ADR written → Governance document updated → All accounts notified.

**Non-compliance is not an option. Quality is not optional. Architecture is non-negotiable.**

This document, combined with the Project Charter and Architecture Vision, forms the **TRIPLE FOUNDATION** of the entire project. No implementation work proceeds until all three are **signed off** by the Project Sponsor and Chief Software Architect.

---

## CHANGE LOG

| Version | Date | Author | Change Description |
|---------|------|--------|--------------------|
| 1.0.0 | 2026-08-07 | Chief Software Architect | Initial complete governance: roles, RACI, GitFlow, PR gates, standards, compliance |
| 1.1.0 | 2026-08-09 | Chief Software Architect | Phase 0 consolidation: project renamed **Al-Fajr (الفجر)**; ticket prefix `SAF-`→`AF-`; aligned to canonical **5 bounded contexts** (identity, content, engagement, notifications, admin); neutralized course/lesson examples to BC-prefixed content-item naming; error `type` URL → `docs.al-fajr.app` placeholder; phase-gate module names rebased to the 5-module map; status **APPROVED** by Project Sponsor |

---

> **STATUS: 🟢 APPROVED — Signed off by Project Sponsor & Chief Software Architect (Phase 0 consolidation, 2026-08-09). This document, together with the Project Charter and Architecture Vision, forms the signed-off Triple Foundation of the project.**
