import { Author } from '../author.entity';

export interface IAuthorRepository {
  findAll(params: { limit: number; offset: number }): Promise<{ items: Author[]; total: number }>;
  findById(id: string): Promise<Author | null>;
  findBySlug(slug: string): Promise<Author | null>;
  save(author: Author): Promise<Author>;
  update(author: Author): Promise<Author>;
  softDelete(author: Author): Promise<void>;
  existsBySlug(slug: string): Promise<boolean>;
}

export const AUTHOR_REPOSITORY = Symbol('IAuthorRepository');
