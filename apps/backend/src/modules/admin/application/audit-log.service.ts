import { Injectable } from '@nestjs/common';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { AuditLogOrmEntity } from '../infrastructure/persistence/entities/audit-log.orm-entity';

export interface AuditLogEntry {
  actorId: string;
  actorRole: string;
  action: string;
  entityType?: string;
  entityId?: string;
  oldValue?: Record<string, unknown>;
  newValue?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * AuditLogService — BC05
 *
 * Dual responsibility:
 *  1. Write: log() — called from SystemConfigService (inside TX) and
 *     AdminUsersController (standalone INSERT).
 *  2. Read:  list() — admin dashboard pagination with optional filters.
 *
 * Cross-BC actor enrichment: a single SELECT per page from id_users
 * enriches actor name. UUID-only reference — no FK import (ADR-002).
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly dataSource: DataSource) {}

  /**
   * Inserts one audit log record.
   *
   * @param entry   The event details.
   * @param manager Optional EntityManager — pass the TX manager when this call
   *                must be atomic with a surrounding transaction (e.g. system
   *                config update). When omitted, a standalone INSERT is issued.
   *
   * ip_address is normalised before INSERT:
   *   • IPv4-mapped IPv6 "::ffff:1.2.3.4" → "1.2.3.4" (PostgreSQL INET
   *     accepts both forms, but stripping the prefix ensures clean storage
   *     and consistent querying).
   *   • Proxy / express req.ip can produce the mapped form — normalised here
   *     so callers need not care.
   */
  async log(entry: AuditLogEntry, manager?: EntityManager): Promise<void> {
    const repo: Repository<AuditLogOrmEntity> = manager
      ? manager.getRepository(AuditLogOrmEntity)
      : this.dataSource.getRepository(AuditLogOrmEntity);

    await repo.insert({
      id: randomUUID(),
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      action: entry.action,
      entityType: entry.entityType ?? null,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      ipAddress: this.normalizeIp(entry.ipAddress),
      userAgent: entry.userAgent ?? null,
    });
  }

  /**
   * Normalizes a raw IP string for storage in a PostgreSQL INET column.
   *
   * Handles the IPv4-mapped IPv6 format (::ffff:x.x.x.x) produced by
   * Node.js/Express when the server accepts dual-stack connections, and by
   * Nginx when it passes X-Real-IP in mapped form.
   *
   * Returns null for undefined/empty input — acceptable for internal requests
   * where no IP header is present.
   *
   * TODO [Phase 2 — TECH-DEBT-001]: لا يتحقق هذا الـ method من صحة تنسيق IP
   * بعد stripping. آمن حالياً لأن المصدر الوحيد هو req.ip من Express أو
   * x-real-ip من Nginx — كلاهما موثوق ولا يأتي من مدخل مستخدم خارجي.
   * قبل فتح أي مصدر IP خارجي غير موثوق (مثل إضافة IP من request body أو
   * header مخصص)، أضف تحقق صريح:
   *   import { isIPv4, isIPv6 } from 'net';
   *   return (isIPv4(stripped) || isIPv6(stripped)) ? stripped : null;
   * بدون هذا، قيمة مثل "::ffff:not-an-ip" ستُمرَّر وستفشل عند INET cast
   * في PostgreSQL وقت التنفيذ.
   */
  private normalizeIp(raw?: string): string | null {
    if (!raw) return null;
    // Strip IPv4-mapped IPv6 prefix: "::ffff:1.2.3.4" → "1.2.3.4"
    const stripped = raw.replace(/^::ffff:/i, '');
    // No format validation here — see TODO above before adding untrusted IP sources
    return stripped.length > 0 ? stripped : null;
  }

  /**
   * Paginated audit log listing with optional filter combination.
   * Enriches each entry with the actor's full_name from id_users in a
   * single query per page (acceptable N+1 for admin-only endpoint).
   */
  async list(filters: {
    action?: string;
    actorId?: string;
    entityType?: string;
    entityId?: string;
    from?: string;
    to?: string;
    page: number;
    limit: number;
  }) {
    const { page, limit, action, actorId, entityType, entityId, from, to } = filters;
    const skip = (page - 1) * limit;

    const qb = this.dataSource
      .getRepository(AuditLogOrmEntity)
      .createQueryBuilder('log')
      .orderBy('log.createdAt', 'DESC')
      .skip(skip)
      .take(limit);

    if (action)     qb.andWhere('log.action = :action', { action });
    if (actorId)    qb.andWhere('log.actorId = :actorId', { actorId });
    if (entityType) qb.andWhere('log.entityType = :entityType', { entityType });
    if (entityId)   qb.andWhere('log.entityId = :entityId', { entityId });
    if (from)       qb.andWhere('log.createdAt >= :from', { from });
    if (to)         qb.andWhere('log.createdAt <= :to', { to });

    const [items, total] = await qb.getManyAndCount();

    // Cross-BC: enrich actor full_name from id_users — single query per page
    const uniqueActorIds = [...new Set(items.map((i) => i.actorId))];
    const actors: { id: string; full_name: string }[] =
      uniqueActorIds.length > 0
        ? await this.dataSource.query(
            `SELECT id, full_name FROM id_users WHERE id = ANY($1)`,
            [uniqueActorIds],
          )
        : [];
    const actorMap = new Map(actors.map((a) => [a.id, a.full_name]));

    return {
      data: items.map((log) => ({
        id: log.id,
        actor: {
          id: log.actorId,
          name: actorMap.get(log.actorId) ?? null,
          role: log.actorRole,
        },
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        oldValue: log.oldValue,
        newValue: log.newValue,
        ipAddress: log.ipAddress,
        createdAt: log.createdAt,
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
