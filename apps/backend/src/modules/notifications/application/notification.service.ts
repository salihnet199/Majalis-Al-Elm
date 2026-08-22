import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { randomUUID } from 'crypto';
import { NotificationOrmEntity } from '../infrastructure/persistence/entities/notification.orm-entity';
import { NotificationChannel, NotificationStatus } from '../domain/models/notification-enums';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';

@Injectable()
export class NotificationService {
  constructor(
    @InjectRepository(NotificationOrmEntity)
    private readonly notificationRepo: Repository<NotificationOrmEntity>,
  ) {}

  async list(
    userId: string,
    limit = 20,
    cursor?: string,
    unreadOnly = false,
  ) {
    // 1. Calculate total unreadCount across all pages for the user badge
    const unreadCount = await this.notificationRepo.count({
      where: {
        userId,
        status: In([NotificationStatus.QUEUED, NotificationStatus.SENT]),
      },
    });

    // 2. Build cursor paginated query
    const qb = this.notificationRepo
      .createQueryBuilder('n')
      .where('n.user_id = :userId', { userId });

    if (unreadOnly) {
      qb.andWhere('n.status IN (:...statuses)', {
        statuses: [NotificationStatus.QUEUED, NotificationStatus.SENT],
      });
    }

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        const { createdAt, id } = JSON.parse(decoded);
        qb.andWhere(
          '(n.created_at < :cursorDate OR (n.created_at = :cursorDate AND n.id < :cursorId))',
          { cursorDate: createdAt, cursorId: id },
        );
      } catch {
        // Invalid cursor - ignore
      }
    }

    qb.orderBy('n.created_at', 'DESC').addOrderBy('n.id', 'DESC');
    qb.take(limit + 1);

    const records = await qb.getMany();
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: last.createdAt, id: last.id }),
      ).toString('base64');
    }

    return {
      data: items.map(this.toResponse),
      meta: {
        unreadCount,
        nextCursor,
        limit,
      },
    };
  }

  async markAsRead(notificationId: string, user: JwtPayload) {
    const notification = await this.notificationRepo.findOne({
      where: { id: notificationId },
    });

    if (!notification) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Notification not found',
      });
    }

    if (notification.userId !== user.sub) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to modify this notification',
      });
    }

    notification.status = NotificationStatus.READ;
    notification.readAt = new Date();

    const saved = await this.notificationRepo.save(notification);
    return {
      data: this.toResponse(saved),
    };
  }

  async markAllAsRead(userId: string) {
    const result = await this.notificationRepo
      .createQueryBuilder()
      .update(NotificationOrmEntity)
      .set({
        status: NotificationStatus.READ,
        readAt: new Date(),
      })
      .where('user_id = :userId', { userId })
      .andWhere('status IN (:...statuses)', {
        statuses: [NotificationStatus.QUEUED, NotificationStatus.SENT],
      })
      .execute();

    return {
      data: {
        updatedCount: result.affected || 0,
      },
    };
  }

  async queueNotification(params: {
    userId: string;
    channel: NotificationChannel;
    category: string;
    title?: string;
    body: string;
    data?: Record<string, any>;
  }): Promise<NotificationOrmEntity> {
    const entity = this.notificationRepo.create({
      id: randomUUID(),
      userId: params.userId,
      channel: params.channel,
      category: params.category,
      title: params.title ?? null,
      body: params.body,
      data: params.data ?? null,
      status: NotificationStatus.QUEUED,
    });

    return this.notificationRepo.save(entity);
  }

  private toResponse(n: NotificationOrmEntity) {
    return {
      id: n.id,
      channel: n.channel,
      category: n.category,
      title: n.title,
      body: n.body,
      data: n.data,
      status: n.status,
      sentAt: n.sentAt,
      readAt: n.readAt,
      createdAt: n.createdAt,
    };
  }
}
