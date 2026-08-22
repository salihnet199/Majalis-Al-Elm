import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificationPreferenceOrmEntity } from '../infrastructure/persistence/entities/notification-preference.orm-entity';
import { UpdatePreferencesDto } from './dtos/update-preferences.dto';
import { NotificationChannel } from '../domain/models/notification-enums';

@Injectable()
export class PreferenceService {
  constructor(
    @InjectRepository(NotificationPreferenceOrmEntity)
    private readonly preferenceRepo: Repository<NotificationPreferenceOrmEntity>,
  ) {}

  async getPreferences(userId: string) {
    const preferences = await this.preferenceRepo.find({
      where: { userId },
    });

    return {
      preferences: preferences.map((p) => ({
        channel: p.channel,
        category: p.category,
        isEnabled: p.isEnabled,
        updatedAt: p.updatedAt,
      })),
    };
  }

  async updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    const results: NotificationPreferenceOrmEntity[] = [];

    for (const pref of dto.preferences) {
      let entity = await this.preferenceRepo.findOne({
        where: {
          userId,
          channel: pref.channel,
          category: pref.category,
        },
      });

      if (entity) {
        entity.isEnabled = pref.isEnabled;
        entity.updatedAt = new Date();
      } else {
        entity = this.preferenceRepo.create({
          userId,
          channel: pref.channel,
          category: pref.category,
          isEnabled: pref.isEnabled,
        });
      }

      const saved = await this.preferenceRepo.save(entity);
      results.push(saved);
    }

    return {
      preferences: results.map((p) => ({
        channel: p.channel,
        category: p.category,
        isEnabled: p.isEnabled,
        updatedAt: p.updatedAt,
      })),
    };
  }

  async isNotificationEnabled(
    userId: string,
    channel: NotificationChannel,
    category: string,
  ): Promise<boolean> {
    const pref = await this.preferenceRepo.findOne({
      where: { userId, channel, category },
    });

    if (!pref) {
      return true; // Default enabled
    }

    return pref.isEnabled;
  }
}
