import {
  Entity, PrimaryColumn, Column,
  CreateDateColumn, UpdateDateColumn,
  ManyToOne, ManyToMany, JoinTable, JoinColumn,
} from 'typeorm';
import { AuthorOrmEntity } from './author.orm-entity';
import { CategoryOrmEntity } from './category.orm-entity';
import { MediaAssetOrmEntity } from './media-asset.orm-entity';
import { TagOrmEntity } from './tag.orm-entity';

/** ct_content_items — DB-SCHEMA.md §BC02 */
@Entity({ name: 'ct_content_items' })
export class ContentItemOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'slug', length: 300, unique: true })
  slug!: string;

  @Column({ name: 'type', type: 'enum', enum: ['AUDIO', 'PDF', 'TEXT', 'IMAGE'] })
  type!: string;

  @Column({ name: 'status', type: 'enum', enum: ['DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED'], default: 'DRAFT' })
  status!: string;

  @Column({ name: 'primary_locale', length: 10, default: 'ar' })
  primaryLocale!: string;

  @Column({ name: 'author_id', type: 'uuid', nullable: true })
  authorId!: string | null;

  @ManyToOne(() => AuthorOrmEntity, { nullable: true })
  @JoinColumn({ name: 'author_id' })
  author!: AuthorOrmEntity | null;

  @Column({ name: 'category_id', type: 'uuid', nullable: true })
  categoryId!: string | null;

  @ManyToOne(() => CategoryOrmEntity, { nullable: true })
  @JoinColumn({ name: 'category_id' })
  category!: CategoryOrmEntity | null;

  @Column({ name: 'media_asset_id', type: 'uuid', nullable: true })
  mediaAssetId!: string | null;

  @ManyToOne(() => MediaAssetOrmEntity, { nullable: true })
  @JoinColumn({ name: 'media_asset_id' })
  mediaAsset!: MediaAssetOrmEntity | null;

  @Column({ name: 'view_count', type: 'bigint', default: 0 })
  viewCount!: number;

  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @Column({ name: 'is_featured', type: 'boolean', default: false })
  isFeatured!: boolean;

  @Column({ name: 'published_at', type: 'timestamptz', nullable: true })
  publishedAt!: Date | null;

  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt!: Date | null;

  @Column({ name: 'created_by', type: 'uuid' })
  createdBy!: string;

  @Column({ name: 'last_edited_by', type: 'uuid', nullable: true })
  lastEditedBy!: string | null;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;

  @ManyToMany(() => TagOrmEntity, { eager: false })
  @JoinTable({
    name: 'ct_content_tags',
    joinColumn: { name: 'content_id', referencedColumnName: 'id' },
    inverseJoinColumn: { name: 'tag_id', referencedColumnName: 'id' },
  })
  tags!: TagOrmEntity[];
}
