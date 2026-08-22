import { Category } from '../category.entity';

export interface ICategoryRepository {
  findAll(): Promise<Category[]>;
  findBySlug(slug: string): Promise<Category | null>;
  findById(id: string): Promise<Category | null>;
  findChildren(parentId: string): Promise<Category[]>;
  save(category: Category): Promise<Category>;
  update(category: Category): Promise<Category>;
  softDelete(category: Category): Promise<void>;
  existsBySlug(slug: string): Promise<boolean>;
}

export const CATEGORY_REPOSITORY = Symbol('ICategoryRepository');
