import {
  Controller, Post, Patch, Delete, Param,
  Body, UseGuards, Req, NotFoundException,
  ConflictException, UnprocessableEntityException, Inject,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
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

  @Post()
  @ApiOperation({ summary: 'Create a new content item in DRAFT state' })
  @ApiResponse({ status: 201, description: 'Content item created' })
  async createContent(@Body() dto: CreateContentItemDto, @Req() req: any) {
    const existing = await this.contentItemRepo.findBySlug(dto.slug);
    if (existing) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Content item with slug '${dto.slug}' already exists`,
      });
    }

    const userId = req.user?.sub || '00000000-0000-7000-8000-000000000000';
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
    @Req() req: any,
  ) {
    const item = await this.contentItemRepo.findById(id);
    if (!item) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Content item '${id}' not found`,
      });
    }

    const userId = req.user?.sub || '00000000-0000-7000-8000-000000000000';

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
