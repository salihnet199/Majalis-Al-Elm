import {
  Entity,
  PrimaryColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { randomUUID } from 'crypto';

/**
 * AuditLogOrmEntity — maps ad_audit_log (Migration 040)
 *
 * IMMUTABLE by design — no UpdateDateColumn, no DeleteDateColumn.
 * Retention: 7 years per schema spec. Rows are NEVER deleted.
 */
@Entity({ name: 'ad_audit_log' })
export class AuditLogOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'actor_id', type: 'uuid' })
  actorId!: string;

  @Column({ name: 'actor_role', length: 50 })
  actorRole!: string;

  @Column({ name: 'action', length: 100 })
  action!: string;

  @Column({ name: 'entity_type', length: 50, nullable: true })
  entityType!: string | null;

  @Column({ name: 'entity_id', type: 'uuid', nullable: true })
  entityId!: string | null;

  @Column({ name: 'old_value', type: 'jsonb', nullable: true })
  oldValue!: Record<string, unknown> | null;

  @Column({ name: 'new_value', type: 'jsonb', nullable: true })
  newValue!: Record<string, unknown> | null;

  @Column({ name: 'ip_address', type: 'inet', nullable: true })
  ipAddress!: string | null;

  @Column({ name: 'user_agent', type: 'text', nullable: true })
  userAgent!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;
}
