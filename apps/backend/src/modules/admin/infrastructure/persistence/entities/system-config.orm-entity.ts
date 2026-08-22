import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

/**
 * SystemConfigOrmEntity — maps ad_system_config (Migration 041)
 *
 * String PRIMARY KEY (not UUID). Pre-seeded with 4 keys at migration time.
 * Updated only by SuperAdmin via PATCH /api/v1/admin/system/config/:key.
 */
@Entity({ name: 'ad_system_config' })
export class SystemConfigOrmEntity {
  /** String PK — e.g. 'maintenance_mode', 'comment.edit_window_minutes' */
  @PrimaryColumn({ type: 'varchar', length: 100 })
  key!: string;

  @Column({ type: 'jsonb' })
  value!: unknown;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy!: string | null;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
