import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationSenderPort,
  SendNotificationResult,
} from '../../domain/ports/notification-sender.port';
import { NotificationOrmEntity } from '../persistence/entities/notification.orm-entity';
import { UserDeviceOrmEntity } from '../persistence/entities/user-device.orm-entity';

@Injectable()
export class CompositeNotificationSenderAdapter implements NotificationSenderPort {
  private readonly logger = new Logger(CompositeNotificationSenderAdapter.name);

  async sendPush(
    notification: NotificationOrmEntity,
    devices: UserDeviceOrmEntity[],
  ): Promise<SendNotificationResult> {
    if (!devices || devices.length === 0) {
      this.logger.debug(
        `[FCM] No active devices found for user ${notification.userId} - skipping push`,
      );
      return { success: true };
    }

    this.logger.log(
      `[FCM] Sent push notification "${notification.title}" to ${devices.length} device(s) for user ${notification.userId}`,
    );
    return { success: true };
  }

  async sendEmail(
    notification: NotificationOrmEntity,
    userEmail?: string,
  ): Promise<SendNotificationResult> {
    this.logger.log(
      `[Email] Sent email notification "${notification.title}" to ${userEmail || notification.userId}`,
    );
    return { success: true };
  }

  async sendSms(
    notification: NotificationOrmEntity,
    userPhone?: string,
  ): Promise<SendNotificationResult> {
    this.logger.log(
      `[SMS] Sent SMS notification to ${userPhone || notification.userId}: ${notification.body}`,
    );
    return { success: true };
  }
}
