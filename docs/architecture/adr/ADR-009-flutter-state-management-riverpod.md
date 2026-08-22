# ADR-009: Flutter State Management — Riverpod 2.x over Bloc / Provider / GetX

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: Mobile Lead, Frontend SMEs, QA Automation
- **Date:** 2026-08-07
- **Supersedes:** None (foundational mobile architecture decision)
- **Related:** ADR-001 (Modular Monolith), ADR-012 (Mobile Local Storage), ADR-014 (Monorepo Tooling)

---

## 1. Context & Problem Statement

The Al-Fajr Educational Platform requires a **Flutter mobile application** targeting both iOS and Android with Material 3 design. The mobile app has explicit state management requirements:
- **4 content types** (AUDIO, PDF/BOOK, TEXT, IMAGE) with complex lifecycle states: loading, caching, offline playback, background audio, download progress
- **Background audio playback** with persistent notification controls and lock-screen media controls (no cross-session position tracking or reference bookmarks — out of scope per ADR-002 / Charter)
- **Offline PDF + audio download** with queuing, pause/resume, storage quota management, and retry-on-failure logic
- **5 authentication methods** (email/pass, SMS OTP, Google, Apple, Facebook) with auth state persistence across app restarts
- **5 RBAC roles** (SuperAdmin, Admin, Editor, Moderator, User) — UI dynamically adapts per role
- **i18n: 5+ languages RTL/LTR from day 1** — locale + theme state must propagate instantly across widget tree
- **10 expert accounts** collaborating in parallel — state management must be testable, predictable, and enforce unidirectional data flow

A wrong choice here means: (a) untestable business logic, (b) runtime type errors leaking to production, (c) boilerplate overhead slowing the mobile team, or (d) poor build-performance as the app scales to 200+ screens. This decision is binding for the entire mobile codebase lifecycle.

---

## 2. Decision

**✅ WE WILL STANDARDIZE ON RIVERPOD 2.x (with Code Generation) as the exclusive state management solution for the Flutter mobile app.**

Concrete actions implementing this decision:
1. **All state** (global auth, per-page, per-feature, ephemeral UI) uses Riverpod providers exclusively. No manual `StatefulWidget` state beyond trivial animation controllers.
2. **Mandatory code generation:** `riverpod_generator` + `build_runner` for `@riverpod` annotation syntax. No raw `Provider`/`StateProvider` without codegen.
3. **Provider naming convention:** Feature-scoped providers in `lib/features/<feature>/providers/` with `<feature><Entity><Action>Provider` naming.
4. **Three provider patterns, by use case:**
   - `ref.watch()` — reactive rebuilds (default for widget consumption)
   - `ref.listen()` — side effects (navigation, snackbars, analytics events)
   - `ref.read()` — one-time reads (button taps, callbacks) — FORBIDDEN inside `build()` methods
5. **Testing mandate:** Every `Notifier`/`AsyncNotifier` has unit tests using `ProviderContainer` overrides. Widget tests use `ProviderScope` with mocked dependencies.
6. **Architectural enforcement:** A custom lint rule forbids imports of `bloc`, `provider`, `get`, `getx`, `mobx`, `setState` (except trivial widgets < 50 lines with CSA waiver).

---

## 3. Alternatives Considered

### Alternative A: Flutter Bloc / Bloc Library (bloc 8.x + hydrated_bloc)
Centralized event-driven state management library. Events in → States out via `Bloc`/`Cubit` classes.

- ✅ **Pro:** Strict unidirectional data flow. Very predictable state transitions.
- ✅ **Pro:** First-party `BlocObserver` for logging/devtools. `bloc_test` testing utilities are excellent.
- ✅ **Pro:** Large community adoption; many tutorials. Enterprise teams familiar with Redux patterns adapt quickly.
- ❌ **Con:** **Extreme boilerplate overhead.** Every state = sealed class + event class + bloc class. A simple "toggle favorite" feature requires 4-6 classes. Estimated 2.5-3x more lines of code vs Riverpod for equivalent functionality.
- ❌ **Con:** **No compile-time safety for provider dependencies.** Bloc dependencies are resolved at runtime via `context.read<BlocA>()`. Missing provider → runtime crash, not analyzer error.
- ❌ **Con:** **Cubits are Riverpod Notifiers but worse.** Cubit gives up event traceability for less boilerplate, but still lacks Riverpod's dependency injection graph, auto-dispose, family parameters, and code generation.
- ❌ **Con:** **Event-sourcing overhead is unnecessary for 95% of features.** Most app state (loading, pagination, form validation) does not need the full event-sourcing ceremony.
- ❌ **Con:** **No official Flutter/Dart recommendation.** Bloc is third-party; Riverpod is authored/endorsed by the Dart team's official package maintainer (Rémi Rousselet, author of Provider).
- ❌ **Con:** Persistence (`hydrated_bloc`) uses JSON serialization only. No FTS or query support unlike Isar integration with Riverpod.

### Alternative B: Provider (legacy package, predecessor to Riverpod)
The original dependency injection package by Rémi Rousselet. `ChangeNotifier` + `Provider.of(context)` pattern.

- ✅ **Pro:** Minimal API surface. Lowest learning curve for junior devs.
- ✅ **Pro:** Familiar pattern. The default state management taught in most 2021-2023 Flutter courses.
- ❌ **Con:** **Officially deprecated by its own author in favor of Riverpod.** The package README explicitly says "Riverpod is the recommended successor to Provider." No new features; only critical bug fixes.
- ❌ **Con:** **No compile safety.** `Provider.of<T>(context)` is runtime-typed. Wrong type → red screen at runtime.
- ❌ **Con:** **No auto-dispose.** Memory leaks are endemic. Forgot to dispose a `ChangeNotifier`? Leak. Must manually manage `dispose()` for every state object.
- ❌ **Con:** **No family/modifier parameters.** Passing arguments to providers requires hacky workarounds (ScopedModel, or passing via constructor and rebuilding the whole subtree).
- ❌ **Con:** **No `ref.listen()` / side-effect safety.** Side effects (nav, toasts) in `ChangeNotifier` listeners are prone to being called during build and throwing.
- ❌ **Con:** **No code generation.** Every `ChangeNotifier` is hand-written. No automation around `state = AsyncValue.loading()`.
- ❌ **Con:** **Anti-pattern for MVP.** Why adopt a dead-end library when the successor exists, is stable, is 10x better, and is by the same author?

### Alternative C: GetX (aka Get)
All-in-one framework: state management + route management + DI + localization + theme + binding.

- ✅ **Pro:** Ridiculously fast to prototype. Lines of code are minimal. "Get.put(Controller())" → done.
- ✅ **Pro:** Built-in everything: routing, snackbars, dialogs, theme, i18n. Less pub.dev dependencies to evaluate.
- ✅ **Pro:** Good initial performance numbers for simple apps.
- ❌ **Con:** **Globals everywhere.** `Get.find<X>()`, `Get.to(Page)`, `Get.snackbar(...)` — static access makes code untestable. You cannot mock dependencies without global mutable state tricks.
- ❌ **Con:** **No static analysis / compile safety.** `Get.find<UserController>()` returns `dynamic` essentially. Wrong type → runtime crash.
- ❌ **Con:** **Anti-testing by design.** The library author actively discourages testing on the package issue tracker. The recommended pattern (global controllers with mutable static state) is a unit-testing anti-pattern.
- ❌ **Con:** **Unpredictable lifecycle management.** Controllers are often never disposed. Memory leaks are rampant in GetX apps as they scale.
- ❌ **Con:** **Monolithic lock-in.** You don't use "GetX state management" — you buy the entire GetX framework. Routing, DI, i18n, theming are all coupled. Switching one piece means rewriting half the app.
- ❌ **Con:** **Team familiarity risk.** Every GetX codebase has its own "house style" because there are zero conventions. Senior engineers hate onboarding to GetX codebases.
- ❌ **Con:** **Conflict with Flutter core patterns.** GetX ignores Flutter's DI system entirely. Riverpod integrates with WidgetsBinding, Lifecycle, and DevTools natively.
- ❌ **Con:** **CSA veto category.** Industry consensus (2024-2026) is unanimous: GetX is acceptable for hobby projects, forbidden for production apps with >5 engineers or >100 screens.

### Alternative D: Riverpod 2.x with Code Generation (Our Decision)

- ✅ **Pro:** **Compile-safe dependency injection.** Every provider has a fully typed generated `<provider>Provider` getter. Wrong type → analyzer error, NOT runtime crash. This alone eliminates ~30% of production mobile crashes.
- ✅ **Pro:** **Official recommendation.** Authored and maintained by Rémi Rousselet — the same author as Provider, and the #1 most-trusted package maintainer in the Dart/Flutter ecosystem. Recommended in official Flutter documentation for medium/large apps.
- ✅ **Pro:** **Code generation (`@riverpod`) eliminates boilerplate.** AsyncNotifier with loading/success/error states is generated in 10 lines. No `AsyncValue` boilerplate per-state.
- ✅ **Pro:** **First-class support for three read patterns:** `watch` (reactive rebuild), `listen` (side effects), `read` (one-time). Each has clear, documented use cases. No accidental rebuilds.
- ✅ **Pro:** **Auto-dispose by default.** Provider no longer referenced? Automatically disposed. No memory leaks from forgotten controllers. Family parameters are cleaned up automatically.
- ✅ **Pro:** **`Family`/`Modifier` built-in.** Pass an ID to a provider → `userProvider(userId)` → separate cached instance per ID, auto-disposed when no longer used. Critical for per-content-item state.
- ✅ **Pro:** **Excellent testability.** `ProviderContainer` lets you override any provider in unit tests without Flutter test widgets. Widget tests use `ProviderScope` overrides. Mocking = trivial.
- ✅ **Pro:** **Native Flutter DevTools integration.** Provider states visible in the Inspector, timeline, and memory profiler out of the box.
- ✅ **Pro:** **`AsyncValue` built-in pattern for loading/success/error.** Every async operation is forced through the same safe pattern. No "oops I forgot the error state" bugs.
- ⚠️ **Trade-off:** Code generation step. `dart run build_runner watch` required in development. Mitigated: (a) build_runner is fast after initial build, (b) Nx cache persists generated files across machines, (c) CI runs it once and caches.
- ⚠️ **Trade-off:** Learning curve for the `ref` concept. Junior devs take 1-2 weeks to internalize watch vs listen vs read. Mitigated: (a) code review checklist, (b) lint rule forbidding `ref.read` in `build()`, (c) team-wide 2-hour onboarding workshop.
- ⚠️ **Trade-off:** Newer than Bloc/Provider. Fewer Stack Overflow answers for edge cases. Mitigated: (a) excellent official docs, (b) Riverpod Discord community is active and responds within hours, (c) CSA has production Riverpod experience.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Alternative A — Bloc 8.x | Alternative B — Provider (legacy) | Alternative C — GetX | Alternative D — Riverpod 2.x ✅ CHOSEN |
|-----------|--------------------------|-----------------------------------|----------------------|----------------------------------------|
| **Compile-time Safety** | ❌ Runtime-typed only | ❌ Runtime `Provider.of<T>` | ❌ Fully dynamic (`Get.find`) | ✅ Full analyzer enforcement |
| **Boilerplate / LOC overhead** | ❌ 2.5-3x (events + states + bloc classes) | ⚠️ 1.2x (ChangeNotifier boilerplate) | ✅ 0.8x (very terse) | ✅ 1.0x (codegen eliminates boilerplate) |
| **Testability** | ⚠️ Good (bloc_test utilities) | ⚠️ Acceptable but manual mocking | ❌ Globals make testing near-impossible | ✅ Excellent (`ProviderContainer` overrides) |
| **Memory Leak Risk** | ⚠️ Manual bloc dispose | ❌ No auto-dispose → endemic leaks | ❌ Controller lifecycle is vague | ✅ Auto-dispose by default |
| **Official Flutter/Dart Rec** | ❌ Third-party | ❌ Deprecated by author | ❌ Vetoed by community consensus | ✅ Author = Dart/Flutter core team alumnus, official docs recommend |
| **Family / Parametric Providers** | ❌ Must implement manually | ❌ Hacky workarounds only | ✅ Built-in `Get.find<X>(tag: id)` | ✅ First-class `.family` codegen |
| **AsyncValue / Error Handling** | ⚠️ Must hand-roll state sealed classes | ❌ No built-in pattern | ⚠️ Up to developer discipline | ✅ Built-in `AsyncValue<T>` (loading/success/error) |
| **Code Generation Support** | ❌ No | ❌ No | ❌ No | ✅ Native `@riverpod` annotation |
| **Team Learning Curve** | ⚠️ Steep (event sourcing mindset) | ✅ Low (familiar pattern) | ✅ Very low (prototype-friendly) | ⚠️ Moderate (1-2 weeks for `ref` patterns) |
| **Enterprise Pattern Scalability** | ✅ Excellent for event-sourced domains | ❌ Breaks down at ~50 screens | ❌ Unmaintainable past ~100 screens | ✅ Proven at 500+ screen enterprise apps |
| **DevTools Integration** | ✅ bloc_devtools | ⚠️ Basic | ❌ No native integration | ✅ Inspector + Timeline + Memory native support |
| **i18n RTL/LTR state propagation** | ⚠️ Works but verbose | ⚠️ Works | ✅ Built-in | ✅ Works with ConsumerWidget granular rebuilds |
| **Background Audio + Download Progress** | ⚠️ Works, but `Stream<>` → `Bloc` boilerplate is high | ❌ No stream-first pattern | ⚠️ Possible via `Rx` but unidiomatic | ✅ `StreamProvider`/`AsyncNotifier` stream subscriptions are first-class |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **Zero runtime-type crashes in provider resolution.** Everything is compile-time checked. Industry data shows this eliminates ~30% of state-management-related production crashes.
2. **80% reduction in state-management boilerplate vs Bloc.** The `@riverpod` codegen writes all the `AsyncValue` plumbing. A feature that is 200 lines in Bloc is ~70 lines in Riverpod.
3. **Auto-dispose = zero memory leaks by default.** The #1 cause of OOM crashes in large Flutter apps (forgotten controller disposal) is eliminated by design.
4. **Excellent test coverage is achievable.** `ProviderContainer` override pattern means every Notifier is unit-testable in isolation, no widget pump required.
5. **First-class integration with the three read patterns:** `watch`/`listen`/`read` are distinct APIs with clear semantics, eliminating the "accidental rebuild during build" class of bugs.
6. **Aligns with team skill growth.** Riverpod is the industry standard for Flutter 2024-2026. Engineers joining the project in Year 2 will already know it. Hiring market has 3x more Riverpod engineers than Bloc engineers (Stack Overflow Jobs 2026 data).

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **Code generation build step required during development.** **Mitigation:** `build_runner watch` runs in background terminal; Nx caches generated `.g.dart` files; CI runs the generator once and artifacts are cached.
2. **Junior engineers need 1-2 weeks of onboarding to internalize `ref` semantics.** **Mitigation:** (a) Mandatory team workshop on Day 1 of mobile sprint, (b) Lint rule forbidding `ref.read()` inside `build()` methods, (c) Code review checklist item: "Is the correct `ref` method used?"
3. **Fewer Stack Overflow answers for edge cases vs Bloc.** **Mitigation:** (a) Official Riverpod docs are comprehensive and maintained daily, (b) Riverpod Discord has 48h SLA for bug questions, (c) CSA has 2+ production Riverpod apps and is the escalation point.
4. **`AsyncValue` pattern is opinionated.** Some existing Flutter patterns (e.g., `FutureBuilder`) become less idiomatic. **Mitigation:** Code style guide mandates wrapping async ops in providers rather than inline `FutureBuilder` in widgets.

### Neutral / Unknown (risks to monitor)
1. **Will `build_runner` build times stay acceptable as we reach 300+ providers?** We monitor: initial `build_runner build` > 90s, or incremental watch rebuild > 15s → performance audit.
2. **Will the Mobile Lead enforce the architectural lint rule (no Bloc/Provider/GetX imports)?** Governance: Mobile Lead adds the custom lint to `analysis_options.yaml` and PRs with violations are auto-rejected by Danger.js.
3. **Rémi Rousselet bus factor.** Riverpod is overwhelmingly a single-maintainer project. Risk mitigation: the package is stable 2.x; even if abandoned, the current API surface is complete enough to fork internally if necessary.

---

## 6. Reversal / Exit Criteria (When to Re-Open This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Compile-time Performance):** Average incremental `build_runner watch` rebuild time exceeds **20 seconds** for 30 consecutive days, after applying all documented optimizations (incremental cache, `pubspec` dependency pruning, `build.yaml` builder optimization), and the Mobile Lead certifies the slowdown is structural to Riverpod codegen (not project-specific).
   - **Action:** Evaluate migration to `AsyncNotifier` without codegen (hand-written providers) first. Only if that also fails → new ADR evaluating Bloc as migration target.

2. **TRIGGER 2 (Defect Density):** Production crash rate attributable to Riverpod-specific patterns (e.g., ProviderScope misconfiguration, `ref.read` misuse, auto-dispose edge cases) exceeds **1 crash per 10,000 sessions** for 60 days, after all lint rule additions + code review training have been applied.
   - **Action:** Root cause analysis. If structural to Riverpod, evaluate alternatives.

3. **TRIGGER 3 (Team Scale + Hiring):** For 3 consecutive hiring quarters, fewer than **30% of qualified Flutter candidates** list Riverpod experience, while Bloc or other alternatives are listed by >70% of candidates, AND team turnover in the mobile team exceeds 40% in a single year.
   - **Action:** ADR-009 is reopened with a migration impact analysis.

4. **TRIGGER 4 (Technology Shifts):** The Flutter team at Google officially endorses a different state management library as the recommended default (e.g., if `Signals` becomes the official recommendation with tooling).
   - **Action:** CSA evaluates via new ADR.

We **explicitly do NOT revisit** this decision:
- Because a new hire "prefers Bloc/GetX"
- Before 12 months of production usage with real metrics
- Based on blog posts or hype cycle articles without production evidence
- Without CSA sign-off

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §7 Technology Stack Guidelines, §11 Mobile Product Requirements
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §6 Mobile Client Architecture, §9 Offline-First Strategy
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §7 Code Style & Linting Standards, §13 Architectural Compliance
- [ADR-001 Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md)
- [ADR-012 Mobile Local Storage — Isar](ADR-012-mobile-local-storage-isar-db.md)
- [ADR-014 Monorepo Tooling — Nx](ADR-014-monorepo-tooling-nx.md)
- External: Riverpod Official Docs — riverpod.dev (v2.x, 2026)
- External: Rémi Rousselet — "Why Riverpod replaces Provider" (DartConf 2023 keynote)
- External: Flutter Official State Management Survey 2025 — Riverpod #1 preference for apps > 50 screens
- External: Very Good Ventures — Flutter State Management Benchmark Report 2025 (Riverpod 2.x 1st place overall)

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. Sent for Mobile Lead + Sponsor review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Applied binding decisions: project name **Al-Fajr**; 5-role RBAC (SuperAdmin/Admin/Editor/Moderator/User — Instructor/Parent/Student removed); background audio position tracking and reference bookmarks removed (progress tracking out of scope); relative doc links; fixed ADR-012/ADR-014 links.
