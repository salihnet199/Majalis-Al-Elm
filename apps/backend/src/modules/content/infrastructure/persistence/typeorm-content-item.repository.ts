import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { ContentItemOrmEntity } from './entities/content-item.orm-entity';
import { TagOrmEntity } from './entities/tag.orm-entity';
import { TranslationOrmEntity } from './entities/translation.orm-entity';
import { CategoryOrmEntity } from './entities/category.orm-entity';
import {
  IContentItemRepository,
  ContentItemFilter,
  ContentItemPage,
} from '../../domain/ports/content-item.repository';
import { ContentItem, ContentType, ContentStatus } from '../../domain/content-item.entity';

@Injectable()
export class TypeOrmContentItemRepository implements IContentItemRepository {
  constructor(
    @InjectRepository(ContentItemOrmEntity)
    private readonly contentRepo: Repository<ContentItemOrmEntity>,
    @InjectRepository(TranslationOrmEntity)
    private readonly translationRepo: Repository<TranslationOrmEntity>,
    @InjectRepository(CategoryOrmEntity)
    private readonly categoryRepo: Repository<CategoryOrmEntity>,
    @InjectRepository(TagOrmEntity)
    private readonly tagRepo: Repository<TagOrmEntity>,
  ) {}

  async findPublished(filter: ContentItemFilter): Promise<ContentItemPage> {
    const qb = this.contentRepo
      .createQueryBuilder('item')
      .leftJoinAndSelect('item.author', 'author')
      .leftJoinAndSelect('item.category', 'category')
      .leftJoinAndSelect('item.mediaAsset', 'media')
      .where('item.status = :status', { status: 'PUBLISHED' })
      .andWhere('item.deletedAt IS NULL');

    if (filter.type) {
      qb.andWhere('item.type = :type', { type: filter.type });
    }

    if (filter.categorySlug) {
      qb.andWhere('category.slug = :catSlug', { catSlug: filter.categorySlug });
    }

    if (filter.cursor) {
      try {
        const decoded = Buffer.from(filter.cursor, 'base64').toString('utf-8');
        const cursorData = JSON.parse(decoded);
        if (cursorData.publishedAt && cursorData.id) {
          qb.andWhere(
            '(item.publishedAt < :cursorDate OR (item.publishedAt = :cursorDate AND item.id < :cursorId))',
            { cursorDate: cursorData.publishedAt, cursorId: cursorData.id },
          );
        }
      } catch {
        // invalid cursor, ignore and fetch first page
      }
    }

    qb.orderBy('item.publishedAt', 'DESC').addOrderBy('item.id', 'DESC');
    qb.take(filter.limit + 1);

    const records = await qb.getMany();
    const hasMore = records.length > filter.limit;
    const items = hasMore ? records.slice(0, filter.limit) : records;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const lastItem = items[items.length - 1];
      const payload = JSON.stringify({
        publishedAt: lastItem.publishedAt,
        id: lastItem.id,
      });
      nextCursor = Buffer.from(payload).toString('base64');
    }

    return {
      items: items.map(this.toDomain),
      nextCursor,
      prevCursor: null,
    };
  }

  async findBySlug(slug: string): Promise<ContentItem | null> {
    const record = await this.contentRepo.findOne({
      where: { slug, deletedAt: IsNull() },
      relations: ['author', 'category', 'mediaAsset', 'tags'],
    });
    return record ? this.toDomain(record) : null;
  }

  async findById(id: string): Promise<ContentItem | null> {
    const record = await this.contentRepo.findOne({
      where: { id, deletedAt: IsNull() },
      relations: ['author', 'category', 'mediaAsset', 'tags'],
    });
    return record ? this.toDomain(record) : null;
  }

  async save(item: ContentItem): Promise<ContentItem> {
    const entity = this.contentRepo.create({
      id: item.id.value,
      slug: item.slug,
      type: item.type,
      status: item.status,
      primaryLocale: item.primaryLocale,
      authorId: item.authorId,
      categoryId: item.categoryId,
      mediaAssetId: item.mediaAssetId,
      viewCount: item.viewCount,
      sortOrder: item.sortOrder,
      isFeatured: item.isFeatured,
      publishedAt: item.publishedAt,
      scheduledAt: item.scheduledAt,
      createdBy: item.createdBy,
      lastEditedBy: item.lastEditedBy,
      deletedAt: item.deletedAt,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    });

    const saved = await this.contentRepo.save(entity);
    return this.toDomain(saved);
  }

  async update(item: ContentItem): Promise<ContentItem> {
    await this.contentRepo.update(item.id.value, {
      status: item.status,
      authorId: item.authorId,
      categoryId: item.categoryId,
      mediaAssetId: item.mediaAssetId,
      sortOrder: item.sortOrder,
      isFeatured: item.isFeatured,
      publishedAt: item.publishedAt,
      scheduledAt: item.scheduledAt,
      lastEditedBy: item.lastEditedBy,
      deletedAt: item.deletedAt,
      updatedAt: item.updatedAt,
    });
    const updated = await this.findById(item.id.value);
    return updated!;
  }

  async softDelete(item: ContentItem): Promise<void> {
    await this.contentRepo.update(item.id.value, {
      deletedAt: item.deletedAt ?? new Date(),
      updatedAt: new Date(),
    });
  }

  async incrementViewCount(id: string): Promise<void> {
    await this.contentRepo.increment({ id }, 'viewCount', 1);
  }

  private toDomain(orm: ContentItemOrmEntity): ContentItem {
    return ContentItem.reconstitute({
      id: orm.id,
      slug: orm.slug,
      type: orm.type as ContentType,
      status: orm.status as ContentStatus,
      primaryLocale: orm.primaryLocale,
      authorId: orm.authorId,
      categoryId: orm.categoryId,
      mediaAssetId: orm.mediaAssetId,
      viewCount: Number(orm.viewCount),
      sortOrder: orm.sortOrder,
      isFeatured: orm.isFeatured,
      publishedAt: orm.publishedAt,
      scheduledAt: orm.scheduledAt,
      createdBy: orm.createdBy,
      lastEditedBy: orm.lastEditedBy,
      deletedAt: orm.deletedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
}
