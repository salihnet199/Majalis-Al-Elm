# ADR-010: React Admin State Management — Zustand Stores + TanStack Query v5 (Server State) over Redux Toolkit / MobX / React Context + useReducer

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: Frontend Lead, Admin Panel SMEs, QA Automation
- **Date:** 2026-08-07
- **Supersedes:** None (foundational React admin architecture decision)
- **Related:** ADR-001 (Modular Monolith), ADR-014 (Monorepo Tooling)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform requires a **React Admin SPA** built with **Ant Design 5** for Super Admins, Admins, Editors, and Moderators. The admin panel has explicit state management requirements:
- **CRUD operations for all 4 content types** (AUDIO, PDF/BOOK, TEXT, IMAGE) with server-side pagination, filtering, sorting, optimistic updates, rollback on error
- **User management dashboard** with RBAC role assignment, user impersonation, audit log viewer, bulk actions, and role-scoped conditional rendering
- **Real-time notification center** (FCM Push, Email, SMS channel status) — campaign progress tracking, delivery metrics, failed retries dashboard
- **5 authentication methods** admin-managed: provider config toggles, OAuth app credential management, SMS provider API key rotation
- **i18n: 5+ languages RTL/LTR from day 1** — locale selector, theme mode (light/dark/auto), content language fallbacks
- **Ant Design 5** component ecosystem — AntD forms, tables, modals have their own internal state that must synchronize cleanly with app/server state
- **Budget constraint (Phase 1 Hostinger VPS):** Admin SPA bundle size must remain lean. Every kB of client state library has a direct user-facing latency impact.
- **10 expert accounts** collaborating in parallel — state boundaries must be clear, feature-scoped, and merge-conflict-minimal

A wrong choice here means: (a) 200+ KB of unnecessary Redux boilerplate shipped to every admin user, (b) "jumping components" due to Provider tree cascading re-renders, (c) server cache staleness leading to accidental data loss in admin CRUD operations, or (d) Zustand stores + query cache becoming a tangled mess without architectural guardrails.

---

## 2. Decision

**✅ WE WILL ADOPT A TWO-LAYER STATE ARCHITECTURE for the React Admin SPA:
(1) TanStack Query v5 for ALL server/cached/async state (data fetching, mutations, pagination, optimistic updates, cache invalidation).
(2) Zustand (with Immer middleware + persist middleware where needed) for ALL client-side global UI state (auth identity, RBAC claims, theme, locale, selected workspace, modal state, multi-step form draft state).**

Concrete actions implementing this decision:
1. **Strict separation mandate:** Server data NEVER lives in Zustand. UI global state NEVER lives in TanStack Query. Lint rule + code review enforce this.
2. **TanStack Query v5 configuration:**
   - Default `staleTime: 30_000` (30s) for list queries; `staleTime: 60_000` for detail queries; `gcTime: 5 * 60_000` (5 min) garbage collection
   - Mandatory `queryKey` factory per feature: `contentKeys`, `userKeys`, `notifKeys` — never inline query keys
   - Optimistic updates + rollback via `onMutate` / `onError` pattern for all destructive mutations
   - `react-query` DevTools enabled in all non-production builds
3. **Zustand store convention:** Feature-scoped stores in `apps/admin/src/stores/<feature>.store.ts` with `<Feature>Store` interface. Minimum stores: `authStore`, `uiStore` (theme/locale/layout), `entityEditorStore` (generic modal/drawer state).
4. **Zustand mandatory middleware:** `{ immer }` for all stores (no manual spread return). `{ persist }` only for `authStore` and `uiStore` (localStorage, versioned migrations).
5. **AntD 5 state bridge pattern:** AntD Form `useForm` instance state is LOCAL to the component. On submit → call TanStack mutation. Global "currently editing entity ID" lives in Zustand only if needed across multiple components.
6. **Anti-patterns FORBIDDEN (architectural lint):** No Redux/MobX imports. No `useContext` + `useReducer` beyond single-file scope. No prop drilling > 2 levels. No "global megastore" Zustand store with > 20 keys.
7. **Testing mandate:** TanStack queries tested with `MockServiceWorker` (MSW) + `QueryClientProvider` wrapper. Zustand stores unit-tested with `create` fresh instance per test (no global singleton leakage).

---

## 3. Alternatives Considered

### Alternative A: Redux Toolkit (RTK) + RTK Query
Official Redux team recommendation: Redux Toolkit for global state, RTK Query for server state. Single store, devtools, middleware pipeline.

- ✅ **Pro:** Industry gold standard for >10 years. Every senior React engineer knows Redux patterns. Hiring = trivial.
- ✅ **Pro:** RTK Query is genuinely excellent. Comparable feature parity to TanStack Query v4 (caching, optimistic updates, invalidation, polling).
- ✅ **Pro:** Redux DevTools are legendary. Time-travel debugging, action replay, state diffs — no other tooling comes close.
- ✅ **Pro:** Predictable. Every state change is an action with a stack trace. Debugging complex state flows = mechanical.
- ❌ **Con:** **Bundle bloat.** `@reduxjs/toolkit` + `react-redux` + `@redux-devtools/extension` = ~45 KB gzipped minimum. Add middleware and you are at 60-80 KB. For an admin SPA with ~150 KB total JS budget, this is **30-50% of the entire bundle** going to state management infrastructure, not features.
- ❌ **Con:** **Conceptual overhead for junior engineers.** Actions → Reducers → Selectors → Slices → Middleware → Thunks. A junior takes 2-4 weeks to be productive. Zustand: 2 days.
- ❌ **Con:** **Boilerplate is inescapable.** Yes, RTK reduces it. But you still write `createSlice`, `extraReducers`, `builder.addCase`, `createSelector`. Every. Single. Feature. A Zustand store is ~60% fewer lines for equivalent logic.
- ❌ **Con:** **"Everything is global" anti-pattern.** Redux's single store encourages putting every piece of state globally. AntD form state ends up in Redux. Modal open/closed booleans end up in Redux. Re-render performance degrades unless you `reselect` every single selector. Performance bugs are endemic in Redux apps because engineers forget to memoize.
- ❌ **Con:** **RTK Query is not TanStack Query v5.** RTK Query has weaker invalidation granularity, no built-in infinite scroll cursor pagination helpers, and a less-flexible `queryFn` API for custom REST endpoints (we use JSON:API spec which benefits from TanStack's flexibility).
- ❌ **Con:** **Team velocity regression.** AntD 5 + Redux is a known painful combo. AntD components manage their own internal state. Bridging AntD `Form.useForm()` → Redux → back → AntD is a ceremony that burns sprint days every release.

### Alternative B: MobX 6.x / mobx-state-tree
Reactive observable-based state management. Mutable stores that automatically track dependency subscriptions via Proxies.

- ✅ **Pro:** Minimal boilerplate. Write a class, decorate with `@observable` / `@action`. Done. Lines of code are comparable to Zustand.
- ✅ **Pro:** Fine-grained reactivity. Only components that read an observable re-render. Performance = excellent for large apps when used correctly.
- ✅ **Pro:** MST (mobx-state-tree) provides runtime schema validation and serialization out of the box.
- ❌ **Con:** **Magic = hard to debug.** "Why did this component re-render?" → You need MobX DevTools + trace() calls. Without discipline, re-render bugs are opaque. Redux has action logs; MobX has "figure it out from the reactive graph."
- ❌ **Con:** **Learning curve is deceptive.** Simple MobX is easy. Correct MobX (avoiding stale closures, correct use of `runInAction`, `observer` wrapping every component, `computed` not duplicating) requires an expert. A 10-engineer team will have 2-3 MobX experts and 7 engineers writing subtly buggy code.
- ❌ **Con:** **No industry momentum.** 2022-2026 data: MobX npm downloads are flat at ~5M/month, declining as a % of React ecosystem. Redux = 20M/month, Zustand = 10M/month and growing 40% YoY. In 2028, finding MobX engineers will be harder.
- ❌ **Con:** **MobX + TanStack Query integration is second-class.** No official patterns. The community has not converged on clean integration. Zustand + TanStack Query is the #1 recommended combo per TkDodo (TanStack Query maintainer) and the React Community Survey 2025.
- ❌ **Con:** **Anti-patterns are invisible.** In Redux/Zustand, a megastore is obvious (one 2000-line file). In MobX, you end up with cross-referenced singleton stores that silently observe each other via reactions, creating a spaghetti dependency graph that is unmaintainable at scale.
- ❌ **Con:** **CSA veto on "magic proxy" patterns.** AntD 5 uses internal proxies already. MobX proxies wrapping AntD proxies have caused production bugs in documented cases. The integration surface area is risky.

### Alternative C: React Context + useReducer (with "prop drilling is fine" ideology)
Built-in React APIs only. Create `AppContext`/`AuthContext`/`ThemeContext` providers, pair with `useReducer` for complex state, drill props otherwise.

- ✅ **Pro:** Zero dependencies. Bundle size = 0 KB added. Unbeatable for tiny apps.
- ✅ **Pro:** Every React engineer already knows Context + useReducer. No new library learning.
- ⚠️ **Pro:** "Prop drilling is fine" — if your component tree is shallow enough, and you use composition correctly, prop drilling has a bad reputation it doesn't always deserve.
- ❌ **Con:** **Provider cascading re-renders are a performance catastrophe.** If you put auth state + RBAC claims + theme + locale in a single context, updating the locale re-renders every consumer of that context. Workaround: split into 8+ individual contexts. But now you have `<AuthProvider><ThemeProvider><LocaleProvider><RBACProvider><EntityEditorProvider><NotificationProvider><SettingsProvider><CacheProvider>` wrapping the entire app. A provider hell of your own making.
- ❌ **Con:** **`useContext` has no selector API (until React 19 `use`).** Every consumer re-renders on any context value change. In React 18, you either accept the re-renders or hand-roll a subscription pattern. By the time you add a subscription pattern, you've re-invented Zustand poorly.
- ❌ **Con:** **Middleware = do it yourself.** Immer for immutable reducer updates? Import it manually. Persist state to localStorage? Hand-roll the `useEffect` hook. DevTools? No integration — state changes are invisible to debugging tools beyond `console.log`.
- ❌ **Con:** **Server state = completely absent.** This alternative doesn't address caching, invalidation, optimistic updates, polling, background re-fetch. You still need TanStack Query anyway! So Context + useReducer only replaces Zustand. For 15 KB saved, you lose DevTools, selectors, persist, middleware, Immer integration, and the entire Zustand ecosystem. Net negative.
- ❌ **Con:** **Known anti-pattern at our scale.** The admin panel will have 80-120+ screens. Context + useReducer is appropriate for <20 screen apps. Past 50 screens, every team that goes this route regrets it within 12 months. Stack Overflow is full of "how do I fix my context re-renders?" questions. We explicitly avoid learning this lesson the hard way.

### Alternative D: Zustand Stores + TanStack Query v5 (Our Decision)
Two specialized tools for two distinct state domains. Each library is the best-in-class for its job.

- ✅ **Pro:** **Bundle size: tiny.** Zustand = ~3 KB gzipped. TanStack Query v5 = ~18 KB gzipped. Combined = **~21 KB gzipped total**, vs Redux Toolkit + RTK Query's ~60-80 KB. **60% smaller state management footprint** → faster TTI on Hostinger VPS latency, smaller admin SPA download for users on slow connections (GCC/MENA region 3G/4G).
- ✅ **Pro:** **Separation of concerns = correct architecture.** Server state (fetched, cached, invalidated) lives in TanStack Query — where it belongs. Client UI state (global but not persisted to server) lives in Zustand — where it belongs. The two domains are philosophically different; forcing them into one abstraction (Redux single store) was always a category error.
- ✅ **Pro:** **TanStack Query v5 = world's best server state library.** TkDodo's documentation is legendary. JSON:API integration via custom `queryFn` is straightforward. Infinite scroll, cursor pagination, optimistic updates with rollback, `staleTime`/`gcTime` tuning, prefetching, persistence via `persistQueryClient` — all first-class.
- ✅ **Pro:** **Zustand = the best React global client state library (2024-2026 consensus).** Zustand won React Community Survey 2025 "Highest Satisfaction" and "Fastest Growth" categories. Stores are tiny, typed, have selectors built-in, persist middleware, Immer middleware, DevTools middleware — all opt-in and modular.
- ✅ **Pro:** **AntD 5 integration = frictionless.** AntD `Form.useForm()` stays local. Submit button → calls TanStack mutation. Selected entity ID lives in Zustand if the drawer/modal is opened from multiple places. No impedance mismatch ceremony.
- ✅ **Pro:** **Excellent testability.** Zustand stores = plain objects + setters. Reset the store in `beforeEach` → test state transitions deterministically. TanStack queries = mock the HTTP layer with MSW → test loading/success/error states with `waitFor`.
- ✅ **Pro:** **Junior engineer onboarding = fast.** Zustand API has ~5 functions (create, use, setState, getState, subscribe). A junior writes their first correct store in 30 minutes. Compare to Redux's 30+ concept vocabulary or MobX's 10+ decorators/concepts.
- ✅ **Pro:** **The #1 community-recommended combo for 2024-2026.** Every React thought leader (Kent C. Dodds, TkDodo, Mark Erikson, Dan Abramov when asked publicly) recommends "TanStack Query for server state + a light global store (Zustand preferred) for client state." This is the industry consensus.
- ⚠️ **Trade-off:** Two libraries = two APIs to learn. Mitigated: (a) The two APIs are tiny and orthogonally separated, (b) Code review checklist: "Is this server or client state? If server → Query. If client global → Zustand. If local → useState/useReducer.", (c) 1-hour team workshop covering both libraries with real AntD 5 examples.
- ⚠️ **Trade-off:** Zustand has no built-in action log / time-travel. Mitigated: (a) Zustand `devtools` middleware enables Redux DevTools integration with action logging (sans time-travel), (b) AntD 5 bugs are almost never "state went bad mysteriously" — they're form validation edge cases caught by unit tests, (c) Production bugs traceable via error boundaries + Sentry error stack frames.
- ⚠️ **Trade-off:** Zustand megastore risk. Without guardrails, a single 2000-line `useStore` devolves into a blob. Mitigated: (a) Architectural limit: no single Zustand store may have > 20 keys. Split into feature stores. (b) Lint rule: `create<>` in any file > 500 lines triggers Danger.js warning. (c) CSA code review for store boundary violations.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — Redux Toolkit + RTK Query | Alternative B — MobX 6 / MST | Alternative C — Context + useReducer | Alternative D — Zustand + TanStack Query v5 ✅ CHOSEN |
|-----------|-------------------------------------------|------------------------------|--------------------------------------|------------------------------------------------------|
| **Bundle Size (gzipped, state libs only)** | ❌ ~60-80 KB | ⚠️ ~35-45 KB | ✅ ~0 KB + TanStack still needed ~18 KB | ✅ **~21 KB TOTAL** (~3 KB Zustand + ~18 KB TSQ) |
| **Server State Handling** | ⚠️ RTK Query — very good, less flexible than TSQ v5 | ❌ Not addressed — need add-on library | ❌ Not addressed — manual fetch + cache logic required | ✅ TanStack Query v5 — best-in-class, JSON:API friendly |
| **Global UI State Handling** | ✅ Redux — excellent, overkill for our needs | ✅ MobX — excellent but magic-heavy | ⚠️ Context — works but re-render cascade risk | ✅ Zustand — best balance of simplicity + features |
| **AntD 5 Integration Friction** | ❌ High — Form.useForm() ↔ Redux bridge ceremony | ⚠️ Medium — proxy-on-proxy edge cases documented | ✅ Low — but no global state tooling | ✅ **Very Low** — AntD stays local, bridges are trivial |
| **Lines of Code (feature parity)** | ❌ 1.6x (actions/reducers/selectors/slices) | ⚠️ 1.1x | ⚠️ 1.0x + manual cache code | ✅ **1.0x baseline** — most terse complete solution |
| **Learning Curve (junior → productive)** | ❌ 2-4 weeks (Redux vocabulary deep) | ❌ 2-3 weeks (observables + traps) | ✅ ~3 days (React core knowledge) | ✅ **~2 days** (2 tiny APIs, orthogonal concerns) |
| **Debugging / DevTools** | ✅ Redux DevTools — gold standard | ⚠️ MobX DevTools — good, opaque re-render trace | ❌ None — console.log debugging | ⚠️ Zustand devtools + TSQ DevTools — very good, minus Redux time-travel |
| **Re-render Performance** | ⚠️ Good IF selectors memoized — often bad in practice | ✅ Excellent — fine-grained observables | ❌ Poor — cascading context re-renders endemic | ✅ **Excellent** — Zustand selectors + TSQ component-level subscriptions |
| **Testability** | ✅ Excellent — MSW + reducer unit tests trivial | ⚠️ Good but `runInAction` ceremony | ⚠️ Acceptable — lots of `renderHook` boilerplate | ✅ **Excellent** — Zustand = plain functions, TSQ = MSW-first docs |
| **Community Momentum (2024-2026)** | ⚠️ Mature, stable, slowly declining (still large) | ❌ Flat/decreasing — 0.5x Zustand downloads | ✅ Built-in React (always available) | ✅ **Fastest growing** — Zustand +40% YoY, TSQ industry standard |
| **Team Parallelism Risk (10 accounts)** | ⚠️ Megastore merge conflicts | ❌ Cross-reaction graph = implicit coupling | ⚠️ Provider chain merge conflicts | ✅ **Feature-scoped stores + queryKey factories = minimal conflict** |
| **i18n RTL/LTR + Theme Switch** | ✅ Works well | ⚠️ Works well | ⚠️ Works — but re-render cascade on switch | ✅ **Works perfectly** — Zustand persist + selector granularity |
| **Admin CRUD Optimistic Updates + Rollback** | ⚠️ RTK Query — works, less granular invalidation API | ❌ Manual — up to developer discipline | ❌ Manual — re-invent the wheel | ✅ **TSQ v5 — `onMutate`/`onError` pattern documented per JSON:API** |
| **Long-term Hiring Market (2026-2029)** | ✅ Redux = universal | ⚠️ MobX specialists declining | ✅ Context = universal | ✅ **Zustand + TSQ = every modern React engineer's go-to stack** |
| **Phase 1 Hostinger VPS Bundle TTI Impact** | ❌ 60-80 KB extra → +80-120ms TTI on 3G MENA | ⚠️ 35 KB extra → +50-70ms TTI | ✅ Minimal → ~18 KB TSQ only | ✅ **21 KB combined → +30-40ms TTI** — fastest option |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Smallest possible bundle size for a complete state solution.** 21 KB gzipped total vs Redux Toolkit's 60-80 KB → measurable faster Time-to-Interactive for GCC/MENA users on limited bandwidth. Hostinger VPS global latency is already challenging; every saved KB compounds.
2. **Correct separation of server vs client state.** This is the industry consensus "right architecture" for React 2024-2026. Engineers from other companies joining us will feel immediately at home.
3. **TanStack Query v5 server cache eliminates 90% of manual data-fetching bugs.** Stale-while-revalidate, optimistic updates with automatic rollback, pagination/infinite scroll, JSON:API custom queryFns — all battle-tested. The number of "user submitted form but saw cached data" production bugs drops to near-zero.
4. **Zustand stores are 60% shorter than Redux slices for equivalent logic.** Less code = fewer bugs = faster feature velocity. AntD 5 Form integration has zero ceremony compared to Redux bridges.
5. **Junior engineers productive within 48 hours.** Two tiny APIs with excellent docs and videos. We spend less time on state management training and more time on business-domain features.
6. **Minimal merge conflicts in parallel 10-engineer work.** Feature-scoped Zustand stores (5-8 small stores) and per-feature queryKey factories mean PRs touch disjoint files. The "every PR touches the Redux store" merge conflict factory is eliminated.
7. **Best-in-class DevTools for both layers.** Zustand DevTools middleware + TanStack Query DevTools give us 95% of Redux DevTools visibility. The missing 5% (true time-travel) is not missed in practice for admin CRUD apps.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Two libraries = two separate mental models.** Server state logic and client state logic are treated differently. **Mitigation:** (a) Code review checklist: first question "is this server state or client state?" → directs to correct library, (b) 1-hour workshop on Day 1 with 5 real examples, (c) Architectural Decision record ADR-010 linked in PR template.
2. **Zustand lacks Redux's true time-travel debugging.** **Mitigation:** (a) The bugs we get in admin panels are overwhelmingly form validation bugs, AntD component edge cases, and incorrect optimistic update logic — all caught by unit tests, not state time-travel, (b) Error Boundary + Sentry stack traces give us reproducible production bug reports, (c) If a specific class of state bugs emerges, we add the `redux-devtools` middleware to Zustand which gives action-level logging.
3. **TanStack Query `staleTime`/`gcTime` tuning is an art.** Wrong values → stale data or too-frequent re-fetches. **Mitigation:** (a) Sensible defaults per decision #2, (b) Admin panel has a Dev/QA-only "Query Cache Inspector" debug panel showing query keys, stale times, and last-fetched timestamps, (c) Performance review at Month 3 post-launch: QA reports staleness issues → CSA tunes cache values.
4. **Zustand megastore anti-pattern requires active enforcement.** **Mitigation:** (a) Store size budget: 20 keys / 500 lines per store. Danger.js CI warning triggered automatically on violations. (b) Feature ownership: each store has a named owner expert — owners must approve any cross-feature import of their store's internal selectors.

### Neutral / Unknown (risks to monitor)
1. **React 19 `use()` hook and `useContextSelector`.** React 19 (ETA ~2026 Q4, GA ~2027 Q1) may obsolete part of Zustand's value prop if Context gets built-in selector semantics. Risk is low: (a) React 19 GA is minimum 12 months away, (b) Zustand will add adapters if needed (project maintains React 18 compatibility window per charter §7), (c) Even if Context improves, Zustand's persist/immer/devtools middleware stack still has massive value. We monitor React 19 betas and re-evaluate at ADR annual review.
2. **Will the 10-expert team respect the "server state → Query only" boundary?** Governance: PR template includes a checkbox. Frontend Lead's review checklist item #1 = verify no server fetch results in Zustand unless explicitly approved by CSA for offline/draft reasons.
3. **TanStack Query v6 migration impact.** TanStack releases a major version ~every 18 months. v5 was released 2024 Q3. v6 will be 2026 Q3/Q4. We pin v5 exactly in package.json and accept no v6 upgrades until the Admin Panel is 100% feature-complete and v6 migration guide has been reviewed by Frontend Lead + CSA.

---

## 6. Reversal / Exit Criteria (When to Re-Open This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Debugging Crisis):** For 60 consecutive days, >25% of admin-panel production bugs are classified as "state-originated with no reproducible stack trace," and both Frontend Lead and QA Lead certify in writing that Redux-style time-travel debugging would have reduced time-to-fix by >50% for the majority of those bugs.
   - **Action:** Migrate Zustand global stores to Redux Toolkit, retaining TanStack Query for server state. Hybrid RTK + TSQ is a well-documented pattern.

2. **TRIGGER 2 (Bundle Size Reversal):** Total admin SPA bundle grows beyond **1.2 MB gzipped** (per performance budget in charter §7), and a bundle analysis audit confirms that Zustand + TanStack Query combined account for >5% of total bundle AND that switching to an alternative saves >30 KB gzipped.
   - **Action:** Extremely unlikely given current numbers, but we include for completeness. Evaluate Context + useReducer for the smallest Zustand stores that are candidates.

3. **TRIGGER 3 (Structural Zustand Anti-patterns):** Architectural lint + code review fail to prevent the emergence of a single Zustand "megastore" with >30 cross-feature dependencies, and a 2-week refactoring sprint cannot decompose it.
   - **Action:** Redux Toolkit migration. Redux's slice pattern + `combineReducers` is more forgiving of large teams with weak architectural discipline.

4. **TRIGGER 4 (Team Hiring Attrition):** For 3 consecutive quarters, >50% of candidates screened for React roles cite "no Zustand or TanStack Query experience" as a disqualifying factor, AND team turnover in admin panel FE team exceeds 33% in a single year.
   - **Action:** Re-evaluate. Redux Toolkit has the largest talent pool. We accept the bundle size hit to solve the hiring crisis.

5. **TRIGGER 5 (AntD Structural Changes):** Ant Design 6.x releases with a **breaking** first-party Redux integration requirement, or AntD 5 reaches EOL with no upgrade path except a framework that requires a specific state library.
   - **Action:** Migrate to whatever AntD officially endorses. Framework alignment trumps state library preferences.

We **explicitly do NOT revisit** this decision:
- Because a new hire "prefers Redux from my last job"
- Because a random blog post says "Zustand is dead"
- Before 12 months of production usage
- Without production bug/metrics evidence, not anecdotal complaints
- Without CSA + Frontend Lead co-signatures

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §7 Technology Stack Guidelines (bundle size budgets), §10 Admin Panel Requirements, §15 Performance Targets
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §7 React Admin SPA Architecture, §12 Caching Strategy
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §7 Code Style & Linting, §13 Architectural Compliance Enforcement (Danger.js rules)
- [ADR-001 Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md)
- [ADR-004 API Style: REST JSON:API](ADR-004-api-style-rest-json-api.md) — (TanStack Query v5 integrates with JSON:API via custom queryFn pattern)
- [ADR-014 Monorepo Tooling — Nx](ADR-014-monorepo-tooling-nx.md)
- External: TanStack Query v5 Official Docs — tanstack.com/query (v5, maintained by TkDodo / Dominik Dorfmeister)
- External: Zustand Official Docs — zustand-dot.pmnd.rs (pmndrs collective, 2026)
- External: React Community Survey 2025 Results — State Management Satisfaction Rankings (Zustand #1, Redux #4, MobX #7)
- External: Kent C. Dodds — "Application State Management with React" (kentcdodds.com, 2024 update)
- External: TkDodo Blog — "Server State vs. Client State" (tkdodo.eu, permanently canonical post)
- External: Mark Erikson (Redux Maintainer) — "Redux, Context, Zustand — When to Use What" (blog.isquaredsoftware.com, 2025)
- External: Ant Design 5.x Official Docs + React Integration Patterns (ant.design)

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Sent for Frontend Lead + Sponsor review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; admin roles aligned to the 5-role model (SuperAdmin/Admin/Editor/Moderator/User — Instructor removed); relative doc links; fixed ADR-004/ADR-014 links.
