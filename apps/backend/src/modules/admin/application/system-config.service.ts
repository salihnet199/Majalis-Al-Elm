import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { SystemConfigOrmEntity } from '../infrastructure/persistence/entities/system-config.orm-entity';
import { AuditLogService } from './audit-log.service';
import { AUDIT_ACTIONS } from '../domain/models/admin-enums';

/**
 * SystemConfigService — BC05
 *
 * Manages the ad_system_config key-value store.
 *
 * In-memory cache strategy:
 * ─────────────────────────
 * • onModuleInit() pre-loads ALL config rows into the cache on startup.
 *   This guarantees getConfigValue() never returns undefined for a key
 *   that exists in the DB but hasn't been touched since boot.
 * • update() refreshes the cache entry after a successful TX commit.
 * • The cache is intentionally NOT invalidated on other nodes (single-instance
 *   Phase 1 deployment on one VPS — ADR-007). Multi-instance invalidation
 *   via Redis pub/sub is documented as Phase 2 work.
 *
 * PATCH /admin/system/config/:key atomically:
 *   1. Updates the DB row
 *   2. Inserts an audit_log entry (same TX)
 *   3. Refreshes the in-memory cache
 */
@Injectable()
export class SystemConfigService implements OnModuleInit {
  private cache = new Map<string, unknown>();

  constructor(
    @InjectRepository(SystemConfigOrmEntity)
    private readonly repo: Repository<SystemConfigOrmEntity>,
    private readonly dataSource: DataSource,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * Pre-load ALL config rows into the in-memory cache at module startup.
   * Runs once before the application starts accepting HTTP requests.
   */
  async onModuleInit(): Promise<void> {
    const all = await this.repo.find();
    for (const row of all) {
      this.cache.set(row.key, row.value);
    }
  }

  async findAll(): Promise<SystemConfigOrmEntity[]> {
    return this.repo.find({ order: { key: 'ASC' } });
  }

  async findOne(key: string): Promise<SystemConfigOrmEntity> {
    const row = await this.repo.findOne({ where: { key } });
    if (!row) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `System config key '${key}' not found`,
      });
    }
    return row;
  }

  async update(
    key: string,
    newValue: unknown,
    actor: {
      id: string;
      role: string;
      ipAddress?: string;
      userAgent?: string;
    },
  ): Promise<SystemConfigOrmEntity> {
    return this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(SystemConfigOrmEntity, { where: { key } });
      if (!existing) {
        throw new NotFoundException({
          code: 'NOT_FOUND',
          message: `System config key '${key}' not found`,
        });
      }

      const oldValue = existing.value;

      await manager.update(SystemConfigOrmEntity, { key }, {
        value: newValue,
        updatedBy: actor.id,
      });

      // AuditLog inside the same transaction — atomically committed or rolled back
      await this.auditLogService.log(
        {
          actorId: actor.id,
          actorRole: actor.role,
          action: AUDIT_ACTIONS.SYSTEM_CONFIG_UPDATE,
          entityType: 'system_config',
          entityId: null,
          oldValue: { key, value: oldValue },
          newValue: { key, value: newValue },
          ipAddress: actor.ipAddress,
          userAgent: actor.userAgent,
        },
        manager, // ← same TX manager
      );

      // Refresh cache after successful TX
      this.cache.set(key, newValue);

      const updated = await manager.findOne(SystemConfigOrmEntity, { where: { key } });
      if (!updated) {
        throw new Error(`System config '${key}' vanished immediately after update() succeeded`);
      }
      return updated;
    });
  }

  /**
   * Fast cache lookup — used by MaintenanceModeGuard (Phase 2).
   * Always populated after onModuleInit(), so never returns undefined
   * for a key seeded at migration time.
   */
  getConfigValue(key: string): unknown {
    return this.cache.get(key);
  }
}
