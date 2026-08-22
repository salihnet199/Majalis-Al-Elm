import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { AnnouncementOrmEntity } from '../infrastructure/persistence/entities/announcement.orm-entity';
import { NotificationOrmEntity } from '../infrastructure/persistence/entities/notification.orm-entity';
import { CreateAnnouncementDto } from './dtos/create-announcement.dto';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { NotificationChannel, NotificationStatus } from '../domain/models/notification-enums';

@Injectable()
export class AnnouncementService {
  constructor(
    @InjectRepository(AnnouncementOrmEntity)
    private readonly announcementRepo: Repository<AnnouncementOrmEntity>,
    @InjectRepository(NotificationOrmEntity)
    private readonly notificationRepo: Repository<NotificationOrmEntity>,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Creates an announcement and fans-out QUEUED notification records to all
   * target users within a single database transaction (Transactional Outbox).
   *
   * Architecture notes:
   * ─────────────────
   * • Everything runs inside ONE DB transaction — the announcement row and all
   *   notification rows are committed atomically. No dual-write risk.
   * • The Admin who creates the announcement is NOT excluded from the target
   *   user set — they receive a notification like any other active user, which
   *   is the expected UX ("you'll see it in your own bell too").
   * • The background NotificationDispatcherWorker picks up QUEUED rows on its
   *   next 10-second cycle and transitions them to SENT/FAILED.
   *
   * Scaling limitation (deliberate — documented per review request):
   * ────────────────────────────────────────────────────────────────
   * The SELECT + bulk INSERT below load ALL active user IDs into memory and
   * insert one notification row per user in a single statement. This is
   * designed for the current project scale of up to ~10,000 users, where:
   *   • The SELECT returns ≤10K UUIDs (~360 KB of data).
   *   • The bulk INSERT generates ≤10K rows in one round-trip.
   *   • Total TX duration stays well under PostgreSQL's statement_timeout.
   *
   * When the platform grows to hundreds of thousands of users, this MUST be
   * refactored into a **batched fan-out**:
   *   1. Use a cursor-based SELECT (DECLARE CURSOR / FETCH 1000) or
   *      keyset pagination (WHERE id > :lastId ORDER BY id LIMIT 1000).
   *   2. Chunk the INSERT into batches of ~1,000 rows per statement.
   *   3. Optionally move the fan-out to an async job (BullMQ) so the HTTP
   *      response returns immediately with the announcement ID, and fan-out
   *      happens in the background.
   * See ADR-003 (Scale-Out Strategy) for the migration path.
   */
  async create(dto: CreateAnnouncementDto, user: JwtPayload) {
    const target = dto.target || 'ALL';

    return this.dataSource.transaction(async (manager) => {
      // ── Step 1: Persist the announcement record ──────────────────────
      const announcement = manager.create(AnnouncementOrmEntity, {
        id: randomUUID(),
        title: dto.title,
        body: dto.body,
        target,
        createdBy: user.sub,
        sentAt: new Date(),
      });
      const saved = await manager.save(AnnouncementOrmEntity, announcement);

      // ── Step 2: Fan-out — query target users & bulk-insert QUEUED rows ──
      //    Cross-BC reference: UUID-only, no FK import from identity module (ADR-002).
      //    Only active users: not suspended (is_suspended=FALSE), not soft-deleted (deleted_at IS NULL).
      //
      //    ⚠ SCALING NOTE: This unbounded SELECT is intentional for ≤~10K users.
      //    For growth beyond that threshold, convert to cursor/keyset pagination
      //    with chunked inserts — see the method-level JSDoc above.
      let targetUserIds: string[];

      if (target === 'ALL') {
        const rows: { id: string }[] = await manager.query(
          `SELECT id FROM id_users WHERE is_suspended = FALSE AND deleted_at IS NULL`,
        );
        targetUserIds = rows.map((r) => r.id);
      } else {
        // Future: segmented target (e.g., 'role:Editor') — for now fall back to ALL
        const rows: { id: string }[] = await manager.query(
          `SELECT id FROM id_users WHERE is_suspended = FALSE AND deleted_at IS NULL`,
        );
        targetUserIds = rows.map((r) => r.id);
      }

      if (targetUserIds.length > 0) {
        // Bulk insert via a single multi-row INSERT (TypeORM .insert()).
        // Avoids N individual save() round-trips — critical for fan-out performance.
        const notificationEntities = targetUserIds.map((userId) =>
          manager.create(NotificationOrmEntity, {
            id: randomUUID(),
            userId,
            channel: NotificationChannel.IN_APP,
            category: 'announcement',
            title: dto.title,
            body: dto.body,
            data: { announcementId: saved.id, target: saved.target },
            status: NotificationStatus.QUEUED,
          }),
        );
        await manager.insert(NotificationOrmEntity, notificationEntities);
      }

      return {
        data: {
          id: saved.id,
          title: saved.title,
          body: saved.body,
          target: saved.target,
          sentAt: saved.sentAt,
          createdBy: saved.createdBy,
          createdAt: saved.createdAt,
          queuedCount: targetUserIds.length,
        },
      };
    });
  }

  async list(page = 1, limit = 25) {
    const skip = (page - 1) * limit;
    const [items, total] = await this.announcementRepo.findAndCount({
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data: items.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        target: a.target,
        sentAt: a.sentAt,
        createdBy: a.createdBy,
        createdAt: a.createdAt,
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
