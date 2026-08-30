import {
  Controller, Get, Post, Patch, Delete, Param,
  Body, Query, UseGuards, Req, NotFoundException,
  ConflictException, Inject,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { requireActorId } from './require-actor-id';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import {
  ICategoryRepository,
  CATEGORY_REPOSITORY,
} from '../domain/ports/category.repository';
import {
  IAuthorRepository,
  AUTHOR_REPOSITORY,
} from '../domain/ports/author.repository';
import {
  ITagRepository,
  TAG_REPOSITORY,
} from '../domain/ports/tag.repository';
import { Category } from '../domain/category.entity';
import { Author } from '../domain/author.entity';
import { Tag } from '../domain/tag.entity';
import { UUIDv7 } from '../../../shared/domain/uuid.vo';
import { CreateCategoryDto } from '../application/dtos/create-category.dto';
import { UpdateCategoryDto } from '../application/dtos/update-category.dto';
import { CreateAuthorDto } from '../application/dtos/create-author.dto';
import { UpdateAuthorDto } from '../application/dtos/update-author.dto';
import { CreateTagDto } from '../application/dtos/create-tag.dto';
import { TranslationOrmEntity } from '../infrastructure/persistence/entities/translation.orm-entity';

@ApiTags('Admin Taxonomy')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Editor', 'Admin', 'SuperAdmin')
@ApiBearerAuth()
export class AdminTaxonomyController {
  constructor(
    @Inject(CATEGORY_REPOSITORY)
    private readonly categoryRepo: ICategoryRepository,
    @Inject(AUTHOR_REPOSITORY)
    private readonly authorRepo: IAuthorRepository,
    @Inject(TAG_REPOSITORY)
    private readonly tagRepo: ITagRepository,
    @InjectRepository(TranslationOrmEntity)
    private readonly translationRepo: Repository<TranslationOrmEntity>,
  ) {}

  // ── Categories CRUD ─────────────────────────────────────────────────────────

  @Post('categories')
  @ApiOperation({ summary: 'Create category (Adjacency List)' })
  @ApiResponse({ status: 201, description: 'Category created' })
  async createCategory(@Body() dto: CreateCategoryDto, @Req() req: { user?: JwtPayload }) {
    const userId = requireActorId(req);

    const exists = await this.categoryRepo.existsBySlug(dto.slug);
    if (exists) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Category '${dto.slug}' already exists`,
      });
    }

    const id = UUIDv7.generate();

    const category = Category.create({
      id,
      slug: dto.slug,
      parentId: dto.parentId,
      sortOrder: dto.sortOrder,
    });

    const saved = await this.categoryRepo.save(category);

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        await this.saveTranslation('category', saved.id.value, t.locale, 'name', t.name, userId);
      }
    }

    return {
      data: {
        id: saved.id.value,
        slug: saved.slug,
        parentId: saved.parentId,
        sortOrder: saved.sortOrder,
        createdAt: saved.createdAt,
      },
    };
  }

  @Patch('categories/:id')
  @ApiOperation({ summary: 'Update category' })
  @ApiResponse({ status: 200, description: 'Category updated' })
  async updateCategory(
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
    @Req() req: { user?: JwtPayload },
  ) {
    const userId = requireActorId(req);

    const category = await this.categoryRepo.findById(id);
    if (!category) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Category '${id}' not found`,
      });
    }

    category.update({
      parentId: dto.parentId,
      sortOrder: dto.sortOrder,
    });

    const updated = await this.categoryRepo.update(category);

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        await this.saveTranslation('category', id, t.locale, 'name', t.name, userId);
      }
    }

    return {
      data: {
        id: updated.id.value,
        slug: updated.slug,
        parentId: updated.parentId,
        sortOrder: updated.sortOrder,
        updatedAt: updated.updatedAt,
      },
    };
  }

  @Delete('categories/:id')
  @ApiOperation({ summary: 'Soft-delete category' })
  @ApiResponse({ status: 200, description: 'Category deleted' })
  async deleteCategory(@Param('id') id: string) {
    const category = await this.categoryRepo.findById(id);
    if (!category) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Category '${id}' not found`,
      });
    }

    category.softDelete();
    await this.categoryRepo.softDelete(category);

    return {
      data: { message: 'Category deleted' },
    };
  }

  // ── Authors CRUD ───────────────────────────────────────────────────────────

  @Get('authors')
  @ApiOperation({ summary: 'List authors with offset pagination' })
  @ApiResponse({ status: 200, description: 'Authors list' })
  async listAuthors(
    @Query('page') pageStr = '1',
    @Query('limit') limitStr = '25',
    @Query('locale') locale = 'ar',
  ) {
    const page = Math.max(parseInt(pageStr, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(limitStr, 10) || 25, 1), 100);
    const offset = (page - 1) * limit;

    const { items, total } = await this.authorRepo.findAll({ limit, offset });
    const authorIds = items.map((a) => a.id.value);

    const translations = authorIds.length > 0
      ? await this.translationRepo.find({
          where: { entityType: 'author', locale },
        })
      : [];

    const transMap = new Map<string, Record<string, string>>();
    for (const t of translations) {
      if (!transMap.has(t.entityId)) transMap.set(t.entityId, {});
      transMap.get(t.entityId)![t.fieldName] = t.content;
    }

    const data = items.map((author) => {
      const trans = transMap.get(author.id.value) || {};
      return {
        id: author.id.value,
        slug: author.slug,
        name: trans['name'] || author.slug,
        bio: trans['bio'] || null,
        avatarUrl: author.avatarUrl,
        sortOrder: author.sortOrder,
        createdAt: author.createdAt,
      };
    });

    return {
      data,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  @Post('authors')
  @ApiOperation({ summary: 'Create author' })
  @ApiResponse({ status: 201, description: 'Author created' })
  async createAuthor(@Body() dto: CreateAuthorDto, @Req() req: { user?: JwtPayload }) {
    const userId = requireActorId(req);

    const exists = await this.authorRepo.existsBySlug(dto.slug);
    if (exists) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Author '${dto.slug}' already exists`,
      });
    }

    const id = UUIDv7.generate();

    const author = Author.create({
      id,
      slug: dto.slug,
      avatarUrl: dto.avatarUrl,
      sortOrder: dto.sortOrder,
    });

    const saved = await this.authorRepo.save(author);

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        if (t.name) {
          await this.saveTranslation('author', saved.id.value, t.locale, 'name', t.name, userId);
        }
        if (t.bio) {
          await this.saveTranslation('author', saved.id.value, t.locale, 'bio', t.bio, userId);
        }
      }
    }

    return {
      data: {
        id: saved.id.value,
        slug: saved.slug,
        avatarUrl: saved.avatarUrl,
        sortOrder: saved.sortOrder,
        createdAt: saved.createdAt,
      },
    };
  }

  @Patch('authors/:id')
  @ApiOperation({ summary: 'Update author' })
  @ApiResponse({ status: 200, description: 'Author updated' })
  async updateAuthor(
    @Param('id') id: string,
    @Body() dto: UpdateAuthorDto,
    @Req() req: { user?: JwtPayload },
  ) {
    const userId = requireActorId(req);

    const author = await this.authorRepo.findById(id);
    if (!author) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Author '${id}' not found`,
      });
    }

    author.update({
      avatarUrl: dto.avatarUrl,
      sortOrder: dto.sortOrder,
    });

    const updated = await this.authorRepo.update(author);

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        if (t.name !== undefined) {
          await this.saveTranslation('author', id, t.locale, 'name', t.name, userId);
        }
        if (t.bio !== undefined) {
          await this.saveTranslation('author', id, t.locale, 'bio', t.bio, userId);
        }
      }
    }

    return {
      data: {
        id: updated.id.value,
        slug: updated.slug,
        avatarUrl: updated.avatarUrl,
        sortOrder: updated.sortOrder,
        updatedAt: updated.updatedAt,
      },
    };
  }

  @Delete('authors/:id')
  @ApiOperation({ summary: 'Soft-delete author' })
  @ApiResponse({ status: 200, description: 'Author deleted' })
  async deleteAuthor(@Param('id') id: string) {
    const author = await this.authorRepo.findById(id);
    if (!author) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Author '${id}' not found`,
      });
    }

    author.softDelete();
    await this.authorRepo.softDelete(author);

    return {
      data: { message: 'Author deleted' },
    };
  }

  // ── Tags CRUD ──────────────────────────────────────────────────────────────

  @Post('tags')
  @ApiOperation({ summary: 'Create tag' })
  @ApiResponse({ status: 201, description: 'Tag created' })
  async createTag(@Body() dto: CreateTagDto, @Req() req: { user?: JwtPayload }) {
    const userId = requireActorId(req);

    const exists = await this.tagRepo.existsBySlug(dto.slug);
    if (exists) {
      throw new ConflictException({
        code: 'CONFLICT',
        message: `Tag '${dto.slug}' already exists`,
      });
    }

    const id = UUIDv7.generate();

    const tag = Tag.create({ id, slug: dto.slug });
    const saved = await this.tagRepo.save(tag);

    if (dto.translations && dto.translations.length > 0) {
      for (const t of dto.translations) {
        await this.saveTranslation('tag', saved.id.value, t.locale, 'name', t.name, userId);
      }
    }

    return {
      data: {
        id: saved.id.value,
        slug: saved.slug,
        createdAt: saved.createdAt,
      },
    };
  }

  @Delete('tags/:id')
  @ApiOperation({ summary: 'Hard-delete tag' })
  @ApiResponse({ status: 200, description: 'Tag deleted' })
  async deleteTag(@Param('id') id: string) {
    const tag = await this.tagRepo.findById(id);
    if (!tag) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Tag '${id}' not found`,
      });
    }

    await this.tagRepo.delete(id);

    return {
      data: { message: 'Tag deleted' },
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
