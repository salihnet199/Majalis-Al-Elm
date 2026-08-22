import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationOrmEntity } from '../persistence/entities/notification.orm-entity';
import { NotificationChannel, NotificationStatus } from '../../domain/models/notification-enums';
import {
  NOTIFICATION_SENDER,
  NotificationSenderPort,
  SendNotificationResult,
} from '../../domain/ports/notification-sender.port';
import { DeviceService } from '../../application/device.service';
import { PreferenceService } from '../../application/preference.service';

@Injectable()
export class NotificationDispatcherWorker
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationDispatcherWorker.name);
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(
    @InjectRepository(NotificationOrmEntity)
    private readonly notificationRepo: Repository<NotificationOrmEntity>,
    @Inject(NOTIFICATION_SENDER)
    private readonly sender: NotificationSenderPort,
    private readonly deviceService: DeviceService,
    private readonly preferenceService: PreferenceService,
  ) {}

  onModuleInit() {
    // Only run periodic background timer if not running in test suite
    if (process.env.NODE_ENV !== 'test') {
      this.startPolling(10000); // 10s interval
    }
  }

  onModuleDestroy() {
    this.stopPolling();
  }

  startPolling(intervalMs = 10000) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.processNextBatch().catch((err) => {
        this.logger.error(`Error in notification batch dispatch: ${err.message}`, err.stack);
      });
    }, intervalMs);
  }

  stopPolling() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Processes the next batch of QUEUED notifications.
   * Concurrency protected via Layer 1 in-memory mutex (isProcessing) and
   * Layer 2 database query filtering.
   */
  async processNextBatch(batchSize = 50): Promise<number> {
    if (this.isProcessing) {
      this.logger.debug('Batch processing already in flight — skipping tick');
      return 0;
    }

    this.isProcessing = true;
    try {
      const queuedNotifications = await this.notificationRepo.find({
        where: { status: NotificationStatus.QUEUED },
        order: { createdAt: 'ASC' },
        take: batchSize,
      });

      if (queuedNotifications.length === 0) {
        return 0;
      }

      for (const notification of queuedNotifications) {
        await this.dispatchSingle(notification);
      }

      return queuedNotifications.length;
    } finally {
      this.isProcessing = false;
    }
  }

  private async dispatchSingle(notification: NotificationOrmEntity): Promise<void> {
    try {
      // 1. Check user notification preferences
      const isEnabled = await this.preferenceService.isNotificationEnabled(
        notification.userId,
        notification.channel,
        notification.category,
      );

      if (!isEnabled) {
        // User opted out of this channel/category: mark SENT (skipped)
        notification.status = NotificationStatus.SENT;
        notification.sentAt = new Date();
        notification.errorMsg = 'Skipped: user preference disabled for this channel';
        await this.notificationRepo.save(notification);
        return;
      }

      // 2. Dispatch based on channel
      let result: SendNotificationResult = { success: true };

      switch (notification.channel) {
        case NotificationChannel.FCM_PUSH: {
          const devices = await this.deviceService.getActiveDevicesForUser(
            notification.userId,
          );
          result = await this.sender.sendPush(notification, devices);
          break;
        }
        case NotificationChannel.EMAIL: {
          result = await this.sender.sendEmail(notification);
          break;
        }
        case NotificationChannel.SMS: {
          result = await this.sender.sendSms(notification);
          break;
        }
        case NotificationChannel.IN_APP: {
          // In-app notifications are stored directly in DB; ready to read
          result = { success: true };
          break;
        }
      }

      if (result.success) {
        notification.status = NotificationStatus.SENT;
        notification.sentAt = new Date();
        notification.errorMsg = null;
      } else {
        notification.status = NotificationStatus.FAILED;
        notification.errorMsg = result.error || 'Failed to dispatch notification';
      }

      await this.notificationRepo.save(notification);
    } catch (err: any) {
      notification.status = NotificationStatus.FAILED;
      notification.errorMsg = err.message || 'Unexpected dispatcher error';
      await this.notificationRepo.save(notification);
    }
  }
}
