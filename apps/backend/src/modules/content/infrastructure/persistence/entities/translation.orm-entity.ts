import { Entity, PrimaryColumn, Column } from 'typeorm';

/** ct_translations — centralized i18n (DB-SCHEMA.md §BC02) */
@Entity({ name: 'ct_translations' })
export class TranslationOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'entity_type', length: 50 })
  entityType!: string;

  @Column({ name: 'entity_id', type: 'uuid' })
  entityId!: string;

  @Column({ name: 'locale', length: 10 })
  locale!: string;

  @Column({ name: 'field_name', length: 100 })
  fieldName!: string;

  @Column({ name: 'content', type: 'text' })
  content!: string;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy!: string | null;

  @Column({ name: 'updated_at', type: 'timestamptz', default: () => 'NOW()' })
  updatedAt!: Date;
}
