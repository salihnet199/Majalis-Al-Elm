import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TagOrmEntity } from './entities/tag.orm-entity';
import { ITagRepository } from '../../domain/ports/tag.repository';
import { Tag } from '../../domain/tag.entity';

@Injectable()
export class TypeOrmTagRepository implements ITagRepository {
  constructor(
    @InjectRepository(TagOrmEntity)
    private readonly tagRepo: Repository<TagOrmEntity>,
  ) {}

  async findAll(): Promise<Tag[]> {
    const records = await this.tagRepo.find({
      order: { createdAt: 'ASC' },
    });
    return records.map(this.toDomain);
  }

  async findById(id: string): Promise<Tag | null> {
    const record = await this.tagRepo.findOne({ where: { id } });
    return record ? this.toDomain(record) : null;
  }

  async findBySlug(slug: string): Promise<Tag | null> {
    const record = await this.tagRepo.findOne({ where: { slug } });
    return record ? this.toDomain(record) : null;
  }

  async existsBySlug(slug: string): Promise<boolean> {
    const count = await this.tagRepo.count({ where: { slug } });
    return count > 0;
  }

  async save(tag: Tag): Promise<Tag> {
    const entity = this.tagRepo.create({
      id: tag.id.value,
      slug: tag.slug,
      createdAt: tag.createdAt,
    });
    const saved = await this.tagRepo.save(entity);
    return this.toDomain(saved);
  }

  async delete(id: string): Promise<void> {
    await this.tagRepo.delete(id);
  }

  private toDomain(orm: TagOrmEntity): Tag {
    return Tag.reconstitute({
      id: orm.id,
      slug: orm.slug,
      createdAt: orm.createdAt,
    });
  }
}
