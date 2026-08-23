import {
  Controller, Get, Post, Patch, Delete, Param, Query,
  Body, UseGuards, Req, NotFoundException,
  ConflictException, UnprocessableEntityException, Inject,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { requireActorId } from './require-actor-id';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import {
  IContentItemRepository,
  CONTENT_ITEM_REPOSITORY,
} from '../domain/ports/content-item.repository';
import { ContentItem, ContentType } from '../domain/content-item.entity';
import { UUIDv7 } from '../../../shared/domain/uuid.vo';
import { CreateContentItemDto } from '../application/dtos/create-content-item.dto';
import { UpdateContentItemDto } from '../application/dtos/update-content-item.dto';
import { TranslationOrmEntity } from '../infrastructure/persistence/entities/translation.orm-entity';
import { ContentItemOrmEntity } from '../infrastructure/persistence/entities/content-item.orm-entity';
import { TagOrmEntity } from '../infrastructure/persistence/entities/tag.orm-entity';

@ApiTags('Admin Content')
@Controller('admin/content')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Editor', 'Admin', 'SuperAdmin')
@ApiBearerAuth()
export class AdminContentController {
  constructor(
    @Inject(CONTENT_ITEM_REPOSITORY)
    private readonly contentItemRepo: IContentItemRepository,
    @InjectRepository(TranslationOrmEntity)
    private readonly translationRepo: Repository<TranslationOrmEntity>,
    @InjectRepository(ContentItemOrmEntity)
    private readonly contentOrmRepo: Repository<ContentItemOrmEntity>,
    @InjectRepository(TagOrmEntity)
    private readonly tagOrmRepo: Repository<TagOrmEntity>,
  ) {}

  /**
   * The editor's list of everything, in every state.
   *
   * The admin list screen was reading `GET /content` — the PUBLIC catalogue. Three
   * consequences, all of them the kind of quiet wrongness that reads as a working
   * screen:
   *
   *   • Only PUBLISHED items exist there, so a draft an editor had just created
   *     was simply absent from the list. Nothing said so.
   *   • That endpoint is cursor-paginated and returns no `total`, so the numeric
   *     pager was inert: page 2 re-fetched page 1 and the count showed 0 items
   *     above a table that had rows in it.
   *   • It honours `type`/`category` and ignores `search`, `status` and `page`, so
   *     three of the screen's four controls did nothing at all.
   *
   * This is the admin projection: every non-deleted item, real total, real
   * page/limit, and the ids the edit form needs — `categoryId`, `authorId`,
   * `mediaAssetId` — which the public shape deliberately does not carry.
   */
  @Get()
  @ApiOperation({ summary: 'List content items in any status, with page/limit and filters' })
  @ApiResponse({ status: 200, description: 'Paginated admin content list' })
  async listContent(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('search') search?: string,
    @Query('locale') locale = 'ar',
  ) {
    const page = Math.max(parseInt(pageStr || '1', 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10) || 20, 1), 100);

    const qb = this.contentOrmRepo
      .createQueryBuilder('item')
      .where('item.deletedAt IS NULL');

    // Unknown filter values are rejected rather than ignored: a status the client
    // invented must not silently return the unfiltered list.
    if (status) {
      if (!['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'].includes(status)) {
        throw new UnprocessableEntityException({
          code: 'UNPROCESSABLE',
          message: `Unknown status filter '${status}'`,
        });
      }
      qb.andWhere('item.status = :status', { status });
    }

    if (type) {
      if (!['AUDIO', 'PDF', 'TEXT', 'IMAGE'].includes(type)) {
        throw new UnprocessableEntityException({
          code: 'UNPROCESSABLE',
          message: `Unknown type filter '${type}'`,
        });
      }
      qb.andWhere('item.type = :type', { type });
    }

    const term = search?.trim();
    if (term) {
      // Slug or translated title, in any locale: an editor searching for an
      // Arabic title must find it even when the row's primary locale is another.
      qb.andWhere(
        `(item.slug ILIKE :term OR item.id IN (
            SELECT t.entity_id FROM ct_translations t
             WHERE t.entity_type = 'content_item'
               AND t.field_name = 'title'
               AND t.content ILIKE :term
          ))`,
        { term: `%${term}%` },
      );
    }

    const [rows, total] = await qb
      .orderBy('item.updatedAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    // Titles for this page only. Requested locale first, primary locale as the
    // documented fallback — and `null` when neither exists, never the slug: a slug
    // shown in the title column looks like a title an editor typed.
    const titles = new Map<string, Record<string, string>>();
    if (rows.length > 0) {
      const translations = await this.translationRepo.find({
        where: {
          entityType: 'content_item',
          entityId: In(rows.map((row) => row.id)),
          fieldName: 'title',
        },
      });
      for (const t of translations) {
        if (!titles.has(t.entityId)) titles.set(t.entityId, {});
        titles.get(t.entityId)![t.locale] = t.content;
      }
    }

    return {
      data: rows.map((row) => {
        const byLocale = titles.get(row.id) ?? {};
        return {
          id: row.id,
          slug: row.slug,
          type: row.type,
          status: row.status,
          primaryLocale: row.primaryLocale,
          title: byLocale[locale] ?? byLocale[row.primaryLocale] ?? null,
          categoryId: row.categoryId,
          authorId: row.authorId,
          mediaAssetId: row.mediaAssetId,
          // bigint arrives from pg as a string; the client counts with it.
          viewCount: Number(row.viewCount ?? 0),
          isFeatured: row.isFeatured,
          publishedAt: row.publishedAt,
          updatedAt: row.updatedAt,
          createdAt: row.createdAt,
        };
      }),
      meta: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  }

  /**
   * The editing form's source of truth for one item.
   *
   * The admin UI previously populated its edit form from `GET /content` — the
   * PUBLIC catalogue. That endpoint returns only PUBLISHED items, shapes them for
   * readers (`{ author, category, media }` objects), and deliberately omits
   * internal ids, so the form was guessing at half its own fields: it could not
   * see a draft at all, and it had no way to know which media asset was attached.
   * A form that guesses its initial values silently overwrites the values it
   * guessed wrong.
   *
   * This returns the admin's view: the real ids, the true status, and the
   * translations as stored, for an item in any state.
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get one content item in admin shape (any status)' })
  @ApiResponse({ status: 200, description: 'Content item' })
  @ApiResponse({ status: 404, description: 'Content item not found' })
  async getContent(@Param('id') id: string) {
    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    const rows = await this.translationRepo.find({
      where: { entityType: 'content_item', entityId: id },
    });

    // locale → { title, description, body }, exactly as stored. No defaults and
    // no fallback to the slug: a missing title must look missing in the form.
    const byLocale = new Map<string, Record<string, string>>();
    for (const row of rows) {
      if (!byLocale.has(row.locale)) byLocale.set(row.locale, {});
      byLocale.get(row.locale)![row.fieldName] = row.content;
    }

    return {
      data: {
        id: item.id.value,
        slug: item.slug,
        type: item.type,
        status: item.status,
        primaryLocale: item.primaryLocale,
        authorId: item.authorId,
        categoryId: item.categoryId,
        mediaAssetId: item.mediaAssetId,
        sortOrder: item.sortOrder,
        isFeatured: item.isFeatured,
        scheduledAt: item.scheduledAt,
        publishedAt: item.publishedAt,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        translations: [...byLocale.entries()].map(([locale, fields]) => ({
          locale,
          title: fields['title'] ?? null,
          description: fields['description'] ?? null,
          body: fields['body'] ?? null,
        })),
      },
    };
  }

  @Post()
  @ApiOperation({ summary: 'Create a new content item in DRAFT state' })
  @ApiResponse({ status: 201, description: 'Content item created' })
  async createContent(@Body() dto: CreateContentItemDto, @Req() req: { user?: JwtPayload }) {
    const userId = this.requireActorId(req);

    const existing = await this.contentItemRepo.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Content item with slug '${dto.slug}' already exists`,
      });
    }

    const id = UUIDv7.generate();

    const item = ContentItem.create({
      id,
      slug: dto.slug,
      type: dto.type as ContentType,
      primaryLocale: dto.primaryLocale,
      authorId: dto.authorId,
      categoryId: dto.categoryId,
      mediaAssetId: dto.mediaAssetId,
      sortOrder: dto.sortOrder,
      isFeatured: dto.isFeatured,
      scheduledAt: dto.scheduledAt ? new Date(dto.scheduledAt) : null,
      createdBy: userId,
    });

    const saved = await this.contentItemRepo.save(item);

    // Save translations
    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        if (t.title) {
          await this.saveTranslation('content_item', saved.id.value, t.locale, 'title', t.title, userId);
        }
        if (t.description) {
          await this.saveTranslation('content_item', saved.id.value, t.locale, 'description', t.description, userId);
        }
        if (t.body) {
          await this.saveTranslation('content_item', saved.id.value, t.locale, 'body', t.body, userId);
        }
      }
    }

    // Save tags junction if any
    if (dto.tagIds && dto.tagIds.length > 0) {
      const ormEntity = await this.contentOrmRepo.findOne({
        where: { id: saved.id.value },
        relations: ['tags'],
      });
      if (ormEntity) {
        const tags = await this.tagOrmRepo.findByIds(dto.tagIds);
        ormEntity.tags = tags;
        await this.contentOrmRepo.save(ormEntity);
      }
    }

    return {
      data: {
        id: saved.id.value,
        slug: saved.slug,
        type: saved.type,
        status: saved.status,
        createdAt: saved.createdAt,
      },
    };
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update content item metadata' })
  @ApiResponse({ status: 200, description: 'Content item updated' })
  async updateContent(
    @Param('id') id: string,
    @Body() dto: UpdateContentItemDto,
    @Req() req: { user?: JwtPayload },
  ) {
    const userId = this.requireActorId(req);

    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    item.update({
      authorId: dto.authorId,
      categoryId: dto.categoryId,
      mediaAssetId: dto.mediaAssetId,
      sortOrder: dto.sortOrder,
      isFeatured: dto.isFeatured,
      scheduledAt: dto.scheduledAt !== undefined ? (dto.scheduledAt ? new Date(dto.scheduledAt) : null) : undefined,
      editedBy: userId,
    });

    const updated = await this.contentItemRepo.update(item);

    // Update translations
    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        if (t.title !== undefined) {
          await this.saveTranslation('content_item', id, t.locale, 'title', t.title, userId);
        }
        if (t.description !== undefined) {
          await this.saveTranslation('content_item', id, t.locale, 'description', t.description, userId);
        }
        if (t.body !== undefined) {
          await this.saveTranslation('content_item', id, t.locale, 'body', t.body, userId);
        }
      }
    }

    // Update tags
    if (dto.tagIds !== undefined) {
      const ormEntity = await this.contentOrmRepo.findOne({
        where: { id },
        relations: ['tags'],
      });
      if (ormEntity) {
        const tags = dto.tagIds.length > 0 ? await this.tagOrmRepo.findByIds(dto.tagIds) : [];
        ormEntity.tags = tags;
        await this.contentOrmRepo.save(ormEntity);
      }
    }

    return {
      data: {
        id: updated.id.value,
        slug: updated.slug,
        type: updated.type,
        status: updated.status,
        authorId: updated.authorId,
        categoryId: updated.categoryId,
        mediaAssetId: updated.mediaAssetId,
        sortOrder: updated.sortOrder,
        isFeatured: updated.isFeatured,
        scheduledAt: updated.scheduledAt,
        updatedAt: updated.updatedAt,
      },
    };
  }

  @Post(':id/submit-review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition content status from DRAFT to REVIEW' })
  @ApiResponse({ status: 200, description: 'Submitted for review' })
  async submitReview(@Param('id') id: string) {
    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    try {
      item.submitForReview();
    } catch (err: any) {
      throw new UnprocessableEntityException({
        code: 'UNPROCESSABLE',
        message: err.message,
      });
    }

    const updated = await this.contentItemRepo.update(item);
    return {
      data: {
        id: updated.id.value,
        status: updated.status,
      },
    };
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition content status from REVIEW to PUBLISHED' })
  @ApiResponse({ status: 200, description: 'Content published' })
  async publishContent(@Param('id') id: string) {
    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    try {
      item.publish();
    } catch (err: any) {
      throw new UnprocessableEntityException({
        code: 'UNPROCESSABLE',
        message: err.message,
      });
    }

    const updated = await this.contentItemRepo.update(item);
    return {
      data: {
        id: updated.id.value,
        status: updated.status,
        publishedAt: updated.publishedAt,
      },
    };
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Transition content status from PUBLISHED to ARCHIVED' })
  @ApiResponse({ status: 200, description: 'Content archived' })
  async archiveContent(@Param('id') id: string) {
    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    try {
      item.archive();
    } catch (err: any) {
      throw new UnprocessableEntityException({
        code: 'UNPROCESSABLE',
        message: err.message,
      });
    }

    const updated = await this.contentItemRepo.update(item);
    return {
      data: {
        id: updated.id.value,
        status: updated.status,
      },
    };
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete content item' })
  @ApiResponse({ status: 200, description: 'Content item soft-deleted' })
  async deleteContent(@Param('id') id: string) {
    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    item.softDelete();
    await this.contentItemRepo.softDelete(item);

    return {
      data: {
        message: 'Content item deleted',
      },
    };
  }

  /**
   * The id recorded as `created_by` / `edited_by` on everything this controller
   * writes. See require-actor-id.ts for why there is no fallback value.
   */
  private requireActorId(req: { user?: JwtPayload }): string {
    return requireActorId(req);
  }

  private async saveTranslation(
    entityType: string,
    entityId: string,
    locale: string,
    fieldName: string,
    content: string,
    userId: string,
  ): Promise<void> {
    const existing = await this.translationRepo.findOne({
      where: { entityType, entityId, locale, fieldName },
    });

    if (existing) {
      existing.content = content;
      existing.updatedAt = new Date();
      await this.translationRepo.save(existing);
    } else {
      const trans = this.translationRepo.create({
        id: UUIDv7.generate().value,
        entityType,
        entityId,
        locale,
        fieldName,
        content,
        createdBy: userId,
      });
      await this.translationRepo.save(trans);
    }
  }
}
