/**
 * BC02 Content & Media Library — Integration Tests
 *
 * Tests all 21 endpoints and 14 scenarios using in-memory mocks.
 * Clean Architecture layer separation, RBAC enforcement, and public route access.
 *
 * 14 Test Scenarios:
 *  1. Public: GET /content (cursor pagination + type/category filtering)
 *  2. Public: GET /content/:slug (with localized translations)
 *  3. Public: GET /content/:slug (404 for non-existent or unpublished item)
 *  4. Public: GET /content/categories (flat tree structure)
 *  5. Public: GET /content/categories/:slug (category + direct children)
 *  6. Public: GET /content/tags (list all tags)
 *  7. Protected: GET /content/:slug/media/stream (requires JWT, returns presigned URL)
 *  8. Protected: GET /content/:slug/media/stream (401 without JWT)
 *  9. Admin: POST /admin/content (creates DRAFT with translations & tags)
 * 10. Admin: Content workflow (DRAFT -> REVIEW -> PUBLISHED -> ARCHIVED)
 * 11. Admin: PATCH & DELETE /admin/content/:id (updates metadata, soft-delete)
 * 12. Admin: Taxonomy CRUD (Categories, Authors, Tags)
 * 13. Admin: Media upload — presigned initiate, storage-verified complete, status
 * 14. RBAC Guard: Editor/Admin allowed, regular User gets 403 FORBIDDEN on admin routes
 *
 * The upload path additionally has a dedicated adversarial suite —
 * `media-upload.anti-fabrication.spec.ts` — covering every way `complete` can be
 * called without a real upload behind it.
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate, ExecutionContext } from '@nestjs/common';
import request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { createHash, randomUUID } from 'crypto';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { ContentController } from './presentation/content.controller';
import { AdminContentController } from './presentation/admin-content.controller';
import { AdminTaxonomyController } from './presentation/admin-taxonomy.controller';
import { AdminMediaController } from './presentation/admin-media.controller';
import { RolesGuard } from './presentation/guards/roles.guard';
import { JwtAuthGuard } from '../identity/presentation/guards/jwt-auth.guard';
import { JwtStrategy } from '../identity/infrastructure/adapters/jwt.strategy';
import { JwtRs256Adapter } from '../identity/infrastructure/adapters/jwt-rs256.adapter';

import { CONTENT_ITEM_REPOSITORY, IContentItemRepository, ContentItemFilter, ContentItemPage } from './domain/ports/content-item.repository';
import { CATEGORY_REPOSITORY, ICategoryRepository } from './domain/ports/category.repository';
import { AUTHOR_REPOSITORY, IAuthorRepository } from './domain/ports/author.repository';
import { TAG_REPOSITORY, ITagRepository } from './domain/ports/tag.repository';
import { MEDIA_ASSET_REPOSITORY, IMediaAssetRepository } from './domain/ports/media-asset.repository';
import { STORAGE_SERVICE } from './domain/ports/storage.service';
import { MediaUploadService } from './application/services/media-upload.service';
import { FakeStorageService } from './testing/fake-storage.service';

import { ContentItem } from './domain/content-item.entity';
import { Category } from './domain/category.entity';
import { Author } from './domain/author.entity';
import { Tag } from './domain/tag.entity';
import { MediaAsset } from './domain/media-asset.entity';
import { UUIDv7 } from '../../shared/domain/uuid.vo';

import { ContentItemOrmEntity } from './infrastructure/persistence/entities/content-item.orm-entity';
import { CategoryOrmEntity } from './infrastructure/persistence/entities/category.orm-entity';
import { AuthorOrmEntity } from './infrastructure/persistence/entities/author.orm-entity';
import { TagOrmEntity } from './infrastructure/persistence/entities/tag.orm-entity';
import { MediaAssetOrmEntity } from './infrastructure/persistence/entities/media-asset.orm-entity';
import { TranslationOrmEntity } from './infrastructure/persistence/entities/translation.orm-entity';

import { GlobalExceptionFilter } from '../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../shared/presentation/interceptors/trace-id.interceptor';

class BypassThrottlerGuard implements CanActivate {
  canActivate(): boolean { return true; }
}

describe('BC02 Content Module — Integration Tests', () => {
  let app: INestApplication;
  let jwtAdapter: JwtRs256Adapter;

  // In-memory data stores
  let contentItemsStore: ContentItem[] = [];
  let categoriesStore: Category[] = [];
  let authorsStore: Author[] = [];
  let tagsStore: Tag[] = [];
  let mediaAssetsStore: MediaAsset[] = [];
  // The storage side of the world, controlled independently of the API side.
  const storage = new FakeStorageService();
  let translationsStore: TranslationOrmEntity[] = [];

  // Tokens for different roles
  let editorToken: string;
  let adminToken: string;
  let userToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'jwt.accessTokenTtl': 900,
          'jwt.refreshTokenTtl': 604800,
          'jwt.publicKey': undefined,
          'jwt.privateKey': undefined,
          'jwt.publicKeyPath': undefined,
          'jwt.privateKeyPath': undefined,
        };
        return config[key] ?? defaultValue;
      }),
    };

    // Mock ContentItem Repository
    const mockContentItemRepo: IContentItemRepository = {
      async findPublished(filter: ContentItemFilter): Promise<ContentItemPage> {
        let items = contentItemsStore.filter((i) => i.status === 'PUBLISHED' && !i.isDeleted);
        if (filter.type) {
          items = items.filter((i) => i.type === filter.type);
        }
        if (filter.categorySlug) {
          const cat = categoriesStore.find((c) => c.slug === filter.categorySlug);
          if (cat) {
            items = items.filter((i) => i.categoryId === cat.id.value);
          } else {
            items = [];
          }
        }
        items.sort((a, b) => ((b.publishedAt?.getTime() || 0) - (a.publishedAt?.getTime() || 0)));
        const pageItems = items.slice(0, filter.limit);
        const hasMore = items.length > filter.limit;
        const nextCursor = hasMore ? Buffer.from(JSON.stringify({ id: pageItems[pageItems.length - 1].id.value })).toString('base64') : null;
        return { items: pageItems, nextCursor, prevCursor: null };
      },
      async findBySlug(slug: string): Promise<ContentItem | null> {
        const item = contentItemsStore.find((i) => i.slug === slug && !i.isDeleted);
        return item || null;
      },
      async findById(id: string): Promise<ContentItem | null> {
        const item = contentItemsStore.find((i) => i.id.value === id && !i.isDeleted);
        return item || null;
      },
      async save(item: ContentItem): Promise<ContentItem> {
        contentItemsStore.push(item);
        return item;
      },
      async update(item: ContentItem): Promise<ContentItem> {
        const index = contentItemsStore.findIndex((i) => i.id.value === item.id.value);
        if (index !== -1) {
          contentItemsStore[index] = item;
        }
        return item;
      },
      async softDelete(item: ContentItem): Promise<void> {
        item.softDelete();
      },
      async incrementViewCount(id: string): Promise<void> {
        const item = contentItemsStore.find((i) => i.id.value === id);
        if (item) item.incrementViewCount();
      },
    };

    // Mock Category Repository
    const mockCategoryRepo: ICategoryRepository = {
      async findAll(): Promise<Category[]> {
        return categoriesStore.filter((c) => !c.isDeleted);
      },
      async findBySlug(slug: string): Promise<Category | null> {
        return categoriesStore.find((c) => c.slug === slug && !c.isDeleted) || null;
      },
      async findById(id: string): Promise<Category | null> {
        return categoriesStore.find((c) => c.id.value === id && !c.isDeleted) || null;
      },
      async findChildren(parentId: string): Promise<Category[]> {
        return categoriesStore.filter((c) => c.parentId === parentId && !c.isDeleted);
      },
      async save(category: Category): Promise<Category> {
        categoriesStore.push(category);
        return category;
      },
      async update(category: Category): Promise<Category> {
        const index = categoriesStore.findIndex((c) => c.id.value === category.id.value);
        if (index !== -1) categoriesStore[index] = category;
        return category;
      },
      async softDelete(category: Category): Promise<void> {
        category.softDelete();
      },
      async existsBySlug(slug: string): Promise<boolean> {
        return categoriesStore.some((c) => c.slug === slug && !c.isDeleted);
      },
    };

    // Mock Author Repository
    const mockAuthorRepo: IAuthorRepository = {
      async findAll(params: { limit: number; offset: number }): Promise<{ items: Author[]; total: number }> {
        const active = authorsStore.filter((a) => !a.isDeleted);
        return { items: active.slice(params.offset, params.offset + params.limit), total: active.length };
      },
      async findById(id: string): Promise<Author | null> {
        return authorsStore.find((a) => a.id.value === id && !a.isDeleted) || null;
      },
      async findBySlug(slug: string): Promise<Author | null> {
        return authorsStore.find((a) => a.slug === slug && !a.isDeleted) || null;
      },
      async save(author: Author): Promise<Author> {
        authorsStore.push(author);
        return author;
      },
      async update(author: Author): Promise<Author> {
        const index = authorsStore.findIndex((a) => a.id.value === author.id.value);
        if (index !== -1) authorsStore[index] = author;
        return author;
      },
      async softDelete(author: Author): Promise<void> {
        author.softDelete();
      },
      async existsBySlug(slug: string): Promise<boolean> {
        return authorsStore.some((a) => a.slug === slug && !a.isDeleted);
      },
    };

    // Mock Tag Repository
    const mockTagRepo: ITagRepository = {
      async findAll(): Promise<Tag[]> {
        return [...tagsStore];
      },
      async findById(id: string): Promise<Tag | null> {
        return tagsStore.find((t) => t.id.value === id) || null;
      },
      async findBySlug(slug: string): Promise<Tag | null> {
        return tagsStore.find((t) => t.slug === slug) || null;
      },
      async save(tag: Tag): Promise<Tag> {
        tagsStore.push(tag);
        return tag;
      },
      async delete(id: string): Promise<void> {
        tagsStore = tagsStore.filter((t) => t.id.value !== id);
      },
      async existsBySlug(slug: string): Promise<boolean> {
        return tagsStore.some((t) => t.slug === slug);
      },
    };

    // Mock Media Asset Repository
    const mockMediaRepo: IMediaAssetRepository = {
      async findById(id: string): Promise<MediaAsset | null> {
        return mediaAssetsStore.find((m) => m.id.value === id && !m.deletedAt) || null;
      },
      async save(asset: MediaAsset): Promise<MediaAsset> {
        mediaAssetsStore.push(asset);
        return asset;
      },
      async update(asset: MediaAsset): Promise<MediaAsset> {
        const index = mediaAssetsStore.findIndex((m) => m.id.value === asset.id.value);
        if (index !== -1) mediaAssetsStore[index] = asset;
        return asset;
      },
    };

    // Mock TypeORM Repositories
    const mockTranslationOrmRepo = {
      find: jest.fn(async (opts?: any) => {
        let results = [...translationsStore];
        if (opts?.where) {
          if (opts.where.entityType) results = results.filter((r) => r.entityType === opts.where.entityType);
          if (opts.where.entityId) results = results.filter((r) => r.entityId === opts.where.entityId);
          if (opts.where.locale) results = results.filter((r) => r.locale === opts.where.locale);
        }
        return results;
      }),
      findOne: jest.fn(async (opts?: any) => {
        const found = translationsStore.find((r) => {
          if (opts?.where?.entityType && r.entityType !== opts.where.entityType) return false;
          if (opts?.where?.entityId && r.entityId !== opts.where.entityId) return false;
          if (opts?.where?.locale && r.locale !== opts.where.locale) return false;
          if (opts?.where?.fieldName && r.fieldName !== opts.where.fieldName) return false;
          return true;
        });
        return found || null;
      }),
      create: jest.fn((dto: any) => ({ ...dto, updatedAt: new Date() })),
      save: jest.fn(async (entity: any) => {
        const idx = translationsStore.findIndex(
          (t) => t.entityType === entity.entityType && t.entityId === entity.entityId && t.locale === entity.locale && t.fieldName === entity.fieldName,
        );
        if (idx !== -1) {
          translationsStore[idx] = entity;
        } else {
          translationsStore.push(entity);
        }
        return entity;
      }),
    };

    const mockContentOrmRepo = {
      findOne: jest.fn(async () => null),
      save: jest.fn(async (entity: any) => entity),
    };

    const mockTagOrmRepo = {
      findByIds: jest.fn(async (ids: string[]) => ids.map((id) => ({ id, slug: 'mock-tag', createdAt: new Date() }))),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [
        ContentController,
        AdminContentController,
        AdminTaxonomyController,
        AdminMediaController,
      ],
      providers: [
        RolesGuard,
        JwtStrategy,
        JwtRs256Adapter,
        MediaUploadService,
        { provide: STORAGE_SERVICE, useValue: storage },
        { provide: ConfigService, useValue: mockConfigService },
        { provide: CONTENT_ITEM_REPOSITORY, useValue: mockContentItemRepo },
        { provide: CATEGORY_REPOSITORY, useValue: mockCategoryRepo },
        { provide: AUTHOR_REPOSITORY, useValue: mockAuthorRepo },
        { provide: TAG_REPOSITORY, useValue: mockTagRepo },
        { provide: MEDIA_ASSET_REPOSITORY, useValue: mockMediaRepo },
        { provide: getRepositoryToken(TranslationOrmEntity), useValue: mockTranslationOrmRepo },
        { provide: getRepositoryToken(ContentItemOrmEntity), useValue: mockContentOrmRepo },
        { provide: getRepositoryToken(TagOrmEntity), useValue: mockTagOrmRepo },
        { provide: APP_GUARD, useClass: BypassThrottlerGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());

    await app.init();

    jwtAdapter = moduleFixture.get<JwtRs256Adapter>(JwtRs256Adapter);

    // Generate test JWTs with different roles
    editorToken = await jwtAdapter.signAccessToken({ sub: randomUUID(), email: 'editor@example.com', role: 'Editor', sessionId: randomUUID() });
    adminToken = await jwtAdapter.signAccessToken({ sub: randomUUID(), email: 'admin@example.com', role: 'Admin', sessionId: randomUUID() });
    userToken = await jwtAdapter.signAccessToken({ sub: randomUUID(), email: 'user@example.com', role: 'User', sessionId: randomUUID() });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    contentItemsStore = [];
    categoriesStore = [];
    authorsStore = [];
    tagsStore = [];
    mediaAssetsStore = [];
    translationsStore = [];
    storage.reset();
  });

  // ── Scenario 1: Public GET /content ─────────────────────────────────────────
  it('Scenario 1: Public GET /content returns published items with cursor pagination without token', async () => {
    const pubItem = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'pub-article-1',
      type: 'TEXT',
      primaryLocale: 'ar',
      createdBy: randomUUID(),
    });
    pubItem.submitForReview();
    pubItem.publish();
    contentItemsStore.push(pubItem);

    const draftItem = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'draft-article-2',
      type: 'TEXT',
      createdBy: randomUUID(),
    });
    contentItemsStore.push(draftItem);

    const res = await request(app.getHttpServer())
      .get('/content')
      .expect(200);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].slug).toBe('pub-article-1');
    expect(res.body.meta).toBeDefined();
    expect(res.body.meta.limit).toBe(20);
  });

  // ── Scenario 2: Public GET /content/:slug ───────────────────────────────────
  it('Scenario 2: Public GET /content/:slug returns full item details with translations', async () => {
    const id = UUIDv7.generate();
    const item = ContentItem.create({
      id,
      slug: 'surah-al-fatiha-tafseer',
      type: 'TEXT',
      createdBy: randomUUID(),
    });
    item.submitForReview();
    item.publish();
    contentItemsStore.push(item);

    translationsStore.push(
      { id: randomUUID(), entityType: 'content_item', entityId: id.value, locale: 'ar', fieldName: 'title', content: 'تفسير سورة الفاتحة', createdBy: null, updatedAt: new Date() },
      { id: randomUUID(), entityType: 'content_item', entityId: id.value, locale: 'ar', fieldName: 'body', content: 'نص التفسير الكامل هنا...', createdBy: null, updatedAt: new Date() },
    );

    const res = await request(app.getHttpServer())
      .get('/content/surah-al-fatiha-tafseer')
      .expect(200);

    expect(res.body.data.slug).toBe('surah-al-fatiha-tafseer');
    expect(res.body.data.title).toBe('تفسير سورة الفاتحة');
    expect(res.body.data.body).toBe('نص التفسير الكامل هنا...');
    expect(res.body.data.type).toBe('TEXT');
    expect(res.body.data.viewCount).toBe(1);
  });

  // ── Scenario 3: Public GET /content/:slug 404 for non-existent or unpublished
  it('Scenario 3: Public GET /content/:slug returns 404 for unpublished or non-existent items', async () => {
    const draft = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'hidden-draft',
      type: 'AUDIO',
      createdBy: randomUUID(),
    });
    contentItemsStore.push(draft);

    await request(app.getHttpServer())
      .get('/content/hidden-draft')
      .expect(404);

    await request(app.getHttpServer())
      .get('/content/completely-non-existent')
      .expect(404);
  });

  // ── Scenario 4: Public GET /content/categories ──────────────────────────────
  it('Scenario 4: Public GET /content/categories returns flat category tree', async () => {
    const parentId = UUIDv7.generate();
    const parent = Category.create({ id: parentId, slug: 'quran', sortOrder: 0 });
    const child = Category.create({ id: UUIDv7.generate(), slug: 'tafseer', parentId: parentId.value, sortOrder: 1 });
    categoriesStore.push(parent, child);

    translationsStore.push(
      { id: randomUUID(), entityType: 'category', entityId: parentId.value, locale: 'ar', fieldName: 'name', content: 'القرآن الكريم', createdBy: null, updatedAt: new Date() },
    );

    const res = await request(app.getHttpServer())
      .get('/content/categories')
      .expect(200);

    expect(res.body.data.length).toBe(2);
    const quran = res.body.data.find((c: any) => c.slug === 'quran');
    expect(quran.name).toBe('القرآن الكريم');
    expect(quran.parentId).toBeNull();
  });

  // ── Scenario 5: Public GET /content/categories/:slug ────────────────────────
  it('Scenario 5: Public GET /content/categories/:slug returns category with direct children', async () => {
    const parentId = UUIDv7.generate();
    const parent = Category.create({ id: parentId, slug: 'hadith', sortOrder: 0 });
    const child1 = Category.create({ id: UUIDv7.generate(), slug: 'bukhari', parentId: parentId.value, sortOrder: 0 });
    const child2 = Category.create({ id: UUIDv7.generate(), slug: 'muslim', parentId: parentId.value, sortOrder: 1 });
    categoriesStore.push(parent, child1, child2);

    const res = await request(app.getHttpServer())
      .get('/content/categories/hadith')
      .expect(200);

    expect(res.body.data.slug).toBe('hadith');
    expect(res.body.data.children.length).toBe(2);
    expect(res.body.data.children[0].slug).toBe('bukhari');
  });

  // ── Scenario 6: Public GET /content/tags ────────────────────────────────────
  it('Scenario 6: Public GET /content/tags returns all tags', async () => {
    const tag1 = Tag.create({ id: UUIDv7.generate(), slug: 'tawheed' });
    const tag2 = Tag.create({ id: UUIDv7.generate(), slug: 'fiqh' });
    tagsStore.push(tag1, tag2);

    const res = await request(app.getHttpServer())
      .get('/content/tags')
      .expect(200);

    expect(res.body.data.length).toBe(2);
    expect(res.body.data.map((t: any) => t.slug)).toContain('tawheed');
  });

  // ── Scenario 7: Protected GET /content/:slug/media/stream with JWT ──────────
  it('Scenario 7: Protected GET /content/:slug/media/stream returns a presigned URL with valid JWT', async () => {
    const mediaId = UUIDv7.generate();
    const sha256 = 'a'.repeat(64);
    const media = MediaAsset.create({
      id: mediaId,
      originalName: 'khutbah.mp3',
      storageKey: `originals/${mediaId.value}/${sha256}.mp3`,
      mimeType: 'audio/mpeg',
      sizeBytes: 15000000,
      sha256,
      uploadedBy: randomUUID(),
    });
    // Only a verified asset may be streamed, so the fixture goes through the
    // same confirmation the API requires — there is no setter that skips it.
    media.confirmUpload({ verifiedBytes: 15000000, verifiedAt: new Date() });
    mediaAssetsStore.push(media);

    const item = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'friday-khutbah-audio',
      type: 'AUDIO',
      mediaAssetId: mediaId.value,
      createdBy: randomUUID(),
    });
    item.submitForReview();
    item.publish();
    contentItemsStore.push(item);

    const res = await request(app.getHttpServer())
      .get('/content/friday-khutbah-audio/media/stream')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(200);

    // API-002: a time-limited URL, not a permanent one.
    expect(res.body.data.url).toContain(media.storageKey);
    expect(res.body.data.expiresInSeconds).toBe(3600);
    expect(new Date(res.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.body.data.mimeType).toBe('audio/mpeg');
    // The internal bucket path must not leak: clients get signed URLs, never keys.
    expect(res.body.data.storageKey).toBeUndefined();
  });

  // ── Scenario 7b: streaming an unverified asset is refused ───────────────────
  it('Scenario 7b: GET /content/:slug/media/stream returns 409 when the media has no verified file', async () => {
    const mediaId = UUIDv7.generate();
    const sha256 = 'b'.repeat(64);
    // PENDING_UPLOAD — created by initiate, never confirmed against storage.
    mediaAssetsStore.push(
      MediaAsset.create({
        id: mediaId,
        originalName: 'never-arrived.mp3',
        storageKey: `originals/${mediaId.value}/${sha256}.mp3`,
        mimeType: 'audio/mpeg',
        sizeBytes: 15000000,
        sha256,
        uploadedBy: randomUUID(),
      }),
    );

    const item = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'pending-khutbah',
      type: 'AUDIO',
      mediaAssetId: mediaId.value,
      createdBy: randomUUID(),
    });
    item.submitForReview();
    item.publish();
    contentItemsStore.push(item);

    const res = await request(app.getHttpServer())
      .get('/content/pending-khutbah/media/stream')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(409);

    expect(res.body.error.code).toBe('MEDIA_NOT_AVAILABLE');
    // No URL is handed out for a file that is not there.
    expect(res.body.data).toBeUndefined();
  });

  // ── Scenario 8: Protected GET /content/:slug/media/stream 401 without JWT ───
  it('Scenario 8: Protected GET /content/:slug/media/stream returns 401 when token is missing', async () => {
    const item = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'friday-khutbah-audio',
      type: 'AUDIO',
      createdBy: randomUUID(),
    });
    item.submitForReview();
    item.publish();
    contentItemsStore.push(item);

    await request(app.getHttpServer())
      .get('/content/friday-khutbah-audio/media/stream')
      .expect(401);
  });

  // ── Scenario 9: Admin POST /admin/content ───────────────────────────────────
  it('Scenario 9: Admin POST /admin/content creates DRAFT content with translations', async () => {
    const res = await request(app.getHttpServer())
      .post('/admin/content')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        slug: 'new-aqeedah-lesson',
        type: 'AUDIO',
        primaryLocale: 'ar',
        translations: [
          { locale: 'ar', title: 'درس في العقيدة الواسطية', description: 'شرح مفصل' },
        ],
      })
      .expect(201);

    expect(res.body.data.slug).toBe('new-aqeedah-lesson');
    expect(res.body.data.status).toBe('DRAFT');
    expect(contentItemsStore.length).toBe(1);
    expect(translationsStore.length).toBe(2); // title + description
  });

  // ── Scenario 10: Admin Content Lifecycle (DRAFT -> REVIEW -> PUBLISHED -> ARCHIVED)
  it('Scenario 10: Admin workflow transitions content status correctly', async () => {
    const item = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'lifecycle-test-item',
      type: 'PDF',
      createdBy: randomUUID(),
    });
    contentItemsStore.push(item);

    // 1. DRAFT -> REVIEW
    const revRes = await request(app.getHttpServer())
      .post(`/admin/content/${item.id.value}/submit-review`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(revRes.body.data.status).toBe('REVIEW');

    // 2. REVIEW -> PUBLISHED
    const pubRes = await request(app.getHttpServer())
      .post(`/admin/content/${item.id.value}/publish`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(pubRes.body.data.status).toBe('PUBLISHED');
    expect(pubRes.body.data.publishedAt).toBeDefined();

    // 3. PUBLISHED -> ARCHIVED
    const archRes = await request(app.getHttpServer())
      .post(`/admin/content/${item.id.value}/archive`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(archRes.body.data.status).toBe('ARCHIVED');
  });

  // ── Scenario 11: Admin PATCH & DELETE /admin/content/:id ────────────────────
  it('Scenario 11: Admin PATCH & DELETE updates metadata and soft-deletes item', async () => {
    const item = ContentItem.create({
      id: UUIDv7.generate(),
      slug: 'patchable-item',
      type: 'IMAGE',
      createdBy: randomUUID(),
    });
    contentItemsStore.push(item);

    // PATCH
    const patchRes = await request(app.getHttpServer())
      .patch(`/admin/content/${item.id.value}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ isFeatured: true, sortOrder: 5 })
      .expect(200);
    expect(patchRes.body.data.isFeatured).toBe(true);
    expect(patchRes.body.data.sortOrder).toBe(5);

    // DELETE
    await request(app.getHttpServer())
      .delete(`/admin/content/${item.id.value}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);

    expect(contentItemsStore[0].isDeleted).toBe(true);
  });

  // ── Scenario 12: Admin Taxonomy CRUD ────────────────────────────────────────
  it('Scenario 12: Admin Taxonomy CRUD operates on categories, authors, and tags', async () => {
    // 1. Create Category
    const catRes = await request(app.getHttpServer())
      .post('/admin/categories')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        slug: 'admin-cat',
        translations: [{ locale: 'ar', name: 'تصنيف إداري' }],
      })
      .expect(201);
    expect(catRes.body.data.slug).toBe('admin-cat');

    // 2. Create Author
    const authRes = await request(app.getHttpServer())
      .post('/admin/authors')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        slug: 'dr-salih',
        translations: [{ locale: 'ar', name: 'د. صالح', bio: 'أستاذ الفقه' }],
      })
      .expect(201);
    expect(authRes.body.data.slug).toBe('dr-salih');

    // 3. Create Tag
    const tagRes = await request(app.getHttpServer())
      .post('/admin/tags')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        slug: 'faraid',
        translations: [{ locale: 'ar', name: 'الفرائض' }],
      })
      .expect(201);
    expect(tagRes.body.data.slug).toBe('faraid');
  });

  // ── Scenario 13: Admin media upload — the real presigned flow ───────────────
  it('Scenario 13: Admin media upload issues a presigned URL and marks UPLOADED only after storage confirms the object', async () => {
    // The bytes the editor is about to upload, and their digest — computed here
    // the way the browser computes it with crypto.subtle before calling initiate.
    const body = Buffer.from('ID3 payload standing in for a lesson recording', 'utf8');
    const sha256 = createHash('sha256').update(body).digest('hex');

    // ── 1. Initiate: the response is a credential to upload, not a confirmation.
    const initRes = await request(app.getHttpServer())
      .post('/admin/media/upload/initiate')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        fileName: 'lesson-audio.mp3',
        mimeType: 'audio/mpeg',
        sizeBytes: body.length,
        sha256,
      })
      .expect(200);

    const { uploadId, mode, uploadUrl, requiredHeaders, storageKey, expiresAt } = initRes.body.data;
    expect(uploadId).toBeDefined();
    expect(mode).toBe('SINGLE'); // well under MAX_SINGLE_PUT_BYTES
    expect(uploadUrl).toContain(storageKey);
    // ADR-013 §2: the key is server-built and content-addressed. The client's
    // filename does not appear in it — the stub interpolated it directly.
    expect(storageKey).toBe(`originals/${uploadId}/${sha256}.mp3`);
    expect(storageKey).not.toContain('lesson-audio');
    // These headers are inside the signature; the client must echo them verbatim.
    expect(requiredHeaders['Content-Type']).toBe('audio/mpeg');
    expect(requiredHeaders['Content-Length']).toBe(String(body.length));
    expect(new Date(expiresAt).getTime()).toBeGreaterThan(Date.now());

    // Nothing has been uploaded yet, and the row says exactly that.
    const pendingRes = await request(app.getHttpServer())
      .get(`/admin/media/${uploadId}/status`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(pendingRes.body.data.uploadStatus).toBe('PENDING_UPLOAD');
    expect(pendingRes.body.data.verifiedBytes).toBeNull();
    expect(pendingRes.body.data.uploadedAt).toBeNull();

    // ── 2. The client PUTs the bytes straight to storage (never through NestJS).
    storage.putObject(storageKey, body, 'audio/mpeg');

    // ── 3. Complete: this is the only place the verdict comes from storage.
    const compRes = await request(app.getHttpServer())
      .post('/admin/media/upload/complete')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ uploadId })
      .expect(200);

    expect(storage.calls).toContain(`head:${storageKey}`);
    expect(compRes.body.data.uploadStatus).toBe('UPLOADED');
    expect(compRes.body.data.verifiedBytes).toBe(body.length);
    expect(compRes.body.data.alreadyComplete).toBe(false);
    // The binding rule: ADR-013 Stage B is not implemented, so nothing here
    // claims a transcode ran. The stub asserted 'DONE' at this exact line.
    expect(compRes.body.data.transcodeStatus).toBe('PENDING');
    expect(compRes.body.data.transcodeNote).toContain('not yet');

    // ── 4. Status reports declared and verified sizes separately, and never
    //      leaks the bucket path.
    const statusRes = await request(app.getHttpServer())
      .get(`/admin/media/${uploadId}/status`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(200);
    expect(statusRes.body.data.originalName).toBe('lesson-audio.mp3');
    expect(statusRes.body.data.uploadStatus).toBe('UPLOADED');
    expect(statusRes.body.data.sizeBytes).toBe(body.length);
    expect(statusRes.body.data.verifiedBytes).toBe(body.length);
    expect(statusRes.body.data.sha256).toBe(sha256);
    expect(statusRes.body.data.uploadedAt).not.toBeNull();
    expect(statusRes.body.data.transcodeStatus).toBe('PENDING');
    expect(statusRes.body.data.storageKey).toBeUndefined();

    // ── 5. A retried complete (double click, flaky network) is idempotent: it
    //      reports the state already verified instead of erroring or re-checking.
    const headCallsBefore = storage.calls.filter((c) => c === `head:${storageKey}`).length;
    const retryRes = await request(app.getHttpServer())
      .post('/admin/media/upload/complete')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ uploadId })
      .expect(200);
    expect(retryRes.body.data.alreadyComplete).toBe(true);
    expect(retryRes.body.data.uploadStatus).toBe('UPLOADED');
    expect(retryRes.body.data.transcodeStatus).toBe('PENDING');
    expect(storage.calls.filter((c) => c === `head:${storageKey}`).length).toBe(headCallsBefore);
  });

  // ── Scenario 14: RBAC Guard Enforcement ────────────────────────────────────
  it('Scenario 14: Regular User receives 403 FORBIDDEN on admin endpoints, while Editor/Admin succeed', async () => {
    // User tries to create content -> 403
    await request(app.getHttpServer())
      .post('/admin/content')
      .set('Authorization', `Bearer ${userToken}`)
      .send({
        slug: 'unauthorized-content',
        type: 'TEXT',
        translations: [{ locale: 'ar', title: 'غير مصرح' }],
      })
      .expect(403);

    // User tries to delete category -> 403
    await request(app.getHttpServer())
      .delete('/admin/categories/some-id')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    // Editor succeeds
    const editorRes = await request(app.getHttpServer())
      .post('/admin/content')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        slug: 'editor-approved-content',
        type: 'TEXT',
        translations: [{ locale: 'ar', title: 'محتوى معتمد' }],
      })
      .expect(201);
    expect(editorRes.body.data.slug).toBe('editor-approved-content');
  });
});
