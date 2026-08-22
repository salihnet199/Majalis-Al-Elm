import { Entity, PrimaryColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * RoleOrmEntity — maps id_roles table (Migration 002)
 */
@Entity({ name: 'id_roles' })
export class RoleOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ length: 50, unique: true })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ name: 'is_system', default: true })
  isSystem!: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
