import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserDeviceOrmEntity } from './infrastructure/persistence/entities/user-device.orm-entity';
import { NotificationPreferenceOrmEntity } from './infrastructure/persistence/entities/notification-preference.orm-entity';
import { NotificationOrmEntity } from './infrastructure/persistence/entities/notification.orm-entity';
import { AnnouncementOrmEntity } from './infrastructure/persistence/entities/announcement.orm-entity';

import { DeviceService } from './application/device.service';
import { PreferenceService } from './application/preference.service';
import { NotificationService } from './application/notification.service';
import { AnnouncementService } from './application/announcement.service';
import { NotificationDispatcherWorker } from './infrastructure/workers/notification-dispatcher.worker';

import { NotificationsController } from './presentation/notifications.controller';
import { DevicesController } from './presentation/devices.controller';
import { PreferencesController } from './presentation/preferences.controller';
import { AdminAnnouncementsController } from './presentation/admin-announcements.controller';
import { RolesGuard } from './presentation/guards/roles.guard';

import { NOTIFICATION_SENDER } from './domain/ports/notification-sender.port';
import { FcmNotificationSenderAdapter } from './infrastructure/senders/fcm-notification-sender.adapter';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UserDeviceOrmEntity,
      NotificationPreferenceOrmEntity,
      NotificationOrmEntity,
      AnnouncementOrmEntity,
    ]),
  ],
  controllers: [
    NotificationsController,
    DevicesController,
    PreferencesController,
    AdminAnnouncementsController,
  ],
  providers: [
    RolesGuard,
    DeviceService,
    PreferenceService,
    NotificationService,
    AnnouncementService,
    NotificationDispatcherWorker,
    FcmNotificationSenderAdapter,
    {
      provide: NOTIFICATION_SENDER,
      useClass: FcmNotificationSenderAdapter,
    },
  ],
  exports: [
    DeviceService,
    PreferenceService,
    NotificationService,
    AnnouncementService,
    NotificationDispatcherWorker,
    NOTIFICATION_SENDER,
  ],
})
export class NotificationsModule {}
