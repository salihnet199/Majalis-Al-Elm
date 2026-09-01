/**
 * AdminContentController read endpoints — integration test against a REAL Postgres.
 *
 * `GET /admin/content` and `GET /admin/content/:id` exist because the admin UI was
 * reading the PUBLIC catalogue: drafts were invisible, `total` was absent, and the
 * search box and status filter were sent to an endpoint that ignores them. The new
 * list is hand-written SQL over a QueryBuilder — an ILIKE search that reaches into
 * `ct_translations`, an enum-typed status comparison, `skip`/`take` paging and a
 * `deleted_at IS NULL` guard.
 *
 * None of that can be verified against a mocked repository. A fake QueryBuilder
 * would happily accept a misspelled column, an enum/text type mismatch, or a
 * subquery against a table that does not exist, and would report green — proving
 * only that the fake agrees with itself. So this suite runs the controller against
 * the real schema, over real SQL, and asserts on rows Postgres actually returned.
 *
 * ── Not part of the default test run ────────────────────────────────────────
 * `jest.config.cts` excludes `*.pg.integration.spec.ts`. Run it deliberately:
 *
 *     docker compose --env-file .env.local up -d postgres
 *     npx nx run backend:test-db
 *
 * ── It fails; it never skips ─────────────────────────────────────────────────
 * With no database reachable, every test here FAILS with a diagnosis. It does not
 * `it.skip` and it does not pass with a warning: a suite whose purpose is to prove
 * the SQL runs, and which goes green without ever reaching Postgres, is
 * POLICY-SEC-001 category 4 (fabricated readiness).
 *
 * ── What it writes ──────────────────────────────────────────────────────────
 * Its own rows only, all carrying the `pgit-` slug prefix, all deleted in
 * `afterAll` — plus a pre-emptive delete of that prefix in `beforeAll` so an
 * interrupted run cannot poison the next one. It never touches rows it did not
 * create.
 */

import { INestApplication, ValidationPipe, ExecutionContext, CanActivate } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import request = require('supertest');
import { randomUUID } from 'crypto';

import { AdminContentController } from './admin-content.controller';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { CONTENT_ITEM_REPOSITORY } from '../domain/ports/content-item.repository';
import { TypeOrmContentItemRepository } from '../infrastructure/persistence/typeorm-content-item.repository';
import { ContentItemOrmEntity } from '../infrastructure/persistence/entities/content-item.orm-entity';
import { TranslationOrmEntity } from '../infrastructure/persistence/entities/translation.orm-entity';
import { CategoryOrmEntity } from '../infrastructure/persistence/entities/category.orm-entity';
import { AuthorOrmEntity } from '../infrastructure/persistence/entities/author.orm-entity';
import { TagOrmEntity } from '../infrastructure/persistence/entities/tag.orm-entity';
import { MediaAssetOrmEntity } from '../infrastructure/persistence/entities/media-asset.orm-entity';
import { GlobalExceptionFilter } from '../../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../../shared/presentation/interceptors/trace-id.interceptor';
import { envReader } from '../../../testing/env-local';

const env = envReader();

const SETUP_HINT =
  '\n\nThis suite requires a running, migrated Postgres:\n' +
  '  docker compose --env-file .env.local up -d postgres\n' +
  '  (schema from apps/backend/migrations/*.sql)\n';

const DB = {
  host: env('DATABASE_HOST', 'localhost') as string,
  port: Number(env('DATABASE_PORT', '5432')),
  database: env('DATABASE_NAME'),
  username: env('DATABASE_USER'),
  password: env('DATABASE_PASSWORD'),
};

/** Everything this suite creates is prefixed, so cleanup can be exact. */
const PREFIX = 'pgit-admin-read';

/**
 * The guards are replaced, and only the guards.
 *
 * RBAC has its own coverage in content.integration.spec.ts against real tokens;
 * what is under test here is SQL. Signing tokens would require RS256 keys on the
 * machine and would add a way for this suite to fail for reasons unrelated to the
 * database. The actor id is still injected, because the controller refuses to
 * write without one (require-actor-id.ts).
 */
class StubAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { sub: actorUserId, email: 'editor@pgit.local', role: 'Editor', sessionId: randomUUID() };
    return true;
  }
}

let actorUserId: string;

describe('AdminContentController read endpoints — real Postgres (admin projection)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let categoryId: string;
  let authorId: string;

  const ids: Record<string, string> = {};

  /** Inserts a content item plus its title translations. */
  async function seedItem(options: {
    key: string;
    slug: string;
    type: 'AUDIO' | 'PDF' | 'TEXT' | 'IMAGE';
    status: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    primaryLocale?: string;
    titles?: Record<string, string>;
    categoryId?: string | null;
    authorId?: string | null;
    deleted?: boolean;
    updatedAt?: string;
  }) {
    const id = randomUUID();
    ids[options.key] = id;
    const primaryLocale = options.primaryLocale ?? 'ar';

    await dataSource.query(
      `INSERT INTO ct_content_items
         (id, slug, type, status, primary_locale, author_id, category_id,
          created_by, published_at, deleted_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        id,
        options.slug,
        options.type,
        options.status,
        primaryLocale,
        options.authorId ?? null,
        options.categoryId ?? null,
        actorUserId,
        // chk_ct_items_published: PUBLISHED demands a published_at.
        options.status === 'PUBLISHED' ? new Date().toISOString() : null,
        options.deleted ? new Date().toISOString() : null,
        options.updatedAt ?? new Date().toISOString(),
      ],
    );

    for (const [locale, title] of Object.entries(options.titles ?? {})) {
      await dataSource.query(
        `INSERT INTO ct_translations (id, entity_type, entity_id, locale, field_name, content, created_by)
         VALUES ($1, 'content_item', $2, $3, 'title', $4, $5)`,
        [randomUUID(), id, locale, title, actorUserId],
      );
    }

    return id;
  }

  /** Removes every row this suite's prefix owns, in FK-safe order. */
  async function purge(ds: DataSource) {
    await ds.query(
      `DELETE FROM ct_translations
        WHERE entity_type = 'content_item'
          AND entity_id IN (SELECT id FROM ct_content_items WHERE slug LIKE $1)`,
      [`${PREFIX}%`],
    );
    await ds.query(`DELETE FROM ct_content_items WHERE slug LIKE $1`, [`${PREFIX}%`]);
    await ds.query(
      `DELETE FROM ct_translations WHERE entity_type IN ('category', 'author')
         AND entity_id IN (
           SELECT id FROM ct_categories WHERE slug LIKE $1
           UNION SELECT id FROM ct_authors WHERE slug LIKE $1
         )`,
      [`${PREFIX}%`],
    );
    await ds.query(`DELETE FROM ct_categories WHERE slug LIKE $1`, [`${PREFIX}%`]);
    await ds.query(`DELETE FROM ct_authors WHERE slug LIKE $1`, [`${PREFIX}%`]);
    await ds.query(`DELETE FROM id_users WHERE email LIKE $1`, [`${PREFIX}%`]);
  }

  beforeAll(async () => {
    if (!DB.database || !DB.username || !DB.password) {
      throw new Error(
        'DATABASE_NAME / DATABASE_USER / DATABASE_PASSWORD are not set, so this suite ' +
          'cannot reach a database. Refusing to run: a SQL integration test that passes ' +
          'without a database proves nothing.' +
          SETUP_HINT,
      );
    }

    process.env.NODE_ENV = 'test';

    const entities = [
      ContentItemOrmEntity,
      TranslationOrmEntity,
      CategoryOrmEntity,
      AuthorOrmEntity,
      TagOrmEntity,
      MediaAssetOrmEntity,
    ];

    let moduleFixture: TestingModule;
    try {
      moduleFixture = await Test.createTestingModule({
        imports: [
          TypeOrmModule.forRoot({
            type: 'postgres',
            host: DB.host,
            port: DB.port,
            database: DB.database,
            username: DB.username,
            password: DB.password,
            entities,
            // The schema comes from migrations/*.sql. Synchronize would rewrite a
            // developer's database to match the ORM's guesses.
            synchronize: false,
            logging: false,
          }),
          TypeOrmModule.forFeature(entities),
        ],
        controllers: [AdminContentController],
        providers: [
          { provide: CONTENT_ITEM_REPOSITORY, useClass: TypeOrmContentItemRepository },
        ],
      })
        .overrideGuard(JwtAuthGuard)
        .useClass(StubAuthGuard)
        .overrideGuard(RolesGuard)
        .useClass(StubAuthGuard)
        .compile();
    } catch (error) {
      throw new Error(
        `Could not connect to Postgres at ${DB.host}:${DB.port}/${DB.database} — ` +
          `${(error as Error).message}${SETUP_HINT}`,
      );
    }

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());
    await app.init();

    dataSource = moduleFixture.get(DataSource);

    // A previous interrupted run must not leak into this one.
    await purge(dataSource);

    // created_by is NOT NULL REFERENCES id_users(id) — the actor has to be real.
    actorUserId = randomUUID();
    await dataSource.query(
      `INSERT INTO id_users (id, full_name, email) VALUES ($1, $2, $3)`,
      [actorUserId, 'PG Integration Editor', `${PREFIX}-editor@example.test`],
    );

    categoryId = randomUUID();
    await dataSource.query(`INSERT INTO ct_categories (id, slug) VALUES ($1, $2)`, [
      categoryId,
      `${PREFIX}-fiqh`,
    ]);

    authorId = randomUUID();
    await dataSource.query(`INSERT INTO ct_authors (id, slug) VALUES ($1, $2)`, [
      authorId,
      `${PREFIX}-shaykh`,
    ]);

    // Four visible items in four states, one soft-deleted, one with no Arabic
    // title, one whose Arabic title exists only as a non-primary translation.
    await seedItem({
      key: 'draft',
      slug: `${PREFIX}-draft-audio`,
      type: 'AUDIO',
      status: 'DRAFT',
      titles: { ar: 'شرح كتاب التوحيد — الدرس الأول' },
      categoryId,
      authorId,
      updatedAt: '2026-08-20T10:00:00.000Z',
    });
    await seedItem({
      key: 'review',
      slug: `${PREFIX}-review-pdf`,
      type: 'PDF',
      status: 'REVIEW',
      titles: { ar: 'الأصول الثلاثة — نسخة مراجعة' },
      updatedAt: '2026-08-21T10:00:00.000Z',
    });
    await seedItem({
      key: 'published',
      slug: `${PREFIX}-published-text`,
      type: 'TEXT',
      status: 'PUBLISHED',
      primaryLocale: 'en',
      // Primary locale is English; the Arabic title is the secondary translation.
      titles: { en: 'On Patience', ar: 'منزلة الصبر' },
      updatedAt: '2026-08-22T10:00:00.000Z',
    });
    await seedItem({
      key: 'untitled',
      slug: `${PREFIX}-untitled-image`,
      type: 'IMAGE',
      status: 'DRAFT',
      titles: {},
      updatedAt: '2026-08-19T10:00:00.000Z',
    });
    await seedItem({
      key: 'deleted',
      slug: `${PREFIX}-deleted-audio`,
      type: 'AUDIO',
      status: 'PUBLISHED',
      titles: { ar: 'مادة محذوفة' },
      deleted: true,
      updatedAt: '2026-08-23T10:00:00.000Z',
    });
  }, 60_000);

  afterAll(async () => {
    if (dataSource?.isInitialized) await purge(dataSource);
    if (app) await app.close();
  });

  /** The suite's own rows, isolated from whatever else the dev database holds. */
  const listOurs = async (query = '') => {
    const res = await request(app.getHttpServer())
      .get(`/admin/content?search=${PREFIX}${query}`)
      .expect(200);
    return res.body;
  };

  // ── The list ───────────────────────────────────────────────────────────────

  it('returns items in every status, including the drafts the public endpoint hides', async () => {
    const body = await listOurs();
    const bySlug = new Map<string, any>(body.data.map((row: any) => [row.slug, row]));

    expect(bySlug.get(`${PREFIX}-draft-audio`)?.status).toBe('DRAFT');
    expect(bySlug.get(`${PREFIX}-review-pdf`)?.status).toBe('REVIEW');
    expect(bySlug.get(`${PREFIX}-published-text`)?.status).toBe('PUBLISHED');
    // A draft an editor just created is the case that used to vanish entirely.
    expect(bySlug.has(`${PREFIX}-untitled-image`)).toBe(true);
  });

  it('excludes soft-deleted items', async () => {
    const body = await listOurs();
    expect(body.data.map((r: any) => r.slug)).not.toContain(`${PREFIX}-deleted-audio`);
    expect(body.meta.total).toBe(4);
  });

  it('carries the ids the edit form needs, which the public shape omits', async () => {
    const body = await listOurs();
    const row = body.data.find((r: any) => r.slug === `${PREFIX}-draft-audio`);

    expect(row.categoryId).toBe(categoryId);
    expect(row.authorId).toBe(authorId);
    expect(row).toHaveProperty('mediaAssetId', null);
    // bigint arrives from pg as a string; the endpoint converts it, because the
    // client does arithmetic with it.
    expect(typeof row.viewCount).toBe('number');
    expect(row.viewCount).toBe(0);
  });

  it('reports a real total and honours page/limit', async () => {
    const first = await listOurs('&page=1&limit=2');
    expect(first.data).toHaveLength(2);
    expect(first.meta).toMatchObject({ page: 1, limit: 2, total: 4, totalPages: 2 });

    const second = await listOurs('&page=2&limit=2');
    expect(second.data).toHaveLength(2);
    expect(second.meta.page).toBe(2);

    // Real paging: page 2 is a different set, not page 1 again — which is what the
    // cursor-paginated public endpoint returned for every page number.
    const firstSlugs = first.data.map((r: any) => r.slug);
    const secondSlugs = second.data.map((r: any) => r.slug);
    expect(firstSlugs.some((s: string) => secondSlugs.includes(s))).toBe(false);

    // Ordered by updatedAt DESC across pages.
    expect(firstSlugs[0]).toBe(`${PREFIX}-published-text`);
    expect(secondSlugs[secondSlugs.length - 1]).toBe(`${PREFIX}-untitled-image`);
  });

  it('resolves the title in the requested locale, then the primary locale', async () => {
    const ar = await listOurs('&locale=ar');
    const en = await listOurs('&locale=en');

    const arRow = ar.data.find((r: any) => r.slug === `${PREFIX}-published-text`);
    const enRow = en.data.find((r: any) => r.slug === `${PREFIX}-published-text`);
    expect(arRow.title).toBe('منزلة الصبر');
    expect(enRow.title).toBe('On Patience');

    // Requested locale missing, primary locale used instead.
    const frRow = (await listOurs('&locale=fr')).data.find(
      (r: any) => r.slug === `${PREFIX}-published-text`,
    );
    expect(frRow.title).toBe('On Patience');
  });

  it('returns null — never the slug — for an item with no title translation', async () => {
    const row = (await listOurs()).data.find((r: any) => r.slug === `${PREFIX}-untitled-image`);
    // A slug in the title column reads as a title someone typed.
    expect(row.title).toBeNull();
  });

  it('filters by status, and by type', async () => {
    const drafts = await listOurs('&status=DRAFT');
    expect(drafts.data.map((r: any) => r.slug).sort()).toEqual(
      [`${PREFIX}-draft-audio`, `${PREFIX}-untitled-image`].sort(),
    );
    expect(drafts.meta.total).toBe(2);

    const review = await listOurs('&status=REVIEW');
    expect(review.data).toHaveLength(1);
    expect(review.data[0].slug).toBe(`${PREFIX}-review-pdf`);

    const pdfs = await listOurs('&type=PDF');
    expect(pdfs.data).toHaveLength(1);
    expect(pdfs.data[0].type).toBe('PDF');
  });

  it('rejects an unknown status filter instead of silently returning everything', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/content?status=PENDING_APPROVAL')
      .expect(422);

    expect(res.body.error.code).toBe('UNPROCESSABLE');
    expect(res.body.error.message).toContain('PENDING_APPROVAL');
    expect(res.body.error.trace_id).toBeDefined();
  });

  it('rejects an unknown type filter', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/content?type=VIDEO')
      .expect(422);

    expect(res.body.error.code).toBe('UNPROCESSABLE');
    // Video is out of scope for the platform; the filter must not read as accepted.
    expect(res.body.error.message).toContain('VIDEO');
  });

  it('searches the slug', async () => {
    const body = await listOurs('-review');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].slug).toBe(`${PREFIX}-review-pdf`);
  });

  it('searches translated titles in any locale, not only the primary one', async () => {
    // "منزلة الصبر" is the ar translation of an item whose primary locale is en.
    const res = await request(app.getHttpServer())
      .get(`/admin/content?search=${encodeURIComponent('منزلة الصبر')}`)
      .expect(200);

    expect(res.body.data.map((r: any) => r.slug)).toContain(`${PREFIX}-published-text`);
  });

  it('matches titles case-insensitively and on a partial word (ILIKE)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/content?search=on%20pati')
      .expect(200);

    expect(res.body.data.map((r: any) => r.slug)).toContain(`${PREFIX}-published-text`);
  });

  it('returns an empty page with total 0 for a search that matches nothing', async () => {
    const body = await listOurs('-no-such-thing');
    expect(body.data).toEqual([]);
    expect(body.meta.total).toBe(0);
    expect(body.meta.totalPages).toBe(0);
  });

  it('clamps limit to 100 rather than letting a client ask for the whole table', async () => {
    const body = await listOurs('&limit=5000');
    expect(body.meta.limit).toBe(100);
  });

  // ── The detail ─────────────────────────────────────────────────────────────

  it('returns one item by id with its real ids and stored translations', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/content/${ids['published']}`)
      .expect(200);

    const data = res.body.data;
    expect(data.id).toBe(ids['published']);
    expect(data.slug).toBe(`${PREFIX}-published-text`);
    expect(data.status).toBe('PUBLISHED');
    expect(data.primaryLocale).toBe('en');
    expect(data.mediaAssetId).toBeNull();

    const locales = data.translations.map((t: any) => t.locale).sort();
    expect(locales).toEqual(['ar', 'en']);
    const arabic = data.translations.find((t: any) => t.locale === 'ar');
    expect(arabic).toEqual({ locale: 'ar', title: 'منزلة الصبر', description: null, body: null });
  });

  it('serves a DRAFT by id — the state the public endpoint refuses to show', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/content/${ids['draft']}`)
      .expect(200);

    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.categoryId).toBe(categoryId);
    expect(res.body.data.authorId).toBe(authorId);
  });

  it('returns an empty translations array, not a fabricated one, when none exist', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/content/${ids['untitled']}`)
      .expect(200);

    expect(res.body.data.translations).toEqual([]);
  });

  it('answers 404 for an id that does not exist', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/content/${randomUUID()}`)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers 404 for a soft-deleted item', async () => {
    const res = await request(app.getHttpServer())
      .get(`/admin/content/${ids['deleted']}`)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
