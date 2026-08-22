import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { CategoryOrmEntity } from './entities/category.orm-entity';
import { ICategoryRepository } from '../../domain/ports/category.repository';
import { Category } from '../../domain/category.entity';

@Injectable()
export class TypeOrmCategoryRepository implements ICategoryRepository {
  constructor(
    @InjectRepository(CategoryOrmEntity)
    private readonly categoryRepo: Repository<CategoryOrmEntity>,
  ) {}

  async findAll(): Promise<Category[]> {
    const records = await this.categoryRepo.find({
      where: { deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return records.map(this.toDomain);
  }

  async findBySlug(slug: string): Promise<Category | null> {
    const record = await this.categoryRepo.findOne({
      where: { slug, deletedAt: IsNull() },
    });
    return record ? this.toDomain(record) : null;
  }

  async findById(id: string): Promise<Category | null> {
    const record = await this.categoryRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    return record ? this.toDomain(record) : null;
  }

  async findChildren(parentId: string): Promise<Category[]> {
    const records = await this.categoryRepo.find({
      where: { parentId, deletedAt: IsNull() },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return records.map(this.toDomain);
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.categoryRepo.count({
      where: { slug, deletedAt: IsNull() },
    });
    return count > 0;
  }

  async save(category: Category): Promise<Category> {
    const entity = this.categoryRepo.create({
      id: category.id.value,
      slug: category.slug,
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      deletedAt: category.deletedAt,
      createdAt: category.createdAt,
      updatedAt: category.updatedAt,
    });
    const saved = await this.categoryRepo.save(entity);
    return this.toDomain(saved);
  }

  async update(category: Category): Promise<Category> {
    await this.categoryRepo.update(category.id.value, {
      parentId: category.parentId,
      sortOrder: category.sortOrder,
      deletedAt: category.deletedAt,
      updatedAt: category.updatedAt,
    });
    const updated = await this.findById(category.id.value);
    return updated!;
  }

  async softDelete(category: Category): Promise<void> {
    await this.categoryRepo.update(category.id.value, {
      deletedAt: category.deletedAt ?? new Date(),
      updatedAt: new Date(),
    });
  }

  private toDomain(orm: CategoryOrmEntity): Category {
    return Category.reconstitute({
      id: orm.id,
      slug: orm.slug,
      parentId: orm.parentId,
      sortOrder: orm.sortOrder,
      deletedAt: orm.deletedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
}
