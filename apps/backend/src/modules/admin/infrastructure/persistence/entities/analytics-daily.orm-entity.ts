import { Entity, PrimaryColumn, Column } from 'typeorm';

/**
 * AnalyticsDailyOrmEntity — maps ad_analytics_daily (Migration 042)
 *
 * Composite PRIMARY KEY on (date, metric, dimensionKey, dimensionValue).
 * dimensionKey/dimensionValue default '' (empty string) per DB-SCHEMA correction
 * — PostgreSQL does not support COALESCE() in PRIMARY KEY definitions.
 *
 * Phase 1 note: table is kept empty. Analytics endpoints read directly
 * from source tables (id_users, ct_content_items) via DataSource.query().
 * This table will be populated by a cron job when data volume grows (ADR-003).
 */
@Entity({ name: 'ad_analytics_daily' })
export class AnalyticsDailyOrmEntity {
  @PrimaryColumn({ type: 'date' })
  date!: string;

  @PrimaryColumn({ type: 'varchar', length: 100 })
  metric!: string;

  @PrimaryColumn({ name: 'dimension_key', type: 'varchar', length: 100, default: '' })
  dimensionKey!: string;

  @PrimaryColumn({ name: 'dimension_value', type: 'varchar', length: 200, default: '' })
  dimensionValue!: string;

  @Column({ type: 'bigint', default: 0 })
  value!: number;
}
