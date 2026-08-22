import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { AuthorOrmEntity } from './entities/author.orm-entity';
import { TranslationOrmEntity } from './entities/translation.orm-entity';
import { IAuthorRepository } from '../../domain/ports/author.repository';
import { Author } from '../../domain/author.entity';

@Injectable()
export class TypeOrmAuthorRepository implements IAuthorRepository {
  constructor(
    @InjectRepository(AuthorOrmEntity)
    private readonly authorRepo: Repository<AuthorOrmEntity>,
    @InjectRepository(TranslationOrmEntity)
    private readonly translationRepo: Repository<TranslationOrmEntity>,
  ) {}

  async findAll(params: { limit: number; offset: number }): Promise<{ items: Author[]; total: number }> {
    const [records, total] = await this.authorRepo.findAndCount({
      where: { deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'DESC' },
      take: params.limit,
      skip: params.offset,
    });

    return {
      items: records.map(this.toDomain),
      total,
    };
  }

  async findById(id: string): Promise<Author | null> {
    const record = await this.authorRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    return record ? this.toDomain(record) : null;
  }

  async findBySlug(slug: string): Promise<Author | null> {
    const record = await this.authorRepo.findOne({
      where: { slug, deletedAt: IsNull() },
    });
    return record ? this.toDomain(record) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.authorRepo.count({
      where: { slug, deletedAt: IsNull() },
    });
    return count > 0;
  }

  async save(author: Author): Promise<Author> {
    const entity = this.authorRepo.create({
      id: author.id.value,
      slug: author.slug,
      avatarUrl: author.avatarUrl,
      sortOrder: author.sortOrder,
      deletedAt: author.deletedAt,
      createdAt: author.createdAt,
      updatedAt: author.updatedAt,
    });
    const saved = await this.authorRepo.save(entity);
    return this.toDomain(saved);
  }

  async update(author: Author): Promise<Author> {
    await this.authorRepo.update(author.id.value, {
      avatarUrl: author.avatarUrl,
      sortOrder: author.sortOrder,
      deletedAt: author.deletedAt,
      updatedAt: author.updatedAt,
    });
    const updated = await this.findById(author.id.value);
    return updated!;
  }

  async softDelete(author: Author): Promise<void> {
    await this.authorRepo.update(author.id.value, {
      deletedAt: author.deletedAt ?? new Date(),
      updatedAt: new Date(),
    });
  }

  private toDomain(orm: AuthorOrmEntity): Author {
    return Author.reconstitute({
      id: orm.id,
      slug: orm.slug,
      avatarUrl: orm.avatarUrl,
      sortOrder: orm.sortOrder,
      deletedAt: orm.deletedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
}
