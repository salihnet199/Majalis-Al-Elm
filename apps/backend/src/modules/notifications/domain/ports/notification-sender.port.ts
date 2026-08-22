import { NotificationOrmEntity } from '../../infrastructure/persistence/entities/notification.orm-entity';
import { UserDeviceOrmEntity } from '../../infrastructure/persistence/entities/user-device.orm-entity';

export const NOTIFICATION_SENDER = Symbol('NOTIFICATION_SENDER');

export interface SendNotificationResult {
  success: boolean;
  error?: string;
}

export interface NotificationSenderPort {
  sendPush(notification: NotificationOrmEntity, devices: UserDeviceOrmEntity[]): Promise<SendNotificationResult>;
  sendEmail(notification: NotificationOrmEntity, userEmail?: string): Promise<SendNotificationResult>;
  sendSms(notification: NotificationOrmEntity, userPhone?: string): Promise<SendNotificationResult>;
}
