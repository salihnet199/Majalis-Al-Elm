import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';
import { NotificationChannel } from '../../../domain/models/notification-enums';

@Entity('nt_notification_preferences')
export class NotificationPreferenceOrmEntity {
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId!: string;

  @PrimaryColumn({ type: 'enum', enum: NotificationChannel })
  channel!: NotificationChannel;

  @PrimaryColumn({ type: 'varchar', length: 50 })
  category!: string;

  @Column({ name: 'is_enabled', type: 'boolean', default: true })
  isEnabled!: boolean;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
