import {
  Controller, Get, Param, Query, NotFoundException,
  UnprocessableEntityException, UseGuards, Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { Inject } from '@nestjs/common';
import {
  IContentItemRepository,
  CONTENT_ITEM_REPOSITORY,
} from '../domain/ports/content-item.repository';
import {
  ICategoryRepository,
  CATEGORY_REPOSITORY,
} from '../domain/ports/category.repository';
import {
  ITagRepository,
  TAG_REPOSITORY,
} from '../domain/ports/tag.repository';
import {
  IMediaAssetRepository,
  MEDIA_ASSET_REPOSITORY,
} from '../domain/ports/media-asset.repository';
import { TranslationOrmEntity } from '../infrastructure/persistence/entities/translation.orm-entity';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { ContentType } from '../domain/content-item.entity';
import { MediaUploadService } from '../application/services/media-upload.service';

@ApiTags('Content (Public)')
@Controller('content')
export class ContentController {
  constructor(
    @Inject(CONTENT_ITEM_REPOSITORY)
    private readonly contentItemRepo: IContentItemRepository,
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepo: ICategoryRepository,
    @Inject(TAG_REPOSITORY)
    private readonly tagRepo: ITagRepository,
    @Inject(MEDIA_ASSET_REPOSITORY)
    private readonly mediaRepo: IMediaAssetRepository,
    @InjectRepository(TranslationOrmEntity)
    private readonly translationRepo: Repository<TranslationOrmEntity>,
    private readonly uploadService: MediaUploadService,
  ) {}

  // ── Public Endpoint 1: GET /content ─────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'List published content items with cursor pagination' })
  @ApiResponse({ status: 200, description: 'Paginated content items list' })
  async listContent(
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('type') type?: ContentType,
    @Query('category') category?: string,
    @Query('locale') locale: string = 'ar',
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10), 1), 100);
    const result = await this.contentItemRepo.findPublished({
      limit,
      cursor,
      type,
      categorySlug: category,
      locale,
    });

    const itemIds = result.items.map((i) => i.id.value);
    const translations = itemIds.length > 0
      ? await this.translationRepo.find({
          where: { entityType: 'content_item', locale },
        })
      : [];

    const transMap = new Map<string, Record<string, string>>();
    for (const t of translations) {
      if (!transMap.has(t.entityId)) transMap.set(t.entityId, {});
      transMap.get(t.entityId)![t.fieldName] = t.content;
    }

    const data = await Promise.all(
      result.items.map(async (item) => {
        const trans = transMap.get(item.id.value) || {};
        let authorData = null;
        if (item.authorId) {
          const authorTranslations = await this.translationRepo.find({
            where: { entityType: 'author', entityId: item.authorId, locale },
          });
          const aTrans = authorTranslations.reduce((acc, curr) => ({ ...acc, [curr.fieldName]: curr.content }), {} as Record<string, string>);
          authorData = {
            id: item.authorId,
            name: aTrans['name'] || null,
          };
        }

        let categoryData = null;
        if (item.categoryId) {
          const cat = await this.categoryRepo.findById(item.categoryId);
          if (cat) {
            const catTrans = await this.translationRepo.find({
              where: { entityType: 'category', entityId: cat.id.value, locale },
            });
            const cTrans = catTrans.reduce((acc, curr) => ({ ...acc, [curr.fieldName]: curr.content }), {} as Record<string, string>);
            categoryData = {
              id: cat.id.value,
              slug: cat.slug,
              name: cTrans['name'] || cat.slug,
            };
          }
        }

        let mediaData = null;
        if (item.mediaAssetId) {
          const media = await this.mediaRepo.findById(item.mediaAssetId);
          if (media) {
            mediaData = {
              durationMs: media.durationMs,
              thumbnailUrl: media.cdnUrl,
              isAvailable: media.isUploaded,
            };
          }
        }

        return {
          id: item.id.value,
          slug: item.slug,
          type: item.type,
          status: item.status,
          title: trans['title'] || item.slug,
          description: trans['description'] || null,
          author: authorData,
          category: categoryData,
          media: mediaData,
          viewCount: item.viewCount,
          isFeatured: item.isFeatured,
          publishedAt: item.publishedAt,
        };
      }),
    );

    return {
      data,
      meta: {
        nextCursor: result.nextCursor,
        prevCursor: result.prevCursor,
        limit,
      },
    };
  }

  // ── Public Endpoint 2: GET /content/categories ──────────────────────────────
  @Get('categories')
  @ApiOperation({ summary: 'List all categories in a flat structure' })
  @ApiResponse({ status: 200, description: 'Flat list of all categories' })
  async listCategories(@Query('locale') locale: string = 'ar') {
    const categories = await this.categoryRepo.findAll();
    const catIds = categories.map((c) => c.id.value);

    const translations = catIds.length > 0
      ? await this.translationRepo.find({
          where: { entityType: 'category', locale },
        })
      : [];

    const transMap = new Map<string, Record<string, string>>();
    for (const t of translations) {
      if (!transMap.has(t.entityId)) transMap.set(t.entityId, {});
      transMap.get(t.entityId)![t.fieldName] = t.content;
    }

    const data = categories.map((cat) => {
      const trans = transMap.get(cat.id.value) || {};
      return {
        id: cat.id.value,
        slug: cat.slug,
        name: trans['name'] || cat.slug,
        parentId: cat.parentId,
        sortOrder: cat.sortOrder,
      };
    });

    return { data };
  }

  // ── Public Endpoint 3: GET /content/categories/:slug ────────────────────────
  @Get('categories/:slug')
  @ApiOperation({ summary: 'Get category by slug with direct children' })
  @ApiResponse({ status: 200, description: 'Category and its direct children' })
  async getCategoryBySlug(
    @Param('slug') slug: string,
    @Query('locale') locale: string = 'ar',
  ) {
    const cat = await this.categoryRepo.findBySlug(slug);
    if (!cat) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Category with slug '${slug}' not found`,
      });
    }

    const children = await this.categoryRepo.findChildren(cat.id.value);
    const allIds = [cat.id.value, ...children.map((c) => c.id.value)];

    const translations = await this.translationRepo.find({
      where: { entityType: 'category', locale },
    });

    const transMap = new Map<string, Record<string, string>>();
    for (const t of translations) {
      if (!transMap.has(t.entityId)) transMap.set(t.entityId, {});
      transMap.get(t.entityId)![t.fieldName] = t.content;
    }

    const catTrans = transMap.get(cat.id.value) || {};
    const childrenData = children.map((c) => {
      const cTrans = transMap.get(c.id.value) || {};
      return {
        id: c.id.value,
        slug: c.slug,
        name: cTrans['name'] || c.slug,
        sortOrder: c.sortOrder,
      };
    });

    return {
      data: {
        id: cat.id.value,
        slug: cat.slug,
        name: catTrans['name'] || cat.slug,
        parentId: cat.parentId,
        sortOrder: cat.sortOrder,
        children: childrenData,
      },
    };
  }

  // ── Public Endpoint 4: GET /content/tags ────────────────────────────────────
  @Get('tags')
  @ApiOperation({ summary: 'List all tags' })
  @ApiResponse({ status: 200, description: 'List of tags' })
  async listTags(@Query('locale') locale: string = 'ar') {
    const tags = await this.tagRepo.findAll();
    const tagIds = tags.map((t) => t.id.value);

    const translations = tagIds.length > 0
      ? await this.translationRepo.find({
          where: { entityType: 'tag', locale },
        })
      : [];

    const transMap = new Map<string, Record<string, string>>();
    for (const t of translations) {
      if (!transMap.has(t.entityId)) transMap.set(t.entityId, {});
      transMap.get(t.entityId)![t.fieldName] = t.content;
    }

    const data = tags.map((tag) => {
      const trans = transMap.get(tag.id.value) || {};
      return {
        id: tag.id.value,
        slug: tag.slug,
        name: trans['name'] || tag.slug,
      };
    });

    return { data };
  }

  // ── Protected Endpoint: GET /content/:slug/media/stream ──────────────────────
  @Get(':slug/media/stream')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Stream protected media content via a time-limited presigned URL',
    description:
      'API-002: returns a presigned GET valid for 60 minutes. Protected AUDIO/PDF never receive ' +
      'a permanent cdn_url. The internal storage key is not exposed.',
  })
  @ApiResponse({ status: 200, description: 'Presigned media URL (60-minute TTL)' })
  @ApiResponse({ status: 409, description: 'The media asset has no verified file in storage' })
  async streamMedia(@Param('slug') slug: string) {
    const item = await this.contentItemRepo.findBySlug(slug);
    if (!item || item.status !== 'PUBLISHED') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Published content item '${slug}' not found`,
      });
    }

    if (item.type === 'TEXT' || item.type === 'IMAGE') {
      throw new UnprocessableEntityException({
        code: 'UNPROCESSABLE',
        message: `Content type '${item.type}' does not support media streaming`,
      });
    }

    if (!item.mediaAssetId) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'No media asset attached to this content item',
      });
    }

    // Signs a URL only for an asset whose bytes were verified in storage;
    // otherwise raises 409 rather than handing out a link that would 404.
    const data = await this.uploadService.issueDownloadUrl(item.mediaAssetId);
    return { data };
  }

  // ── Public Endpoint 5: GET /content/:slug ───────────────────────────────────
  @Get(':slug')
  @ApiOperation({ summary: 'Get published content item details by slug' })
  @ApiResponse({ status: 200, description: 'Content item details' })
  async getContentBySlug(
    @Param('slug') slug: string,
    @Query('locale') locale: string = 'ar',
  ) {
    const item = await this.contentItemRepo.findBySlug(slug);
    if (!item || item.status !== 'PUBLISHED') {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Published content item '${slug}' not found`,
      });
    }

    // Fire-and-forget view count increment
    this.contentItemRepo.incrementViewCount(item.id.value).catch(() => {});

    // Fetch translations for this content item
    const itemTranslations = await this.translationRepo.find({
      where: { entityType: 'content_item', entityId: item.id.value },
    });

    const localizedTrans = itemTranslations
      .filter((t) => t.locale === locale)
      .reduce((acc, curr) => ({ ...acc, [curr.fieldName]: curr.content }), {} as Record<string, string>);

    const availableLocales = Array.from(new Set(itemTranslations.map((t) => t.locale)));

    // Author
    let authorData = null;
    if (item.authorId) {
      const authorTranslations = await this.translationRepo.find({
        where: { entityType: 'author', entityId: item.authorId, locale },
      });
      const aTrans = authorTranslations.reduce((acc, curr) => ({ ...acc, [curr.fieldName]: curr.content }), {} as Record<string, string>);
      authorData = {
        id: item.authorId,
        name: aTrans['name'] || null,
        bio: aTrans['bio'] || null,
      };
    }

    // Category
    let categoryData = null;
    if (item.categoryId) {
      const cat = await this.categoryRepo.findById(item.categoryId);
      if (cat) {
        const catTrans = await this.translationRepo.find({
          where: { entityType: 'category', entityId: cat.id.value, locale },
        });
        const cTrans = catTrans.reduce((acc, curr) => ({ ...acc, [curr.fieldName]: curr.content }), {} as Record<string, string>);
        categoryData = {
          id: cat.id.value,
          slug: cat.slug,
          name: cTrans['name'] || cat.slug,
          parentId: cat.parentId,
        };
      }
    }

    // Media
    let mediaData = null;
    if (item.mediaAssetId) {
      const media = await this.mediaRepo.findById(item.mediaAssetId);
      if (media) {
        mediaData = {
          durationMs: media.durationMs,
          thumbnailUrl: media.cdnUrl,
          mimeType: media.mimeType,
          pageCount: media.pageCount,
          // Whether a verified file exists in storage. Clients use this to
          // decide whether to offer playback, instead of calling the stream
          // endpoint and discovering a 409 in front of the user.
          isAvailable: media.isUploaded,
        };
      }
    }

    return {
      data: {
        id: item.id.value,
        slug: item.slug,
        type: item.type,
        status: item.status,
        primaryLocale: item.primaryLocale,
        title: localizedTrans['title'] || item.slug,
        description: localizedTrans['description'] || null,
        body: item.type === 'TEXT' ? (localizedTrans['body'] || null) : null,
        author: authorData,
        category: categoryData,
        media: mediaData,
        availableLocales: availableLocales.length > 0 ? availableLocales : [item.primaryLocale],
        viewCount: item.viewCount,
        isFeatured: item.isFeatured,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
      },
    };
  }
}
