/**
 * POLICY-SEC-001 category 1 — fabricated identity. Regression suite.
 *
 * Seven admin write handlers used to open with:
 *
 *     const userId = req.user?.sub || '00000000-0000-7000-8000-000000000000';
 *
 * A request that reached any of them without an authenticated principal was
 * therefore attributed to a user that does not exist — the content item, the
 * category, the author, the tag, and every translation row underneath. The audit
 * trail named the same forged id for every such write, so the forgeries were
 * indistinguishable from one another and from a real editor.
 *
 * `requireActorId` (require-actor-id.ts) replaced all seven with a 401. This suite
 * exists because a unit test on that helper would prove almost nothing: the
 * fabrication was never in a shared function, it was seven copies of one line, and
 * the failure mode to guard against is a handler that stops calling the helper —
 * or a new handler that never starts. So every call site is exercised through the
 * real HTTP stack:
 *
 *   1. with a principal carrying no `sub`  → 401 UNAUTHENTICATED, nothing written
 *   2. with a real `sub`                    → the write proceeds, and the id
 *                                             recorded is that principal's
 *
 * The second half matters as much as the first. Without it, a fixture that broke
 * every request for an unrelated reason would still show seven green 401s.
 */

import { INestApplication, ValidationPipe, ExecutionContext, CanActivate } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { randomUUID } from 'crypto';

import { AdminContentController } from './admin-content.controller';
import { AdminTaxonomyController } from './admin-taxonomy.controller';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { CONTENT_ITEM_REPOSITORY } from '../domain/ports/content-item.repository';
import { CATEGORY_REPOSITORY } from '../domain/ports/category.repository';
import { AUTHOR_REPOSITORY } from '../domain/ports/author.repository';
import { TAG_REPOSITORY } from '../domain/ports/tag.repository';
import { TranslationOrmEntity } from '../infrastructure/persistence/entities/translation.orm-entity';
import { ContentItemOrmEntity } from '../infrastructure/persistence/entities/content-item.orm-entity';
import { TagOrmEntity } from '../infrastructure/persistence/entities/tag.orm-entity';
import { GlobalExceptionFilter } from '../../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../../shared/presentation/interceptors/trace-id.interceptor';

/**
 * The id the old fallback invented. It must never appear in a write again, so it
 * is asserted against by value rather than described in a comment.
 */
const FABRICATED_ID = '00000000-0000-7000-8000-000000000000';

const REAL_ACTOR = '018d0000-0000-7000-8000-00000000aaaa';

/**
 * What the guard puts on the request, swapped per test.
 *
 * `JwtAuthGuard` is replaced rather than driven with real tokens: the subject here
 * is what a handler does with the principal it is handed, and the case being
 * reproduced — a principal with no `sub` — is by definition one the guard was
 * never supposed to produce. Signing an RS256 token cannot express it.
 */
let injectedUser: Record<string, unknown> | undefined;

class StubGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = injectedUser;
    return true;
  }
}

/** Every mock is a jest.fn, so "nothing was written" is an assertion, not a hope. */
const savedTranslations: Array<Record<string, unknown>> = [];

const contentItemRepo = {
  findBySlug: jest.fn(async () => null),
  findById: jest.fn(async () => null),
  save: jest.fn(async (item: any) => item),
  update: jest.fn(async (item: any) => item),
};
const categoryRepo = {
  existsBySlug: jest.fn(async () => false),
  findById: jest.fn(async () => null),
  save: jest.fn(async (c: any) => c),
  update: jest.fn(async (c: any) => c),
};
const authorRepo = {
  existsBySlug: jest.fn(async () => false),
  findById: jest.fn(async () => null),
  save: jest.fn(async (a: any) => a),
  update: jest.fn(async (a: any) => a),
};
const tagRepo = {
  existsBySlug: jest.fn(async () => false),
  findById: jest.fn(async () => null),
  save: jest.fn(async (t: any) => t),
};
const translationRepo = {
  findOne: jest.fn(async () => null),
  find: jest.fn(async () => []),
  create: jest.fn((row: Record<string, unknown>) => row),
  save: jest.fn(async (row: Record<string, unknown>) => {
    savedTranslations.push(row);
    return row;
  }),
};
const contentOrmRepo = { findOne: jest.fn(async () => null), save: jest.fn(async (e: any) => e) };
const tagOrmRepo = { findByIds: jest.fn(async () => []) };

/** The write repositories: none of these may be touched by an unauthenticated call. */
const writeMocks = [
  contentItemRepo.save, contentItemRepo.update,
  categoryRepo.save, categoryRepo.update,
  authorRepo.save, authorRepo.update,
  tagRepo.save,
  translationRepo.save,
];

/**
 * The seven call sites, as HTTP.
 *
 * Bodies are valid on purpose: the global ValidationPipe runs BEFORE the handler,
 * so an invalid body would answer 400 and the test would never reach the line it
 * is about — and would still look green.
 */
const CALL_SITES = [
  {
    name: 'POST /admin/content (createContent)',
    method: 'post' as const,
    url: '/admin/content',
    body: {
      slug: 'actor-id-probe',
      type: 'AUDIO',
      primaryLocale: 'ar',
      translations: [{ locale: 'ar', title: 'مادة اختبار الهوية' }],
    },
  },
  {
    name: 'PATCH /admin/content/:id (updateContent)',
    method: 'patch' as const,
    url: `/admin/content/${randomUUID()}`,
    body: { translations: [{ locale: 'ar', title: 'عنوان معدّل' }] },
  },
  {
    name: 'POST /admin/categories (createCategory)',
    method: 'post' as const,
    url: '/admin/categories',
    body: { slug: 'actor-id-probe-cat', translations: [{ locale: 'ar', name: 'قسم اختباري' }] },
  },
  {
    name: 'PATCH /admin/categories/:id (updateCategory)',
    method: 'patch' as const,
    url: `/admin/categories/${randomUUID()}`,
    body: { translations: [{ locale: 'ar', name: 'قسم معدّل' }] },
  },
  {
    name: 'POST /admin/authors (createAuthor)',
    method: 'post' as const,
    url: '/admin/authors',
    body: { slug: 'actor-id-probe-author', translations: [{ locale: 'ar', name: 'الشيخ الاختباري' }] },
  },
  {
    name: 'PATCH /admin/authors/:id (updateAuthor)',
    method: 'patch' as const,
    url: `/admin/authors/${randomUUID()}`,
    body: { translations: [{ locale: 'ar', name: 'اسم معدّل' }] },
  },
  {
    name: 'POST /admin/tags (createTag)',
    method: 'post' as const,
    url: '/admin/tags',
    body: { slug: 'actor-id-probe-tag', translations: [{ locale: 'ar', name: 'وسم اختباري' }] },
  },
];

describe('POLICY-SEC-001: admin writes require a real authenticated actor', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      controllers: [AdminContentController, AdminTaxonomyController],
      providers: [
        { provide: CONTENT_ITEM_REPOSITORY, useValue: contentItemRepo },
        { provide: CATEGORY_REPOSITORY, useValue: categoryRepo },
        { provide: AUTHOR_REPOSITORY, useValue: authorRepo },
        { provide: TAG_REPOSITORY, useValue: tagRepo },
        { provide: getRepositoryToken(TranslationOrmEntity), useValue: translationRepo },
        { provide: getRepositoryToken(ContentItemOrmEntity), useValue: contentOrmRepo },
        { provide: getRepositoryToken(TagOrmEntity), useValue: tagOrmRepo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useClass(StubGuard)
      .overrideGuard(RolesGuard)
      .useClass(StubGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    savedTranslations.length = 0;
    // Restore the default resolutions cleared above.
    contentItemRepo.findBySlug.mockResolvedValue(null as never);
    contentItemRepo.findById.mockResolvedValue(null as never);
    contentItemRepo.save.mockImplementation(async (item: any) => item);
    categoryRepo.existsBySlug.mockResolvedValue(false as never);
    categoryRepo.save.mockImplementation(async (c: any) => c);
    authorRepo.existsBySlug.mockResolvedValue(false as never);
    authorRepo.save.mockImplementation(async (a: any) => a);
    tagRepo.existsBySlug.mockResolvedValue(false as never);
    tagRepo.save.mockImplementation(async (t: any) => t);
    translationRepo.findOne.mockResolvedValue(null as never);
    translationRepo.create.mockImplementation((row: any) => row);
    translationRepo.save.mockImplementation(async (row: any) => {
      savedTranslations.push(row);
      return row;
    });
  });

  // ── 1. No principal at all ─────────────────────────────────────────────────

  describe.each(CALL_SITES)('$name', (site) => {
    it('answers 401 UNAUTHENTICATED when the request carries no principal', async () => {
      injectedUser = undefined;

      const res = await request(app.getHttpServer())[site.method](site.url).send(site.body);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      // Nothing reached persistence — the old code would have written a row here.
      for (const mock of writeMocks) expect(mock).not.toHaveBeenCalled();
    });

    it('answers 401 when a principal is present but carries no sub', async () => {
      // The shape the guard produced when its contract broke: a session object
      // with a role and an email but no subject. `req.user?.sub || FALLBACK` read
      // this as "unauthenticated, use the placeholder" and wrote anyway.
      injectedUser = { email: 'editor@example.test', role: 'Editor', sessionId: randomUUID() };

      const res = await request(app.getHttpServer())[site.method](site.url).send(site.body);

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHENTICATED');
      for (const mock of writeMocks) expect(mock).not.toHaveBeenCalled();
    });

    it('answers 401 for an empty-string sub rather than treating it as an id', async () => {
      // '' is falsy, so the old fallback substituted the placeholder here too.
      injectedUser = { sub: '', email: 'editor@example.test', role: 'Editor' };

      const res = await request(app.getHttpServer())[site.method](site.url).send(site.body);

      expect(res.status).toBe(401);
      for (const mock of writeMocks) expect(mock).not.toHaveBeenCalled();
    });
  });

  // ── 2. The positive control ────────────────────────────────────────────────

  describe('with a real authenticated actor', () => {
    beforeEach(() => {
      injectedUser = { sub: REAL_ACTOR, email: 'editor@example.test', role: 'Editor' };
    });

    it('lets the create requests through — so the 401s above are about the missing sub', async () => {
      for (const site of CALL_SITES.filter((s) => s.method === 'post')) {
        const res = await request(app.getHttpServer()).post(site.url).send(site.body);
        expect(res.status).toBe(201);
      }
    });

    it('attributes the content item to the authenticated user, not the placeholder', async () => {
      await request(app.getHttpServer())
        .post('/admin/content')
        .send(CALL_SITES[0].body)
        .expect(201);

      const item = contentItemRepo.save.mock.calls[0][0] as any;
      expect(item.createdBy).toBe(REAL_ACTOR);
      expect(item.createdBy).not.toBe(FABRICATED_ID);
    });

    it('stamps created_by on every translation row with the authenticated user', async () => {
      await request(app.getHttpServer())
        .post('/admin/categories')
        .send({
          slug: 'actor-id-probe-cat',
          translations: [
            { locale: 'ar', name: 'قسم اختباري' },
            { locale: 'en', name: 'Probe category' },
          ],
        })
        .expect(201);

      expect(savedTranslations).toHaveLength(2);
      for (const row of savedTranslations) {
        expect(row.createdBy).toBe(REAL_ACTOR);
        expect(row.createdBy).not.toBe(FABRICATED_ID);
      }
    });

    it('never writes the fabricated placeholder id anywhere in a create', async () => {
      for (const site of CALL_SITES.filter((s) => s.method === 'post')) {
        await request(app.getHttpServer()).post(site.url).send(site.body).expect(201);
      }

      const everyWrittenValue = JSON.stringify([
        ...contentItemRepo.save.mock.calls,
        ...categoryRepo.save.mock.calls,
        ...authorRepo.save.mock.calls,
        ...tagRepo.save.mock.calls,
        ...savedTranslations,
      ]);
      expect(everyWrittenValue).not.toContain(FABRICATED_ID);
    });
  });

  // ── 3. The call sites are all of them ──────────────────────────────────────

  it('covers every requireActorId call site in the module', () => {
    // A new admin write handler that forgets the helper is the failure this suite
    // cannot otherwise see: it would simply not be in CALL_SITES. Counting the
    // call sites in the source turns that omission into a red test.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { readFileSync } = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resolve } = require('path');

    const sources = ['admin-content.controller.ts', 'admin-taxonomy.controller.ts'].map((file) =>
      readFileSync(resolve(__dirname, file), 'utf8'),
    );

    // `requireActorId(req)` — the invocations, excluding the import line and the
    // private one-line wrapper in admin-content.controller.ts.
    const invocations = sources
      .join('\n')
      .split('\n')
      .filter((line) => /requireActorId\(req\)/.test(line) && !/^\s*(import|return)/.test(line));

    expect(invocations).toHaveLength(CALL_SITES.length);
  });
});
