import { Tag } from '../tag.entity';

export interface ITagRepository {
  findAll(): Promise<Tag[]>;
  findById(id: string): Promise<Tag | null>;
  findBySlug(slug: string): Promise<Tag | null>;
  save(tag: Tag): Promise<Tag>;
  delete(id: string): Promise<void>;
  existsBySlug(slug: string): Promise<boolean>;
}

export const TAG_REPOSITORY = Symbol('ITagRepository');
