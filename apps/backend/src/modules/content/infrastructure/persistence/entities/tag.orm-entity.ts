import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/** ct_tags — DB-SCHEMA.md §BC02 */
@Entity({ name: 'ct_tags' })
export class TagOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'slug', length: 100, unique: true })
  slug!: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
