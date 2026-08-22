import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID } from 'crypto';
import { UserDeviceOrmEntity } from '../infrastructure/persistence/entities/user-device.orm-entity';
import { RegisterDeviceDto } from './dtos/register-device.dto';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';

@Injectable()
export class DeviceService {
  constructor(
    @InjectRepository(UserDeviceOrmEntity)
    private readonly deviceRepo: Repository<UserDeviceOrmEntity>,
  ) {}

  async register(userId: string, dto: RegisterDeviceDto) {
    let device = await this.deviceRepo.findOne({
      where: { userId, fcmToken: dto.fcmToken },
    });

    if (device) {
      device.deviceName = dto.deviceName ?? device.deviceName;
      device.platform = dto.platform;
      device.isActive = true;
      device.lastSeenAt = new Date();
      device.updatedAt = new Date();
    } else {
      device = this.deviceRepo.create({
        id: randomUUID(),
        userId,
        fcmToken: dto.fcmToken,
        deviceName: dto.deviceName ?? null,
        platform: dto.platform,
        isActive: true,
        lastSeenAt: new Date(),
      });
    }

    const saved = await this.deviceRepo.save(device);
    return {
      id: saved.id,
      platform: saved.platform,
      isActive: saved.isActive,
      lastSeenAt: saved.lastSeenAt,
      createdAt: saved.createdAt,
      updatedAt: saved.updatedAt,
    };
  }

  async deleteDevice(deviceId: string, user: JwtPayload): Promise<void> {
    const device = await this.deviceRepo.findOne({
      where: { id: deviceId },
    });

    if (!device) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: 'Device not found',
      });
    }

    if (device.userId !== user.sub) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to delete this device',
      });
    }

    await this.deviceRepo.delete({ id: deviceId });
  }

  async getActiveDevicesForUser(userId: string): Promise<UserDeviceOrmEntity[]> {
    return this.deviceRepo.find({
      where: { userId, isActive: true },
    });
  }
}
