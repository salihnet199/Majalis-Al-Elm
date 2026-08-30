/**
 * BC04 Notifications Module — Integration Tests
 *
 * Tests all endpoints and critical dispatcher flows:
 *  - Devices: registration, upsert without duplicates, deletion (own vs other user 403)
 *  - In-App Center: listing with cursor pagination, accurate total unreadCount badge calculation,
 *                   unreadOnly filter, single read marking (with ownership guard), mark-all-read
 *  - Preferences: retrieving and upserting channel/category opt-out preferences
 *  - Announcements: RBAC (Admin/SuperAdmin only, 403 for User/Moderator), non-blocking creation
 *  - Batch Dispatcher Worker:
 *      * QUEUED → SENT transition with sentAt timestamp
 *      * Failure handling: QUEUED → FAILED with errorMsg on sender error
 *      * User preference enforcement: skipping disabled channels during dispatch
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate } from '@nestjs/common';
import request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

class BypassThrottlerGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

import { NotificationsController } from './presentation/notifications.controller';
import { DevicesController } from './presentation/devices.controller';
import { PreferencesController } from './presentation/preferences.controller';
import { AdminAnnouncementsController } from './presentation/admin-announcements.controller';

import { NotificationService } from './application/notification.service';
import { DeviceService } from './application/device.service';
import { PreferenceService } from './application/preference.service';
import { AnnouncementService } from './application/announcement.service';
import { NotificationDispatcherWorker } from './infrastructure/workers/notification-dispatcher.worker';
import { RolesGuard } from './presentation/guards/roles.guard';

import { JwtStrategy } from '../identity/infrastructure/adapters/jwt.strategy';
import { JwtRs256Adapter } from '../identity/infrastructure/adapters/jwt-rs256.adapter';

import { UserDeviceOrmEntity } from './infrastructure/persistence/entities/user-device.orm-entity';
import { NotificationPreferenceOrmEntity } from './infrastructure/persistence/entities/notification-preference.orm-entity';
import { NotificationOrmEntity } from './infrastructure/persistence/entities/notification.orm-entity';
import { AnnouncementOrmEntity } from './infrastructure/persistence/entities/announcement.orm-entity';
import { NotificationChannel, NotificationStatus } from './domain/models/notification-enums';
import {
  NOTIFICATION_SENDER,
  NotificationSenderPort,
  SendNotificationResult,
} from './domain/ports/notification-sender.port';

import { GlobalExceptionFilter } from '../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../shared/presentation/interceptors/trace-id.interceptor';

class MockNotificationSender implements NotificationSenderPort {
  public shouldFail = false;
  public sendPushCalls: any[] = [];
  public sendEmailCalls: any[] = [];
  public sendSmsCalls: any[] = [];

  async sendPush(notification: NotificationOrmEntity, devices: UserDeviceOrmEntity[]): Promise<SendNotificationResult> {
    this.sendPushCalls.push({ notification, devices });
    if (this.shouldFail) {
      return { success: false, error: 'FCM delivery failed: token expired' };
    }
    return { success: true };
  }

  async sendEmail(notification: NotificationOrmEntity, userEmail?: string): Promise<SendNotificationResult> {
    this.sendEmailCalls.push({ notification, userEmail });
    if (this.shouldFail) {
      return { success: false, error: 'SMTP connection timeout' };
    }
    return { success: true };
  }

  async sendSms(notification: NotificationOrmEntity, userPhone?: string): Promise<SendNotificationResult> {
    this.sendSmsCalls.push({ notification, userPhone });
    if (this.shouldFail) {
      return { success: false, error: 'SMS gateway error' };
    }
    return { success: true };
  }
}

describe('BC04 Notifications Module — Integration Tests', () => {
  let app: INestApplication;
  let jwtAdapter: JwtRs256Adapter;
  let mockSender: MockNotificationSender;
  let dispatcherWorker: NotificationDispatcherWorker;

  // In-memory data stores
  let devicesStore: UserDeviceOrmEntity[] = [];
  let preferencesStore: NotificationPreferenceOrmEntity[] = [];
  let notificationsStore: NotificationOrmEntity[] = [];
  let announcementsStore: AnnouncementOrmEntity[] = [];

  // Test users & tokens
  const user1Id = randomUUID();
  const user2Id = randomUUID();
  const moderatorId = randomUUID();
  const adminId = randomUUID();

  let user1Token: string;
  let user2Token: string;
  let moderatorToken: string;
  let adminToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        const config: Record<string, any> = {
          'jwt.accessTokenTtl': 900,
          'jwt.refreshTokenTtl': 604800,
        };
        return config[key] ?? defaultValue;
      }),
    };

    // User Devices Repository Mock
    const mockDeviceRepo = {
      create: jest.fn((dto: any) => ({
        id: dto.id || randomUUID(),
        userId: dto.userId,
        fcmToken: dto.fcmToken,
        deviceName: dto.deviceName ?? null,
        platform: dto.platform,
        isActive: dto.isActive ?? true,
        lastSeenAt: dto.lastSeenAt ?? new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn(async (entity: UserDeviceOrmEntity) => {
        const idx = devicesStore.findIndex((d) => d.id === entity.id);
        if (idx >= 0) {
          devicesStore[idx] = { ...entity, updatedAt: new Date() };
          return devicesStore[idx];
        }
        devicesStore.push(entity);
        return entity;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        return (
          devicesStore.find((d) => {
            if (where.id && d.id !== where.id) return false;
            if (where.userId && d.userId !== where.userId) return false;
            if (where.fcmToken && d.fcmToken !== where.fcmToken) return false;
            if (where.isActive !== undefined && d.isActive !== where.isActive) return false;
            return true;
          }) || null
        );
      }),
      find: jest.fn(async ({ where }: any) => {
        return devicesStore.filter((d) => {
          if (where.userId && d.userId !== where.userId) return false;
          if (where.isActive !== undefined && d.isActive !== where.isActive) return false;
          return true;
        });
      }),
      delete: jest.fn(async ({ id }: any) => {
        const idx = devicesStore.findIndex((d) => d.id === id);
        if (idx >= 0) devicesStore.splice(idx, 1);
        return { affected: idx >= 0 ? 1 : 0 };
      }),
    };

    // Preferences Repository Mock
    const mockPreferenceRepo = {
      create: jest.fn((dto: any) => ({
        userId: dto.userId,
        channel: dto.channel,
        category: dto.category,
        isEnabled: dto.isEnabled ?? true,
        updatedAt: new Date(),
      })),
      save: jest.fn(async (entity: NotificationPreferenceOrmEntity) => {
        const idx = preferencesStore.findIndex(
          (p) => p.userId === entity.userId && p.channel === entity.channel && p.category === entity.category,
        );
        if (idx >= 0) {
          preferencesStore[idx] = { ...entity, updatedAt: new Date() };
          return preferencesStore[idx];
        }
        preferencesStore.push(entity);
        return entity;
      }),
      find: jest.fn(async ({ where }: any) => {
        return preferencesStore.filter((p) => p.userId === where.userId);
      }),
      findOne: jest.fn(async ({ where }: any) => {
        return (
          preferencesStore.find(
            (p) =>
              p.userId === where.userId &&
              p.channel === where.channel &&
              p.category === where.category,
          ) || null
        );
      }),
    };

    // Notifications Repository Mock
    const mockNotificationRepo = {
      create: jest.fn((dto: any) => ({
        id: dto.id || randomUUID(),
        userId: dto.userId,
        channel: dto.channel,
        category: dto.category,
        title: dto.title ?? null,
        body: dto.body,
        data: dto.data ?? null,
        status: dto.status ?? NotificationStatus.QUEUED,
        sentAt: dto.sentAt ?? null,
        readAt: dto.readAt ?? null,
        errorMsg: dto.errorMsg ?? null,
        createdAt: new Date(),
      })),
      save: jest.fn(async (entity: NotificationOrmEntity) => {
        const idx = notificationsStore.findIndex((n) => n.id === entity.id);
        if (idx >= 0) {
          notificationsStore[idx] = { ...entity };
          return notificationsStore[idx];
        }
        notificationsStore.push(entity);
        return entity;
      }),
      findOne: jest.fn(async ({ where }: any) => {
        return notificationsStore.find((n) => n.id === where.id) || null;
      }),
      find: jest.fn(async ({ where, take, order }: any) => {
        let list = [...notificationsStore];
        if (where?.status) {
          list = list.filter((n) => n.status === where.status);
        }
        if (where?.userId) {
          list = list.filter((n) => n.userId === where.userId);
        }
        if (order?.createdAt === 'ASC') {
          list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        }
        return take ? list.slice(0, take) : list;
      }),
      count: jest.fn(async ({ where }: any) => {
        return notificationsStore.filter((n) => {
          if (where.userId && n.userId !== where.userId) return false;
          if (where.status?._value && Array.isArray(where.status._value)) {
            return where.status._value.includes(n.status);
          }
          if (where.status && n.status !== where.status) return false;
          return true;
        }).length;
      }),
      createQueryBuilder: jest.fn(() => {
        let filterUserId = '';
        let unreadFilter = false;
        let updateStatus: NotificationStatus | null = null;
        let updateReadAt: Date | null = null;

        const qb: any = {
          where: jest.fn((clause: string, params: any) => {
            if (params?.userId) filterUserId = params.userId;
            return qb;
          }),
          andWhere: jest.fn((clause: string, params: any) => {
            if (clause.includes('status IN')) unreadFilter = true;
            return qb;
          }),
          orderBy: jest.fn(() => qb),
          addOrderBy: jest.fn(() => qb),
          take: jest.fn(() => qb),
          getMany: jest.fn(async () => {
            return notificationsStore.filter((n) => {
              if (filterUserId && n.userId !== filterUserId) return false;
              if (unreadFilter && ![NotificationStatus.QUEUED, NotificationStatus.SENT].includes(n.status)) return false;
              return true;
            });
          }),
          update: jest.fn(() => qb),
          set: jest.fn((vals: any) => {
            if (vals.status) updateStatus = vals.status;
            if (vals.readAt) updateReadAt = vals.readAt;
            return qb;
          }),
          execute: jest.fn(async () => {
            let count = 0;
            notificationsStore.forEach((n) => {
              if (n.userId === filterUserId && [NotificationStatus.QUEUED, NotificationStatus.SENT].includes(n.status)) {
                if (updateStatus) n.status = updateStatus;
                if (updateReadAt) n.readAt = updateReadAt;
                count++;
              }
            });
            return { affected: count };
          }),
        };
        return qb;
      }),
    };

    // Announcements Repository Mock
    const mockAnnouncementRepo = {
      create: jest.fn((dto: any) => ({
        id: dto.id || randomUUID(),
        title: dto.title,
        body: dto.body,
        target: dto.target ?? 'ALL',
        sentAt: dto.sentAt ?? new Date(),
        createdBy: dto.createdBy,
        createdAt: new Date(),
      })),
      save: jest.fn(async (entity: AnnouncementOrmEntity) => {
        announcementsStore.push(entity);
        return entity;
      }),
      findAndCount: jest.fn(async ({ skip, take }: any) => {
        const total = announcementsStore.length;
        const s = skip || 0;
        const t = take || 25;
        return [announcementsStore.slice(s, s + t), total];
      }),
    };

    mockSender = new MockNotificationSender();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [
        NotificationsController,
        DevicesController,
        PreferencesController,
        AdminAnnouncementsController,
      ],
      providers: [
        NotificationService,
        DeviceService,
        PreferenceService,
        AnnouncementService,
        NotificationDispatcherWorker,
        RolesGuard,
        JwtStrategy,
        JwtRs256Adapter,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: NOTIFICATION_SENDER, useValue: mockSender },
        { provide: getRepositoryToken(UserDeviceOrmEntity), useValue: mockDeviceRepo },
        { provide: getRepositoryToken(NotificationPreferenceOrmEntity), useValue: mockPreferenceRepo },
        { provide: getRepositoryToken(NotificationOrmEntity), useValue: mockNotificationRepo },
        { provide: getRepositoryToken(AnnouncementOrmEntity), useValue: mockAnnouncementRepo },
        {
          provide: DataSource,
          useFactory: () => {
            // Mock DataSource.transaction() to simulate the transactional fan-out.
            // manager.query('SELECT id FROM id_users ...') returns the two active test users.
            // manager.create/save/insert delegate to the same in-memory stores used by the repos.
            const mockManager = {
              create: jest.fn((EntityClass: any, dto: any) => {
                if (EntityClass === AnnouncementOrmEntity) return mockAnnouncementRepo.create(dto);
                if (EntityClass === NotificationOrmEntity) return mockNotificationRepo.create(dto);
                return { ...dto };
              }),
              save: jest.fn(async (EntityClass: any, entity: any) => {
                if (EntityClass === AnnouncementOrmEntity) return mockAnnouncementRepo.save(entity);
                return entity;
              }),
              insert: jest.fn(async (EntityClass: any, entities: any[]) => {
                // Bulk-insert: push all notification records into notificationsStore
                for (const e of entities) {
                  await mockNotificationRepo.save(e);
                }
              }),
              query: jest.fn(async (sql: string) => {
                // Return the two active test users for any SELECT on id_users
                if (sql.includes('id_users')) {
                  return [{ id: user1Id }, { id: user2Id }];
                }
                return [];
              }),
            };
            return {
              transaction: jest.fn(async (cb: (manager: any) => Promise<any>) => cb(mockManager)),
            };
          },
        },
        { provide: APP_GUARD, useClass: BypassThrottlerGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());

    await app.init();

    jwtAdapter = moduleFixture.get<JwtRs256Adapter>(JwtRs256Adapter);
    dispatcherWorker = moduleFixture.get<NotificationDispatcherWorker>(NotificationDispatcherWorker);

    // Generate JWT tokens for test roles
    user1Token = await jwtAdapter.signAccessToken({
      sub: user1Id,
      email: 'user1@example.com',
      role: 'User',
      sessionId: randomUUID(),
    });
    user2Token = await jwtAdapter.signAccessToken({
      sub: user2Id,
      email: 'user2@example.com',
      role: 'User',
      sessionId: randomUUID(),
    });
    moderatorToken = await jwtAdapter.signAccessToken({
      sub: moderatorId,
      email: 'mod@example.com',
      role: 'Moderator',
      sessionId: randomUUID(),
    });
    adminToken = await jwtAdapter.signAccessToken({
      sub: adminId,
      email: 'admin@example.com',
      role: 'Admin',
      sessionId: randomUUID(),
    });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  beforeEach(() => {
    devicesStore = [];
    preferencesStore = [];
    notificationsStore = [];
    announcementsStore = [];
    mockSender.shouldFail = false;
    mockSender.sendPushCalls = [];
    mockSender.sendEmailCalls = [];
    mockSender.sendSmsCalls = [];
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. Devices Management
  // ══════════════════════════════════════════════════════════════════════════════

  it('Scenario 1: POST /notifications/devices registers a new device (iOS) successfully', async () => {
    const res = await request(app.getHttpServer())
      .post('/notifications/devices')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        fcmToken: 'fcm-token-user1-iphone',
        deviceName: 'iPhone 15 Pro',
        platform: 'ios',
      })
      .expect(201);

    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.platform).toBe('ios');
    expect(res.body.data.isActive).toBe(true);
    expect(devicesStore.length).toBe(1);
  });

  it('Scenario 2: POST /notifications/devices returns 401 when token is missing', async () => {
    await request(app.getHttpServer())
      .post('/notifications/devices')
      .send({
        fcmToken: 'fcm-token-anon',
        platform: 'android',
      })
      .expect(401);
  });

  it('Scenario 3: POST /notifications/devices updates existing device token without creating duplicates (Upsert)', async () => {
    // First registration
    await request(app.getHttpServer())
      .post('/notifications/devices')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        fcmToken: 'fcm-token-same-device',
        deviceName: 'Pixel 8',
        platform: 'android',
      })
      .expect(201);

    expect(devicesStore.length).toBe(1);

    // Second registration with same token for same user
    const res2 = await request(app.getHttpServer())
      .post('/notifications/devices')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        fcmToken: 'fcm-token-same-device',
        deviceName: 'Pixel 8 Pro Updated',
        platform: 'android',
      })
      .expect(201);

    expect(devicesStore.length).toBe(1); // No duplicate record
    expect(devicesStore[0].deviceName).toBe('Pixel 8 Pro Updated');
  });

  it('Scenario 4: DELETE /notifications/devices/:id deregisters own device on logout', async () => {
    const regRes = await request(app.getHttpServer())
      .post('/notifications/devices')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        fcmToken: 'fcm-token-to-delete',
        platform: 'ios',
      })
      .expect(201);

    const deviceId = regRes.body.data.id;

    await request(app.getHttpServer())
      .delete(`/notifications/devices/${deviceId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(devicesStore.length).toBe(0);
  });

  it('Scenario 5: DELETE /notifications/devices/:id returns 403 when user attempts to delete another user device', async () => {
    // user1 creates a device
    const regRes = await request(app.getHttpServer())
      .post('/notifications/devices')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        fcmToken: 'fcm-token-user1-protected',
        platform: 'android',
      })
      .expect(201);

    const deviceId = regRes.body.data.id;

    // user2 attempts to delete user1's device
    await request(app.getHttpServer())
      .delete(`/notifications/devices/${deviceId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);

    expect(devicesStore.length).toBe(1); // Device remained safe
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. In-App Notifications Center & Badge Counting
  // ══════════════════════════════════════════════════════════════════════════════

  it('Scenario 6: GET /notifications returns paginated list with accurate total unreadCount badge calculation', async () => {
    // Seed notifications for user1 (2 unread, 1 read)
    notificationsStore.push({
      id: randomUUID(),
      userId: user1Id,
      channel: NotificationChannel.IN_APP,
      category: 'qa_answer',
      title: 'تمت الإجابة على سؤالك',
      body: 'أجاب الشيخ على سؤالك في قسم الفتاوى',
      data: { questionId: '123' },
      status: NotificationStatus.SENT, // unread
      sentAt: new Date(),
      readAt: null,
      errorMsg: null,
      createdAt: new Date(),
    });

    notificationsStore.push({
      id: randomUUID(),
      userId: user1Id,
      channel: NotificationChannel.IN_APP,
      category: 'new_content',
      title: 'مقطع صوتي جديد',
      body: 'تمت إضافة درس جديد',
      data: null,
      status: NotificationStatus.QUEUED, // unread
      sentAt: null,
      readAt: null,
      errorMsg: null,
      createdAt: new Date(),
    });

    notificationsStore.push({
      id: randomUUID(),
      userId: user1Id,
      channel: NotificationChannel.IN_APP,
      category: 'announcement',
      title: 'إعلان قديم',
      body: 'تمت قراءته',
      data: null,
      status: NotificationStatus.READ, // read
      sentAt: new Date(),
      readAt: new Date(),
      errorMsg: null,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get('/notifications?limit=10')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.length).toBe(3);
    expect(res.body.meta.unreadCount).toBe(2); // Total unread across all pages
  });

  it('Scenario 7: GET /notifications?unreadOnly=true filters only unread notifications', async () => {
    notificationsStore.push(
      {
        id: randomUUID(),
        userId: user1Id,
        channel: NotificationChannel.IN_APP,
        category: 'qa_answer',
        title: 'Unread Notification',
        body: 'Body',
        data: null,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        readAt: null,
        errorMsg: null,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        userId: user1Id,
        channel: NotificationChannel.IN_APP,
        category: 'qa_answer',
        title: 'Read Notification',
        body: 'Body',
        data: null,
        status: NotificationStatus.READ,
        sentAt: new Date(),
        readAt: new Date(),
        errorMsg: null,
        createdAt: new Date(),
      },
    );

    const res = await request(app.getHttpServer())
      .get('/notifications?unreadOnly=true')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].title).toBe('Unread Notification');
  });

  it('Scenario 8: PATCH /notifications/:id/read marks single notification as READ and updates readAt', async () => {
    const notifId = randomUUID();
    notificationsStore.push({
      id: notifId,
      userId: user1Id,
      channel: NotificationChannel.IN_APP,
      category: 'qa_answer',
      title: 'Pending Read',
      body: 'Test body',
      data: null,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      readAt: null,
      errorMsg: null,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .patch(`/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.status).toBe(NotificationStatus.READ);
    expect(res.body.data.readAt).toBeDefined();
    expect(notificationsStore[0].status).toBe(NotificationStatus.READ);
  });

  it('Scenario 9: PATCH /notifications/:id/read returns 403 when trying to mark another user notification as read', async () => {
    const notifId = randomUUID();
    notificationsStore.push({
      id: notifId,
      userId: user1Id,
      channel: NotificationChannel.IN_APP,
      category: 'qa_answer',
      title: 'User1 Notification',
      body: 'Body',
      data: null,
      status: NotificationStatus.SENT,
      sentAt: new Date(),
      readAt: null,
      errorMsg: null,
      createdAt: new Date(),
    });

    // user2 tries to read user1's notification
    await request(app.getHttpServer())
      .patch(`/notifications/${notifId}/read`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);

    expect(notificationsStore[0].status).toBe(NotificationStatus.SENT);
  });

  it('Scenario 10: POST /notifications/read-all marks all unread notifications for current user as READ', async () => {
    notificationsStore.push(
      {
        id: randomUUID(),
        userId: user1Id,
        channel: NotificationChannel.IN_APP,
        category: 'qa_answer',
        title: 'Unread 1',
        body: '1',
        data: null,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        readAt: null,
        errorMsg: null,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        userId: user1Id,
        channel: NotificationChannel.IN_APP,
        category: 'new_content',
        title: 'Unread 2',
        body: '2',
        data: null,
        status: NotificationStatus.QUEUED,
        sentAt: null,
        readAt: null,
        errorMsg: null,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        userId: user2Id, // user2 notification should remain untouched
        channel: NotificationChannel.IN_APP,
        category: 'qa_answer',
        title: 'User2 Unread',
        body: 'U2',
        data: null,
        status: NotificationStatus.SENT,
        sentAt: new Date(),
        readAt: null,
        errorMsg: null,
        createdAt: new Date(),
      },
    );

    const res = await request(app.getHttpServer())
      .post('/notifications/read-all')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.updatedCount).toBe(2);
    expect(notificationsStore[0].status).toBe(NotificationStatus.READ);
    expect(notificationsStore[1].status).toBe(NotificationStatus.READ);
    expect(notificationsStore[2].status).toBe(NotificationStatus.SENT); // untouched
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. User Preferences
  // ══════════════════════════════════════════════════════════════════════════════

  it('Scenario 11: GET & PATCH /notifications/preferences manages channel and category preferences', async () => {
    // 1. Initial GET
    const getRes1 = await request(app.getHttpServer())
      .get('/notifications/preferences')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(getRes1.body.data.preferences).toEqual([]);

    // 2. Update preferences (opt-out of QA email, enable FCM push)
    const patchRes = await request(app.getHttpServer())
      .patch('/notifications/preferences')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        preferences: [
          { channel: 'EMAIL', category: 'qa_answer', isEnabled: false },
          { channel: 'FCM_PUSH', category: 'new_content', isEnabled: true },
        ],
      })
      .expect(200);

    expect(patchRes.body.data.preferences.length).toBe(2);

    // 3. Subsequent GET returns updated preferences
    const getRes2 = await request(app.getHttpServer())
      .get('/notifications/preferences')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(getRes2.body.data.preferences.length).toBe(2);
    const emailPref = getRes2.body.data.preferences.find((p: any) => p.channel === 'EMAIL');
    expect(emailPref.isEnabled).toBe(false);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. Admin Announcements & RBAC
  // ══════════════════════════════════════════════════════════════════════════════

  it('Scenario 12: POST /admin/announcements returns 403 for regular User or Moderator', async () => {
    // Regular User
    await request(app.getHttpServer())
      .post('/admin/announcements')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'User Announcement',
        body: 'Not allowed',
      })
      .expect(403);

    // Moderator (Announcements require Admin/SuperAdmin)
    await request(app.getHttpServer())
      .post('/admin/announcements')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({
        title: 'Moderator Announcement',
        body: 'Not allowed',
      })
      .expect(403);
  });

  it('Scenario 13: POST /admin/announcements fan-outs QUEUED records — one per active user, not one for Admin', async () => {
    // The mock DataSource returns 2 active users (user1Id, user2Id) for target='ALL'.
    // Correct behaviour: one QUEUED notification record per target user (2 total),
    // NOT a single record for the Admin who created the announcement.
    const res = await request(app.getHttpServer())
      .post('/admin/announcements')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'تحديث المنصة الرسمي',
        body: 'تمت ترقية المنصة وإضافة ميزات جديدة',
        target: 'ALL',
      })
      .expect(201);

    expect(res.body.data).toHaveProperty('id');
    expect(res.body.data.title).toBe('تحديث المنصة الرسمي');
    expect(res.body.data.target).toBe('ALL');
    expect(announcementsStore.length).toBe(1);

    // Fan-out: 2 QUEUED records — one for user1Id, one for user2Id
    expect(notificationsStore.length).toBe(2);
    expect(res.body.data.queuedCount).toBe(2);

    const userIds = notificationsStore.map((n) => n.userId);
    expect(userIds).toContain(user1Id);
    expect(userIds).toContain(user2Id);
    // Admin who sent the announcement should NOT have a dedicated record from the HTTP request
    expect(userIds).not.toContain(adminId);

    notificationsStore.forEach((n) => {
      expect(n.status).toBe(NotificationStatus.QUEUED);
      expect(n.title).toBe('تحديث المنصة الرسمي');
      expect(n.category).toBe('announcement');
    });
  });

  it('Scenario 14: GET /admin/announcements lists past announcements with offset pagination', async () => {
    announcementsStore.push({
      id: randomUUID(),
      title: 'Past Announcement 1',
      body: 'Content 1',
      target: 'ALL',
      sentAt: new Date(),
      createdBy: adminId,
      createdAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get('/admin/announcements?page=1&limit=10')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta.page).toBe(1);
  });

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. Background Dispatcher Worker Execution & Flows (QUEUED → SENT / FAILED)
  // ══════════════════════════════════════════════════════════════════════════════

  it('Scenario 15: NotificationDispatcherWorker successfully transitions QUEUED notifications to SENT with sentAt populated', async () => {
    // Seed active device for user1
    devicesStore.push({
      id: randomUUID(),
      userId: user1Id,
      fcmToken: 'token-active-1',
      deviceName: 'Device',
      platform: 'ios',
      isActive: true,
      lastSeenAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // Queue 2 notifications (1 Push, 1 Email)
    notificationsStore.push(
      {
        id: randomUUID(),
        userId: user1Id,
        channel: NotificationChannel.FCM_PUSH,
        category: 'new_content',
        title: 'درس جديد',
        body: 'تم نشر درس جديد',
        data: { lessonId: '99' },
        status: NotificationStatus.QUEUED,
        sentAt: null,
        readAt: null,
        errorMsg: null,
        createdAt: new Date(),
      },
      {
        id: randomUUID(),
        userId: user1Id,
        channel: NotificationChannel.EMAIL,
        category: 'qa_answer',
        title: 'إجابة على سؤالك',
        body: 'تفاصيل الإجابة',
        data: null,
        status: NotificationStatus.QUEUED,
        sentAt: null,
        readAt: null,
        errorMsg: null,
        createdAt: new Date(),
      },
    );

    // Trigger batch dispatch
    const processedCount = await dispatcherWorker.processNextBatch(10);

    expect(processedCount).toBe(2);
    expect(notificationsStore[0].status).toBe(NotificationStatus.SENT);
    expect(notificationsStore[0].sentAt).toBeDefined();
    expect(notificationsStore[1].status).toBe(NotificationStatus.SENT);
    expect(notificationsStore[1].sentAt).toBeDefined();

    expect(mockSender.sendPushCalls.length).toBe(1);
    expect(mockSender.sendEmailCalls.length).toBe(1);
  });

  it('Scenario 16: NotificationDispatcherWorker handles sender failure gracefully (QUEUED → FAILED with errorMsg recorded)', async () => {
    mockSender.shouldFail = true;

    notificationsStore.push({
      id: randomUUID(),
      userId: user1Id,
      channel: NotificationChannel.FCM_PUSH,
      category: 'new_content',
      title: 'درس فاشل الإرسال',
      body: 'سيفشل بسبب خطأ في مزود الإرسال',
      data: null,
      status: NotificationStatus.QUEUED,
      sentAt: null,
      readAt: null,
      errorMsg: null,
      createdAt: new Date(),
    });

    const processedCount = await dispatcherWorker.processNextBatch(10);

    expect(processedCount).toBe(1);
    expect(notificationsStore[0].status).toBe(NotificationStatus.FAILED);
    expect(notificationsStore[0].errorMsg).toContain('FCM delivery failed');
  });

  it('Scenario 17: NotificationDispatcherWorker respects user opt-out preferences and skips channel dispatch', async () => {
    // User opted out of EMAIL for category 'new_content'
    preferencesStore.push({
      userId: user1Id,
      channel: NotificationChannel.EMAIL,
      category: 'new_content',
      isEnabled: false,
      updatedAt: new Date(),
    });

    notificationsStore.push({
      id: randomUUID(),
      userId: user1Id,
      channel: NotificationChannel.EMAIL,
      category: 'new_content',
      title: 'Email should be skipped',
      body: 'Opted out',
      data: null,
      status: NotificationStatus.QUEUED,
      sentAt: null,
      readAt: null,
      errorMsg: null,
      createdAt: new Date(),
    });

    const processedCount = await dispatcherWorker.processNextBatch(10);

    expect(processedCount).toBe(1);
    expect(notificationsStore[0].status).toBe(NotificationStatus.SENT);
    expect(notificationsStore[0].errorMsg).toContain('Skipped: user preference disabled');
    // Sender was NOT called because preference disabled
    expect(mockSender.sendEmailCalls.length).toBe(0);
  });
});
