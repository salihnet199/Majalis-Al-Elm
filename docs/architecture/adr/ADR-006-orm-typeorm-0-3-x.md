# ADR-006: ORM / Data Mapper — TypeORM 0.3.x over Prisma / Drizzle / Knex

- **Status:** 🟢 ACCEPTED — Signed off by Project Sponsor (Phase 0 consolidation, 2026-08-09)
- **Deciders:** Chief Software Architect (Binding) — Consulted: BKE, DBA, PFE
- **Date:** 2026-08-07
- **Supersedes:** None (foundational decision)
- **Related:** ADR-001 (Modular Monolith), ADR-002 (Bounded Contexts), ADR-005 (PostgreSQL 16)

---

## 1. Context & Problem Statement

Per ADR-001 Modular Monolith + ADR-005 PostgreSQL 16, we must select an **Object-Relational Mapper (ORM) / Data Mapper layer** between NestJS application code and the PostgreSQL schema. The wrong ORM choice cascades into:

1. **Domain Layer pollution.** The ORM entity definition leaks into domain logic (violates Clean Architecture P-01: Domain-Centric).
2. **Migration fragility.** Schema changes across 5 Bounded Context modules require migration coordination. If the ORM generates buggy migrations → production data loss.
3. **NestJS integration friction.** Some ORMs have weak NestJS DI integration; every module bootstraps its own ORM client, violating single-DB-connection-pool best practice.
4. **Performance cliffs.** Category tree traversal (BC02 content categories = 4-level deep tree), UUIDv7 PK handling, JSONB translatable field queries, and tsvector search all require specific ORM support. If the ORM forces raw SQL for 50% of queries → ORM value is zero.
5. **Repository pattern enforcement (P-06 Persistence Ignorance).** Domain layer defines Repository Interfaces (e.g., `interface ContentRepository { findById(id: UUID): Promise<Content | null> }`). Infrastructure layer implements them with the ORM. ORM must support this pattern cleanly.

Four candidates evaluated:
- **TypeORM 0.3.x** — De facto NestJS ORM, Data Mapper + Active Record, Repository pattern, migrations, tree entities, PostgreSQL 16 native
- **Prisma 5.x** — Schema-first Prisma Schema Language, generated client, auto-migrations, typesafe query builder
- **Drizzle ORM** — Typescript schema-first, SQL-like query builder, zero-runtime-overhead, lightweight migrations
- **Knex.js + objection.js** — Knex query builder + objection.js ORM, explicit SQL control, minimal abstraction

---

## 2. Decision

**✅ WE WILL USE TYPEORM 0.3.x (DATA MAPPER PATTERN, REPOSITORY MODE) as our ORM / Persistence layer. NestJS `@nestjs/typeorm` module with TypeORM DataSource globally configured. Each Bounded Context module owns its own Entity files + Migration files. Repository interfaces live in Domain Layer; TypeORM Repository implementations live in Infrastructure Layer (Persistence Ignorance P-06).**

### 2.1 Required TypeORM Features Mapped to Platform Requirements

| Platform Requirement | TypeORM Feature | Implementation Pattern |
|-----------------------|------------------|-------------------------|
| **Repository Pattern + Clean Architecture (P-06)** | Custom Repository classes + Entity metadata | Domain layer: `interface UserRepository` (no ORM imports). Infrastructure layer: `TypeOrmUserRepository implements UserRepository` (uses `@InjectRepository(User)` Entity). Dependencies point inward. Domain never imports TypeORM. |
| **5 Bounded Contexts → Module-specific Entities + Migrations** | Multiple migration sources, migrations per module in `{module}/infrastructure/persistence/migrations/` | Nx monorepo root `data-source.ts` auto-discovers migrations from `apps/backend/src/**/migrations/*.ts`. Entity per module: `identity/entities/`, `content/entities/`, etc. Table prefixes per ADR-002 enforced via Entity decorator: `@Entity({ name: 'id_users' })`. |
| **UUIDv7 Primary Keys (ADR-005)** | `PrimaryGeneratedColumn('uuid')` with custom generator + `Column({ type: 'uuid' })` | Entity: `@PrimaryGeneratedColumn('uuid', { generator: 'uuidv7' })`. Custom TypeORM UUIDv7 generator class registered in DataSource. Generated before INSERT; no need for DB trigger. Works with PostgreSQL `uuid` column type. |
| **Content Categories — Tree Entity (4-level deep)** | Tree decorators: `@Tree('materialized-path')` + `TreeRepository` + `findDescendants()` / `findAncestors()` | Category entity uses `@Tree('materialized-path')` (PostgreSQL LTree extension path via `ltree` column; or nested-set or closure-table pattern). `TreeRepository<Category>` implements `getContentCategoryTree()` method used by Content Query Controller for nested category dropdowns in both Mobile and Admin. |
| **JSONB Translatable Fields (title, description)** | `Column({ type: 'jsonb' })` + JSONB operators in Query Builder | Entity: `@Column({ type: 'jsonb', default: () => "'{}'::jsonb" }) title: Record<string, string>`. Query Builder: `contentRepository.createQueryBuilder('c').where("c.title @> :title", { title: JSON.stringify({ ar: "العنوان" }) }).getMany()`. GIN indexes declared in Entity: `@Index({ using: 'gin' })` on JSONB columns. |
| **tsvector Full-Text Search (Phase 2)** | Query Builder raw expression support + `addSelect()` with stored generated column | Entity defines `@Column({ type: 'tsvector', generatedType: 'STORED', asExpression: "to_tsvector('arabic', title->>'ar') || to_tsvector('english', title->>'en')", select: false }) searchVector: string`. Query: `contentRepository.createQueryBuilder('c').where("c.searchVector @@ plainto_tsquery('arabic', :q)", { q }).orderBy('ts_rank_cd(c.searchVector, plainto_tsquery(:q))', 'DESC').getMany()`. |
| **Migrations (5 modules, 150+ tables at maturity)** | TypeORM CLI `migration:generate`, `migration:run`, `migration:revert` + manual SQL for complex operations | 80% of migrations auto-generated via `typeorm-ts-node-commonjs migration:generate`. 20% (RLS policies, PostGIS columns, custom indexes) hand-written as SQL via `queryRunner.query()`. DBA reviews ALL migrations. CI runs migration up + down against ephemeral PostgreSQL. Migration files named with timestamp + prefix: `1690000000001-CreateIdUsersTable.ts`. |
| **Read Replica Support (Phase 2)** | DataSource replication config: `{ master: {...}, slaves: [{...}] }` | Phase 2: Update DataSource config with read replica connection. TypeORM automatically routes `find*`, `createQueryBuilder().select()` queries to slave pool. WRITE operations (`INSERT/UPDATE/DELETE`) route to master. Zero code changes in repositories. |
| **Pagination + Filtering + Sparse Fields (JSON:API, ADR-004)** | `FindOptions` + `skip/take` + `where: {}` conditions + `select: []` sparse fields | Public content list controller uses: `contentRepository.find({ where: filterQueryBuilder.build(req.query.filter), order: sortParser.build(req.query.sort), skip: (pageNumber-1)*pageSize, take: pageSize, relations: includeParser.build(req.query.include), select: sparseFields.build(req.query.fields) })`. Single `find()` call covers 80% of list endpoints; remaining 20% use QueryBuilder. |

### 2.2 Concrete Actions

1. **NestJS Integration:** `@nestjs/typeorm` with globally imported `TypeOrmModule.forRootAsync()` config via ConfigService. 5 modules use `TypeOrmModule.forFeature([UserEntity, RoleEntity, ...])` per their entities. Single connection pool. No per-module DataSource instances.
2. **Folder Structure per Module (BC01 Identity example):**
```
identity/
  domain/
    repositories/
      user.repository.ts       (interface — no TypeORM imports)
    entities/
      user.entity.ts           (domain entity, plain class)
  application/
    services/
      user.service.ts          (depends on UserRepository interface)
  infrastructure/
    persistence/
      typeorm/
        entities/
          user.typeorm.entity.ts  (@Entity() decorator, extends or maps to domain)
        repositories/
          typeorm-user.repository.ts  (implements UserRepository interface)
      migrations/
        1690000000001-CreateIdUsersTable.ts
    controllers/
      v1/
        users.query.controller.ts
```
3. **Custom UUIDv7 Generator:** `UuidV7CustomGenerator` implements TypeORM `CustomGenerator` interface. Returns UUIDv7 bytes as string formatted. Registered globally in DataSource.
4. **RLS via Migrations:** Each module's first migration (after table creation) adds `ALTER TABLE id_users ENABLE ROW LEVEL SECURITY; CREATE POLICY id_users_module_policy ON id_users TO id_module_rw USING (true) WITH CHECK (true);`. RLS handled in SQL migrations, not in Entity metadata.
5. **Tree Entity for Categories:** `ct_categories` table uses Materialized Path Tree pattern. `@Tree('materialized-path')` + `mpath` column. LTree Postgres extension optionally enabled for path queries.
6. **CI Gates:** (a) Migration `generate` → review if SQL output matches intended schema; (b) `migration:run` against ephemeral PostgreSQL in GitHub Actions; (c) `migration:revert` back to zero confirms rollback works; (d) ArchUnit test ensures Domain layer classes do NOT import TypeORM packages.

---

## 3. Alternatives Considered

### Alternative A: Prisma 5.x

Schema-first with `schema.prisma`:
```prisma
model IdUser {
  id    String @id @db.Uuid
  email String @unique
  roles IdRole[]
}
```
Auto-generated PrismaClient with fully type-safe query builder. `prisma migrate` for migrations.

- ✅ **Pro:** **Zero boilerplate entities.** Schema written once in Prisma SDL; client fully generated. Type safety is PERFECT — queries return exactly typed shape you select. No runtime reflection errors.
- ✅ **Pro:** **JSONB + PostgreSQL types native.** `Unsupported("tsvector")` allows custom columns. Query builder supports `.arrayContains()` for JSONB.
- ✅ **Pro:** **Developer experience (DX) is BEST IN CLASS.** Autocomplete in VS Code; zero ORM "magic" surprises. Every generated method is in IntelliSense.
- ⚠️ **Pro:** Prisma Migrate auto-generation is reliable for simple cases. 80% of migrations correct out of box.
- ❌ **Con:** **NestJS integration is NOT FIRST-CLASS.** `@nestjs/prisma` community module OR custom `PrismaService`. No per-module injection like `TypeOrmModule.forFeature([...])`. Either one global `PrismaClient` (no per-module entity boundaries) OR multiple Prisma clients per module (multiple connection pools — terrible for performance on Hostinger VPS).
- ❌ **Con:** **Repository Pattern = MANUAL WORK.** Prisma Client is Active Record style. To implement Clean Architecture P-06 (Repository interfaces in Domain), you must wrap EVERY PrismaClient call in a custom repository class. 100 entities = 100 wrapper files. Prisma does NOT give you Repository classes for free. 2x more boilerplate than TypeORM.
- ❌ **Con:** **No Tree Entity support AT ALL.** BC02 Content categories (4-level tree, mobile home screen, admin category dropdown) — Prisma has no `@Tree` decorator, no `TreeRepository`, no `findDescendants()`, no `findAncestors()`. You must implement Materialized Path / Nested Set / Closure Table MANUALLY with raw SQL queries. Every tree traversal is a CTE query. Maintenance nightmare at depth 4+.
- ❌ **Con:** **Migrations for complex features (RLS, tsvector GENERATED STORED, PostGIS) = PRISMA ESCAPE HATCH.** Prisma Migrate's `--create-only` + hand-written SQL. But then the Prisma Schema and actual PostgreSQL schema diverge. TypeORM has `@Column({ generatedType: 'STORED', asExpression })` directly in Entity decorators. Prisma requires either `view` or unsupported type. Schema drift risk high.
- ❌ **Con:** **UUIDv7? NO native support.** Prisma `@default(uuid())` generates UUIDv4 only. UUIDv7 requires either (a) application-side generation and passing `id` on every create (forget → UUIDv4 default inserted, B-tree fragmentation), or (b) PostgreSQL trigger/function (extra moving parts, schema maintenance, drift from Prisma schema).
- ❌ **Con:** **No Custom Repository Classes integrated with NestJS DI.** TypeORM `@InjectRepository(User)` gives you a typed custom repository per entity. Prisma: inject `PrismaClient` everywhere, then call `prisma.idUser.findMany(...)`. Entities are strings in query; no compile-time check that "IdUser" table exists.
- ❌ **Con:** **Read Replicas? Prisma supports it (Preview).** But routing logic is coarse. TypeORM auto-routes SELECT → slave / WRITE → master. Prisma requires explicit `$transaction([...])` or query flags.
- ❌ **Con:** **Prisma Engine binary overhead.** Prisma runs a Rust-based Query Engine binary next to Node.js process. Extra 50-100MB RAM, extra process hop. On budget Hostinger VPS with 8-16GB shared with PostgreSQL + Redis + Nginx, this matters.

### Alternative B: Drizzle ORM

Schema-first with TypeScript schema files (`schema.ts` define tables as typed objects). Query builder is SQL-like thin wrapper. Zero runtime overhead. Lightweight migrations.

```ts
export const idUsers = pgTable('id_users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).unique(),
});
```

- ✅ **Pro:** **ZERO runtime overhead.** Queries compile to parameterized SQL strings + values at type-check time. No reflection, no Entity Metadata, no Query Builder parse overhead. PERFORMANCE is BEST: TypeORM +15-30% overhead vs raw, Prisma +30-50% overhead vs raw, Drizzle = +1-3% = nearly raw SQL.
- ✅ **Pro:** **SQL-LIKE query builder.** You write: `db.select().from(idUsers).where(eq(idUsers.email, email))`. Translates 1:1 with SQL. No magic. Predictable performance. No N+1 surprises. Full control.
- ✅ **Pro:** **PostgreSQL features support EXCELLENT.** JSONB, tsvector, LTree, UUID, custom types via `customType()`. UUIDv7 via custom type + `sql` function = no issues. RLS policies in migrations = no problem.
- ✅ **Pro:** **Migrations are LIGHTWEIGHT.** `drizzle-kit generate:pg` → SQL file you can review/edit by hand. No ORM "magic" in migrations. DBA loves this. Every migration is plain SQL.
- ✅ **Pro:** **Bundle size tiny.** No Entity metadata reflection. Serverless cold-start friendly (important if we extract to microservices later).
- ❌ **Con:** **NOT an ORM.** Drizzle is a "SQL BUILDER with schema types." There is NO Object-Relational Mapping concept. There are NO entities as classes. No Repository pattern = Repository interfaces return raw row objects (`SelectModel<typeof idUsers>`), not domain entity objects. You cannot have `class User { validatePassword() { ... } }` and map Drizzle rows to it without manual Mapper layer. 50 entities = 50 mapper classes. Clean Architecture P-06 (Domain objects ORM-agnostic) is awkward.
- ❌ **Con:** **NestJS DI integration is MANUAL.** No `@nestjs/drizzle` official package. You must write `DrizzleModule` with `DrizzleService` wrapper. No per-module registration of tables. Connection pool is global.
- ❌ **Con:** **NO Tree Entity support.** Content category tree (BC02) = hand-written recursive CTE queries with `sql` tag. 4 levels deep with pagination = brittle. TypeORM TreeRepository handles this out of the box.
- ❌ **Con:** **NO built-in relations find/loader.** Eager-loading relations (JSON:API `include=author,category`) → `leftJoin()` by hand for every include. TypeORM `find({ relations: ['author', 'category'] })` → joins generated automatically. With 5 include combinations × 50 endpoints = manual joins everywhere, N+1 risk high, code volume 2x.
- ❌ **Con:** **NO custom repository base class.** You build EVERY repository method from scratch using `db.select()`. TypeORM's `Repository<T>` base class gives you `find()`, `findOne()`, `save()`, `delete()`, `count()`, `createQueryBuilder()` all for free. You extend it with custom methods only for the 20% complex queries. Drizzle = 100% hand-written repository methods. 3x code volume.
- ❌ **Con:** **Team learning curve.** Pattern is unfamiliar to backend teams coming from NestJS/TypeORM standard. The "entities as plain TS objects, not classes" model is incompatible with DDD tactical patterns (Aggregate Root, Value Objects as methods on the entity class).
- ❌ **Con:** **Soft deletes, created_at, updated_at, Auditable columns = MANUAL.** TypeORM `@CreateDateColumn`, `@UpdateDateColumn`, `@DeleteDateColumn` built-in. Drizzle = schema + triggers + repository methods handle it.

### Alternative C: Knex.js Query Builder + Objection.js ORM

Knex = low-level SQL query builder; Objection.js = ORM on top of Knex with Model classes, relations, eager loading.

- ✅ **Pro:** **SQL control is TOTAL.** Knex query builder is explicit. Every SQL clause is visible. No ORM surprises. DBA-approved.
- ✅ **Pro:** **Objection.js Model relations are powerful.** `.withGraphFetched('author.category')` eager loads via efficient JOIN/partitioned queries, avoids N+1. JSON:API `include` = straightforward with graph expressions.
- ✅ **Pro:** **PostgreSQL JSONB features work via Knex raw SQL bindings.** tsvector, UUID all possible. Migration files are JS/TS with `knex.schema` methods → DBA reviewable.
- ❌ **Con:** **NestJS integration = 3rd party community packages.** `nestjs-objection` is NOT official; last major update 2023; 600 GitHub stars; small maintainer team. Bug risk for Phase 1 MVP (3 month timeline). If package goes unmaintained → fork or rewrite.
- ❌ **Con:** **Type safety WEAK vs Prisma/Drizzle/TypeORM.** Objection.js models use Joi or Zod for validation but query return types are `any` unless you manually type EVERY query. TypeORM with strict mode = typed returns. Prisma/Drizzle = FULL type inference from schema. Knex/Objection = types optional.
- ❌ **Con:** **No built-in UUIDv7 generator.** Same problem as Prisma; must implement in-app or DB trigger.
- ❌ **Con:** **Tree entities? NO built-in.** No `TreeRepository`. Content categories = CTE hand-rolled with Knex raw.
- ❌ **Con:** **Migration tooling basic vs TypeORM/Prisma.** Auto-migration generation does not exist. All migrations hand-written via `knex.schema.createTable(...)`. For 150+ tables this is SLOW MVP.
- ❌ **Con:** **Smaller ecosystem.** Stack Overflow answers 10x fewer than TypeORM. NestJS examples rare. New developer onboarding slower.

### Alternative D: TypeORM 0.3.x (Chosen Decision)

- ✅ **Pro:** **NestJS OFFICIAL first-class integration.** `@nestjs/typeorm` maintained by NestJS core team. 10M+ downloads/month. Stable. `TypeOrmModule.forFeature([Entity])` per module = clean ownership boundaries. Single connection pool via `forRoot`.
- ✅ **Pro:** **Repository Pattern out-of-the-box (Clean Architecture P-06).** Extend `Repository<User>` → injectable via `@InjectRepository(User)`. Repository interface in Domain (`UserRepository`) + TypeORM custom repository in Infrastructure (`extends Repository<User> implements UserRepository`). Perfect Persistence Ignorance. Dependencies point INWARD.
- ✅ **Pro:** **Tree Entities BUILT-IN.** `@Tree('materialized-path')` / `@Tree('nested-set')` / `@Tree('closure-table')`. `TreeRepository<T>` with `findDescendants()`, `findAncestors()`, `findTrees()`. Content category page rendering = one method call. NO CTEs. NO manual joins.
- ✅ **Pro:** **UUIDv7 support EASY.** Custom `CustomGenerator` registered globally. Entity definition declares primary column. No app-level ID passing on every create.
- ✅ **Pro:** **JSONB + tsvector + PostgreSQL features FIRST-CLASS.** `@Column({ type: 'jsonb' })`, `@Index({ using: 'gin' })`, generated STORED columns via column metadata, `@CreateDateColumn({ type: 'timestamptz' })`, `@UpdateDateColumn`, `@DeleteDateColumn` soft deletes.
- ✅ **Pro:** **Query Builder + FindOptions = 80/20 sweet spot.** Simple list queries use `find({ where, order, skip, take, relations, select })` = no code. Complex queries (BC05 Analytics dashboards) use `createQueryBuilder()` with raw SQL snippets. 80% of queries = zero boilerplate. 20% complex = explicit control.
- ✅ **Pro:** **Migrations auto-generate 80% correctly.** `typeorm migration:generate` detects entity changes. RLS, PostGIS, custom indexes = hand-written SQL via `queryRunner.query()`. DBA reviews both auto and manual.
- ✅ **Pro:** **Read replica routing AUTOMATIC.** DataSource replication config → SELECTs → slave, WRITEs → master. No code changes.
- ✅ **Pro:** **Ecosystem MASSIVE.** 30M+ downloads/month. Every NestJS tutorial uses it. Stack Overflow answers for every edge case. New BKE engineer productive in <1 day.
- ⚠️ **Trade-off:** Some runtime overhead vs raw/Drizzle. TypeORM metadata reflection + Query Builder parse = +15-30% vs raw SQL. **Mitigation:** (a) Redis caching of hot reads (80% workload); (b) complex analytics queries use Query Builder with `.select()` raw SQL where needed; (c) PgBouncer + connection pool optimized; (d) NestJS interceptors cache at HTTP level for JSON:API GETs. For Phase 1 load (1,000–5,000 users in the first 6 months), performance is MORE than acceptable, with ample headroom as the user base grows.
- ⚠️ **Trade-off:** Auto-generated migrations sometimes are suboptimal (wrong index order, missing IF NOT EXISTS, etc.). **Mitigation:** DBA reviews ALL migration output SQL. CI runs migration up + down test against ephemeral PostgreSQL. Hand-correct any suboptimal statements before commit.
- ⚠️ **Trade-off:** Some "magic" in FindOptions relations — eager-loading bugs possible if relations chain depth >2. **Mitigation:** Architecture unit test forbids relations depth >2. JSON:API `include` maximum 2 levels. For complex joins, use QueryBuilder explicitly.

---

## 4. Trade-off Analysis Summary Table

| Criterion | Prisma 5.x | Drizzle ORM | Knex + Objection.js | TypeORM 0.3.x ✅ CHOSEN |
|-----------|------------|-------------|---------------------|--------------------------|
| **NestJS Integration Quality** | ❌ Community, poor | ❌ Manual wrapper | ❌ 3rd party (risk) | ✅ OFFICIAL `@nestjs/typeorm` |
| **Clean Arch Repository P-06** | ❌ Manual wrapping (2x code) | ❌ No ORM (3x mapper code) | ⚠️ Custom classes | ✅ Native Repository pattern |
| **Tree Entity Categories (BC02)** | ❌ Manual CTEs only | ❌ Manual CTEs only | ❌ Manual CTEs only | ✅ `@Tree()` + `TreeRepository` built-in |
| **UUIDv7 Support** | ❌ v4 default; custom workarounds | ✅ Custom type trivial | ⚠️ Manual implementation | ✅ Custom Generator, easy |
| **tsvector JSONB GIN Indexing** | ⚠️ Unsupported escape hatch | ✅ Native schema types | ✅ Knex raw bindings | ✅ Entity metadata declares directly |
| **Migrations Auto-Generate Reliability** | ✅ Prisma Migrate (good for 80%) | ⚠️ Generate SQL, hand-review | ❌ 100% hand-written | ✅ CLI generate, DBA-reviewed (best) |
| **JSON:API include + relations eager-load** | ⚠️ `.include()` = good | ❌ Manual leftJoin EVERY query | ✅ `.withGraphFetched()` powerful | ✅ `relations: []` in FindOptions (simplest) |
| **Type Safety Query Returns** | ✅ BEST (generated client) | ✅ Excellent (schema types) | ❌ Weak (any-based) | ✅ Good (strict mode + generics) |
| **Performance (vs raw SQL overhead)** | ❌ +30-50% (Rust engine hop) | ✅ +1-3% (best) | ⚠️ +10-20% | ⚠️ +15-30% (mitigated by caching) |
| **Team Learning Curve (NestJS-standard)** | ⚠️ New paradigm | ❌ SQL-builder unfamiliar | ⚠️ Medium (non-standard) | ✅ Best — de facto standard |
| **Soft-Deletes / Audit Columns Built-in** | ⚠️ `deletedAt` manual handling | ❌ All manual | ❌ All manual | ✅ `@DeleteDateColumn` + 2 more built-in |
| **Ecosystem / Docs / StackOverflow** | ✅ Large & growing | ⚠️ Fast growing but small | ❌ Small, stagnant | ✅ Largest (30M+ downloads) |
| **MVP Speed / Code Volume** | ⚠️ Schema SDL faster initially; repo wrappers add time | ❌ Slowest (100% hand-written) | ❌ Slowest migrations | ✅ Fastest: 80% auto-generated |
| **Phase 2 Read Replica Routing** | ⚠️ Preview feature, coarse | ❌ Manual | ❌ Manual | ✅ Automatic, zero code change |
| **Charter Alignment (Clean Arch + DDD tactical)** | ⚠️ Active Record anti-DDD | ❌ No domain classes (DDD awkward) | ⚠️ Possible but non-standard | ✅ Designed for DDD tactical patterns |

---

## 5. Consequences

### Positive Outcomes (what we gain)
1. **MVP ships in shortest time.** NestJS + TypeORM = every backend tutorial. 80% of Repository methods (CRUD, list, filter, paginate) are FREE via base `Repository<T>` class. Only 20% complex queries custom.
2. **Clean Architecture P-06 (Persistence Ignorance) implemented natively.** Domain `UserRepository` interface = zero TypeORM imports. Infrastructure `TypeOrmUserRepository extends Repository<User> implements UserRepository` = one `@InjectRepository(User)` line. Dependencies point inward. DDD tactical patterns (Aggregate Root methods on domain entity class) work perfectly.
3. **Content categories tree trivial.** `findTrees()` renders the entire 4-level category tree for Admin dropdown. `findDescendants(categoryId)` renders child sub-categories for mobile home page. One method call, zero CTEs, zero SQL. Months of saved work.
4. **5 modules × 30 entities = clean ownership.** `TypeOrmModule.forFeature([...])` per Bounded Context. Entity files owned by module. Migration files owned by module. Cross-prefix access (ADR-002) is visible in Entity imports.
5. **Phase 2 read replicas = ONE config file change.** Update `data-source.ts` with slave host. SELECT queries auto-route. Zero repository code touched.
6. **Largest ecosystem.** 30M+ downloads. Every Stack Overflow question has TypeORM answer. New BKE engineer productive within a day. Minimal onboarding cost.

### Negative Outcomes / Trade-offs (what we accept, with mitigations)
1. **15-30% query overhead vs raw SQL.** **Mitigation:** (a) Redis HTTP response caching for hot GET endpoints (CDN first, Redis second); (b) complex BC05 analytics queries use QueryBuilder with `.select('raw sql')` for critical paths; (c) TypeORM `skip take` pagination + JSON:API sparse fields reduce payload sizes and transferred columns; (d) indexing plan per DBA review eliminates slow queries before launch.
2. **Auto-generated migrations need DBA review.** TypeORM sometimes generates `ALTER COLUMN` with unnecessary drop+recreate. Sometimes adds redundant indexes. **Mitigation:** (a) `migration:generate` output SQL file inspected by DBA line-by-line; (b) CI runs both up and down migration against fresh ephemeral PostgreSQL, validates all tables exist after up, zero tables remain after down; (c) complex DDL (RLS, GIN on JSONB, PostGIS) hand-written with `queryRunner.query()` by DBA anyway.
3. **FindOptions "magic" can produce inefficient queries.** `relations: ['author.posts.comments']` at depth 3 = Cartesian product. **Mitigation:** (a) Architecture unit test forbids relations depth >2; (b) JSON:API `include` parameter limited to 2 levels in Pipes; (c) for complex nested queries use `createQueryBuilder().leftJoinAndSelect()` with explicit control.

### Neutral / Unknown (risks to monitor)
1. **TypeORM 0.4.x / 1.0 migration path.** TypeORM 0.3.x is stable. 1.0 roadmap has breaking changes (metadata system rewrite). **Risk mitigation:** Pin TypeORM to `~0.3.20`. Lock patch version. CSA evaluates 1.0 upgrade after MVP stabilizes.
2. **Will custom UUIDv7 generator work correctly?** Custom generator classes are TypeORM 0.3.x feature — documented, tested, works in sample projects. We will write a unit test that generates 10,000 UUIDs, validates UUIDv7 format (version bits 7, variant bits RFC 9562), and confirms sort order by `createdAt` matches UUID order (time-ordered property holds).
3. **Tree entity materialized path vs closure table for categories.** Materialized path is simpler for 4 levels. If categories grow to 10+ levels (unlikely for the current content taxonomy), we re-evaluate closure table or LTree PostgreSQL extension. Migration path possible via new migration (add closure table, backfill data, switch `@Tree()` decorator type).

---

## 6. Reversal / Exit Criteria (When to Revisit This Decision)

This decision is revisited **only** when:

1. **TRIGGER 1 (Performance Cliff):** PFE profiling shows TypeORM Query Builder / FindOptions overhead accounts for >25% of total P99 API latency for 30 consecutive days, AND query-level optimization (indexes, caching) only reduces overhead by <10%.
   - **Action:** CSA evaluates migration of the 3-5 hottest query endpoints only to Drizzle ORM (query builder side-by-side with TypeORM) via custom repository methods. TypeORM remains for 95% of operations. NOT full rewrite.

2. **TRIGGER 2 (Migration Failure in Production):** A TypeORM auto-generated migration causes a production data loss incident (RPO exceeded >1hr) AND post-incident analysis identifies TypeORM migration generator as ROOT CAUSE (not DBA review process error).
   - **Action:** Switch migration generation to 100% hand-written SQL (Drizzle-style review). TypeORM entities remain for runtime; migration CLI abandoned. ORM NOT replaced.

3. **TRIGGER 3 (Team Resignation / Knowledge Gap):** The sole BKE expert with TypeORM knowledge leaves the project AND replacement hiring shows >80% of qualified candidates prefer Prisma/Drizzle for 3 consecutive months.
   - **Action:** CSA evaluates. Migration to Prisma is 6-8 week effort for 5 modules (entities → Prisma SDL + repository wrappers). Only done if knowledge gap risk exceeds migration cost.

4. **TRIGGER 4 (NestJS Breaking Change):** NestJS 11+ drops `@nestjs/typeorm` as official package (unlikely given historical precedent but possible if Kamil Mysliwiec pivots).
   - **Action:** Evaluate community forks OR migrate to officially recommended alternative. Entities + Repository interfaces mostly preserved.

We **explicitly do NOT revisit** this decision:
- Because "Prisma has better DX" or hype arguments without performance data
- Because individual developers prefer SQL builders (Class C decision, not Class A)
- Before MVP production launch and 3 months of production profiling
- Without CSA + BKE + DBA sign-off and quantitative evidence justifying the switch

---

## 7. Links & References

- [PROJECT_CHARTER.md](../../PROJECT_CHARTER.md) §3.1 Scope (NestJS, PostgreSQL 16, TypeORM migrations implied), §2.1 Objective 003 (P99 <200ms), §8 Technical Risks
- [ARCHITECTURE_VISION.md](../ARCHITECTURE_VISION.md) §2.1 P-01 (Clean Arch Domain-Centric), §2.1 P-06 (Persistence Ignorance)
- [TECHNICAL_GOVERNANCE.md](../../governance/TECHNICAL_GOVERNANCE.md) §2.1 Account 02 BKE (Backend NestJS owner), §3.1 Class A Architectural Decision
- [ADR-001 Architecture Pattern — Modular Monolith](ADR-001-architecture-pattern-modular-monolith.md) §2 (4-layer Clean Architecture per module)
- [ADR-002 Bounded Context Map](ADR-002-bounded-context-map-5-modules.md) §2.4 Table Prefix Convention (enforced via Entity @Entity({ name: 'prefix_' }))
- [ADR-004 API Style REST JSON:API](ADR-004-api-style-rest-json-api.md) §2.1 (FindOptions map 1:1 to JSON:API filter/sort/include/pagination params)
- [ADR-005 Primary Database PostgreSQL 16](ADR-005-primary-database-postgresql-16.md) §2 (UUIDv7, JSONB, tsvector, RLS, PostGIS, Read Replica all used via TypeORM)
- External: TypeORM 0.3.x Documentation (typeorm.io) — Repository Pattern, Tree Entities, Migrations, Query Builder, UUID Custom Generators
- External: NestJS Official Docs — Database (TypeORM Section) — `@nestjs/typeorm` integration patterns
- External: Clean Architecture by Robert C. Martin — Repository Pattern, Persistence Ignorance
- External: Domain-Driven Design Reference (Evans) — Aggregates, Repositories as domain services with persistence-agnostic interfaces

---

*Decision Log:*
- 2026-08-07: PROPOSED — Drafted by Chief Software Architect. 4-candidate comparison; feature-requirement matrix; 4 reversal triggers. Sent for Sponsor + BKE + DBA review.
- 2026-08-09: ACCEPTED — Signed by Project Sponsor as part of the Phase 0 consolidation pass. Confirmed TypeORM 0.3.x; aligned Phase 1 load framing (1,000–5,000 users first 6 months); relative doc links; removed out-of-scope "courses" reference.
