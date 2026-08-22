/**
 * BC05 Admin & Analytics — Integration Tests
 *
 * Tests the full admin management flow using stateful in-memory mocks.
 * No real database required — all TypeORM repositories and DataSource are
 * replaced with Jest mocks.
 *
 * NODE_ENV=test activates HS256 fallback in JwtRs256Adapter / JwtStrategy.
 *
 * Covered flows:
 *  1.  Analytics — overview endpoint (Admin + SuperAdmin access)
 *  2.  Analytics — content endpoint with query params
 *  3.  Analytics — rejects non-admin roles (403)
 *  4.  System Config — list all entries
 *  5.  System Config — get single entry by key
 *  6.  System Config — returns 404 for unknown key
 *  7.  System Config — SuperAdmin can update a value
 *  8.  System Config — Admin cannot update (403)
 *  9.  Admin Users — paginated user list
 *  10. Admin Users — get single user by ID
 *  11. Admin Users — 404 for unknown user
 *  12. Admin Users — suspend a user (success)
 *  13. Admin Users — suspend is idempotent (already suspended → 200)
 *  14. Admin Users — unsuspend a user
 *  15. Admin Users — unsuspend is idempotent (already active → 200)
 *  16. Admin Users — assign role (SuperAdmin only)
 *  17. Admin Users — assign role rejects invalid role name (400)
 *  18. Admin Users — Admin cannot assign role (403)
 *  19. Audit Log — paginated listing
 *  20. All admin routes — 401 without auth token
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';

import { AdminAnalyticsController, AdminSystemConfigController, AdminAuditLogController, AdminUsersController } from './presentation/admin.controller';
import { AnalyticsService } from './application/analytics.service';
import { SystemConfigService } from './application/system-config.service';
import { AuditLogService } from './application/audit-log.service';
import { RolesGuard } from './presentation/guards/roles.guard';
import { AuditLogOrmEntity } from './infrastructure/persistence/entities/audit-log.orm-entity';
import { SystemConfigOrmEntity } from './infrastructure/persistence/entities/system-config.orm-entity';
import { USER_REPOSITORY } from '../identity/domain/ports/user.repository';
import { User } from '../identity/domain/user.entity';
import { JwtAuthGuard } from '../identity/presentation/guards/jwt-auth.guard';
import { JwtRs256Adapter } from '../identity/infrastructure/adapters/jwt-rs256.adapter';
import { JwtStrategy } from '../identity/infrastructure/adapters/jwt.strategy';
import { GlobalExceptionFilter } from '../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../shared/presentation/interceptors/trace-id.interceptor';

import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';

// ── Bypass Throttler (same rationale as BC01 tests) ──────────────────────────
class BypassThrottlerGuard implements CanActivate {
  canActivate(): boolean { return true; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeUser(overrides: Partial<{
  id: string;
  email: string;
  fullName: string;
  isSuspended: boolean;
}> = {}): User {
  return User.reconstitute({
    id: overrides.id ?? randomUUID(),
    fullName: overrides.fullName ?? 'Test User',
    email: overrides.email ?? 'test@example.com',
    phoneE164: null,
    passwordHash: null,
    locale: 'ar',
    theme: 'system',
    audioSpeed: 1.0,
    isSuspended: overrides.isSuspended ?? false,
    suspendedAt: overrides.isSuspended ? new Date() : null,
    deletedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
}

const MOCK_CONFIG_ROWS: SystemConfigOrmEntity[] = [
  Object.assign(new SystemConfigOrmEntity(), {
    key: 'maintenance_mode',
    value: false,
    description: 'Maintenance mode toggle',
    updatedBy: null,
    updatedAt: new Date(),
  }),
  Object.assign(new SystemConfigOrmEntity(), {
    key: 'comment.edit_window_minutes',
    value: 15,
    description: 'Comment edit window',
    updatedBy: null,
    updatedAt: new Date(),
  }),
];

// ── Test Suite ─────────────────────────────────────────────────────────────────

describe('BC05 Admin — Integration Tests', () => {
  let app: INestApplication;

  // In-memory state
  let userDb: Map<string, User>;
  let auditLogDb: AuditLogOrmEntity[];
  let configDb: Map<string, SystemConfigOrmEntity>;

  // Mocks
  let mockUserRepo: jest.Mocked<any>;
  let mockSystemConfigRepo: jest.Mocked<any>;
  let mockAuditLogRepo: jest.Mocked<any>;
  let mockDataSource: jest.Mocked<any>;

  // JWT helpers — generate test tokens with Admin / SuperAdmin / User roles
  let jwtAdapter: JwtRs256Adapter;

  // Signed tokens (populated in beforeAll after app init)
  let adminToken: string;
  let superAdminToken: string;
  let userToken: string;
  const ADMIN_ID = randomUUID();
  const SUPER_ADMIN_ID = randomUUID();
  const REGULAR_USER_ID = randomUUID();

  beforeAll(async () => {
    // ── Mock: IUserRepository ──────────────────────────────────────────────
    mockUserRepo = {
      findById: jest.fn(),
      findByEmail: jest.fn(),
      findByPhone: jest.fn(),
      existsByEmail: jest.fn(),
      existsByPhone: jest.fn(),
      save: jest.fn(),
      findByIdWithPassword: jest.fn(),
      update: jest.fn(),
      assignRole: jest.fn().mockResolvedValue(undefined),
      getPrimaryRole: jest.fn().mockResolvedValue('User'),
      findAllPaginated: jest.fn(),
    };

    // ── Mock: TypeORM Repositories ─────────────────────────────────────────
    mockSystemConfigRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      update: jest.fn(),
    };

    mockAuditLogRepo = {
      insert: jest.fn().mockResolvedValue(undefined),
      createQueryBuilder: jest.fn().mockReturnValue({
        orderBy: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        take: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
        getRepository: jest.fn(),
      }),
      getRepository: jest.fn(),
    };

    // ── Mock: DataSource ────────────────────────────────────────────────────
    mockDataSource = {
      query: jest.fn(),
      transaction: jest.fn(),
      getRepository: jest.fn().mockReturnValue(mockAuditLogRepo),
    };

    // Wire SystemConfigRepo.find BEFORE app.init() so onModuleInit() can pre-load cache
    mockSystemConfigRepo.find.mockResolvedValue(MOCK_CONFIG_ROWS);

    const module: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60000, limit: 10000 }] }),
      ],
      controllers: [
        AdminAnalyticsController,
        AdminSystemConfigController,
        AdminAuditLogController,
        AdminUsersController,
      ],
      providers: [
        AnalyticsService,
        AuditLogService,
        SystemConfigService,
        RolesGuard,

        // User repository (BC01 port)
        { provide: USER_REPOSITORY, useValue: mockUserRepo },

        // TypeORM repos
        { provide: getRepositoryToken(SystemConfigOrmEntity), useValue: mockSystemConfigRepo },
        { provide: getRepositoryToken(AuditLogOrmEntity), useValue: mockAuditLogRepo },

        // DataSource (used by AnalyticsService, AuditLogService, SystemConfigService.update)
        { provide: DataSource, useValue: mockDataSource },

        // JWT adapters (for request authentication)
        JwtRs256Adapter,
        JwtStrategy,
        Reflector,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultVal?: unknown) => {
              const config: Record<string, unknown> = {
                'jwt.accessTokenTtl': 900,
                'jwt.refreshTokenTtl': 604800,
                'jwt.privateKeyPath': undefined,
                'jwt.publicKeyPath': undefined,
                'jwt.privateKey': undefined,
                'jwt.publicKey': undefined,
              };
              return config[key] ?? defaultVal;
            },
          },
        },

        { provide: APP_GUARD, useClass: BypassThrottlerGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());
    app.setGlobalPrefix('api/v1');
    await app.init();

    // Generate test tokens AFTER app init (JwtRs256Adapter needs to be initialised)
    jwtAdapter = module.get(JwtRs256Adapter);
    [adminToken, superAdminToken, userToken] = await Promise.all([
      jwtAdapter.signAccessToken({ sub: ADMIN_ID, email: 'admin@test.com', role: 'Admin', sessionId: randomUUID() }),
      jwtAdapter.signAccessToken({ sub: SUPER_ADMIN_ID, email: 'super@test.com', role: 'SuperAdmin', sessionId: randomUUID() }),
      jwtAdapter.signAccessToken({ sub: REGULAR_USER_ID, email: 'user@test.com', role: 'User', sessionId: randomUUID() }),
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset in-memory state
    userDb = new Map();
    auditLogDb = [];
    configDb = new Map(MOCK_CONFIG_ROWS.map((r) => [r.key, { ...r }]));

    jest.clearAllMocks();

    // Re-wire mocks after clearAllMocks ──────────────────────────────────────

    // SystemConfigService.onModuleInit pre-load
    mockSystemConfigRepo.find.mockResolvedValue(MOCK_CONFIG_ROWS);

    // AuditLogService.log — standalone INSERT via DataSource.getRepository()
    mockDataSource.getRepository.mockReturnValue({
      insert: jest.fn().mockResolvedValue(undefined),
    });
  });

  // ── 1. Analytics — overview ────────────────────────────────────────────────

  describe('1. Analytics Overview', () => {

    it('Admin can GET /admin/analytics/overview (200)', async () => {
      // Stub DataSource.query for all 5 parallel queries in overview()
      mockDataSource.query
        .mockResolvedValueOnce([{ count: '42' }])   // DAU
        .mockResolvedValueOnce([{ count: '150' }])  // WAU
        .mockResolvedValueOnce([{ count: '500' }])  // MAU
        .mockResolvedValueOnce([{ count: '8' }])    // newUsersToday
        .mockResolvedValueOnce([{ method: 'email', count: '500' }]) // authBreakdown
        .mockResolvedValueOnce([                    // topContent
          { id: randomUUID(), type: 'ARTICLE', view_count: '1000', title: 'مقالة رائعة' },
        ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toMatchObject({
        dau: 42,
        wau: 150,
        mau: 500,
        newUsersToday: 8,
        authMethodBreakdown: { email: 500 },
        topContent: expect.arrayContaining([
          expect.objectContaining({ type: 'ARTICLE', viewCount: 1000 }),
        ]),
      });
    });

    it('SuperAdmin can GET /admin/analytics/overview (200)', async () => {
      mockDataSource.query
        .mockResolvedValueOnce([{ count: '10' }])
        .mockResolvedValueOnce([{ count: '70' }])
        .mockResolvedValueOnce([{ count: '200' }])
        .mockResolvedValueOnce([{ count: '2' }])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .expect(200);

      expect(res.body.data).toHaveProperty('dau');
      expect(res.body.data).toHaveProperty('topContent');
    });

    it('Regular User gets 403 for /admin/analytics/overview', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', `Bearer ${userToken}`)
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

  });

  // ── 2. Analytics — content breakdown ──────────────────────────────────────

  describe('2. Analytics Content', () => {

    it('GET /admin/analytics/content returns content breakdown', async () => {
      mockDataSource.query.mockResolvedValueOnce([
        { type: 'ARTICLE', count: '20' },
        { type: 'AUDIO', count: '15' },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/content')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toEqual([
        { type: 'ARTICLE', count: 20 },
        { type: 'AUDIO', count: 15 },
      ]);
    });

    it('GET /admin/analytics/content accepts type and date filters', async () => {
      mockDataSource.query.mockResolvedValueOnce([{ type: 'ARTICLE', count: '5' }]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/content?type=ARTICLE&from=2026-01-01&to=2026-08-01')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data[0].type).toBe('ARTICLE');
      // Verify DataSource.query was called with params
      expect(mockDataSource.query).toHaveBeenCalled();
    });

  });

  // ── 3. System Config ───────────────────────────────────────────────────────

  describe('3. System Config', () => {

    it('GET /admin/system/config returns all config entries', async () => {
      mockSystemConfigRepo.find.mockResolvedValueOnce(MOCK_CONFIG_ROWS);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/system/config')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(2);
      expect(res.body.data[0]).toHaveProperty('key');
      expect(res.body.data[0]).toHaveProperty('value');
    });

    it('GET /admin/system/config/:key returns single entry', async () => {
      mockSystemConfigRepo.findOne.mockResolvedValueOnce(MOCK_CONFIG_ROWS[0]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/system/config/maintenance_mode')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.key).toBe('maintenance_mode');
      expect(res.body.value).toBe(false);
    });

    it('GET /admin/system/config/:key returns 404 for unknown key', async () => {
      mockSystemConfigRepo.findOne.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/system/config/nonexistent_key')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('SuperAdmin can PATCH /admin/system/config/:key (200)', async () => {
      // Mock the TX in SystemConfigService.update()
      const updatedRow = { ...MOCK_CONFIG_ROWS[0], value: true, updatedAt: new Date() };
      mockDataSource.transaction.mockImplementation(async (cb: (manager: any) => Promise<any>) => {
        const fakeManager = {
          findOne: jest.fn().mockResolvedValue(MOCK_CONFIG_ROWS[0]),
          update: jest.fn().mockResolvedValue(undefined),
        };
        // Wire AuditLogService.log() inside TX — manager.getRepository()
        fakeManager['getRepository'] = jest.fn().mockReturnValue({
          insert: jest.fn().mockResolvedValue(undefined),
        });
        const result = await cb(fakeManager);
        return result;
      });
      // findOne after update inside TX
      mockDataSource.transaction.mockImplementation(async (cb: (manager: any) => Promise<any>) => {
        let callCount = 0;
        const fakeManager = {
          findOne: jest.fn().mockImplementation(() => {
            callCount++;
            return callCount === 1 ? MOCK_CONFIG_ROWS[0] : updatedRow;
          }),
          update: jest.fn().mockResolvedValue(undefined),
          getRepository: jest.fn().mockReturnValue({
            insert: jest.fn().mockResolvedValue(undefined),
          }),
        };
        return cb(fakeManager);
      });

      const res = await request(app.getHttpServer())
        .patch('/api/v1/admin/system/config/maintenance_mode')
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ value: true })
        .expect(200);

      expect(res.body.key).toBe('maintenance_mode');
      expect(res.body.value).toBe(true);
    });

    it('Admin cannot PATCH /admin/system/config/:key (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/admin/system/config/maintenance_mode')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ value: true })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

  });

  // ── 4. Admin Users ─────────────────────────────────────────────────────────

  describe('4. Admin Users', () => {
    const TARGET_USER_ID = randomUUID();

    beforeEach(() => {
      const u = makeUser({ id: TARGET_USER_ID, email: 'target@test.com' });
      userDb.set(TARGET_USER_ID, u);

      mockUserRepo.findById.mockImplementation(async (id: string) =>
        userDb.get(id) ?? null,
      );
      mockUserRepo.update.mockImplementation(async (user: User) => {
        userDb.set(user.id.value, user);
        return user;
      });
      mockUserRepo.getPrimaryRole.mockResolvedValue('User');
      mockUserRepo.assignRole.mockResolvedValue(undefined);

      mockUserRepo.findAllPaginated.mockResolvedValue({
        data: [
          {
            id: TARGET_USER_ID,
            fullName: 'Test User',
            email: 'target@test.com',
            phoneE164: null,
            isSuspended: false,
            createdAt: new Date(),
            role: 'User',
          },
        ],
        meta: { total: 1, page: 1, limit: 50, totalPages: 1 },
      });
    });

    it('GET /admin/users returns paginated user list', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].email).toBe('target@test.com');
    });

    it('GET /admin/users/:id returns single user', async () => {
      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${TARGET_USER_ID}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.id).toBe(TARGET_USER_ID);
      expect(res.body.isSuspended).toBe(false);
    });

    it('GET /admin/users/:id returns 404 for unknown user', async () => {
      const unknownId = randomUUID();
      mockUserRepo.findById.mockResolvedValueOnce(null);

      const res = await request(app.getHttpServer())
        .get(`/api/v1/admin/users/${unknownId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(404);

      expect(res.body.error.code).toBe('USER_NOT_FOUND');
    });

    it('POST /admin/users/:id/suspend — suspends an active user (200)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${TARGET_USER_ID}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.isSuspended).toBe(true);
      expect(res.body.suspendedAt).toBeTruthy();

      // Verify user was updated in DB
      expect(mockUserRepo.update).toHaveBeenCalled();
    });

    it('POST /admin/users/:id/suspend — idempotent when already suspended (200)', async () => {
      const suspended = makeUser({ id: TARGET_USER_ID, email: 'target@test.com', isSuspended: true });
      userDb.set(TARGET_USER_ID, suspended);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${TARGET_USER_ID}/suspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.isSuspended).toBe(true);
      // mockUserRepo.update must NOT have been called (no mutation needed)
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('POST /admin/users/:id/unsuspend — unsuspends a suspended user (200)', async () => {
      const suspended = makeUser({ id: TARGET_USER_ID, email: 'target@test.com', isSuspended: true });
      userDb.set(TARGET_USER_ID, suspended);

      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${TARGET_USER_ID}/unsuspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.isSuspended).toBe(false);
      expect(res.body.suspendedAt).toBeNull();
      expect(mockUserRepo.update).toHaveBeenCalled();
    });

    it('POST /admin/users/:id/unsuspend — idempotent when already active (200)', async () => {
      // User is already active (not suspended)
      const res = await request(app.getHttpServer())
        .post(`/api/v1/admin/users/${TARGET_USER_ID}/unsuspend`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.isSuspended).toBe(false);
      expect(mockUserRepo.update).not.toHaveBeenCalled();
    });

    it('PATCH /admin/users/:id/role — SuperAdmin assigns role (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}/role`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ role: 'Editor' })
        .expect(200);

      expect(res.body.id).toBe(TARGET_USER_ID);
      expect(res.body.role).toBe('Editor');
      expect(mockUserRepo.assignRole).toHaveBeenCalledWith(TARGET_USER_ID, 'Editor');
    });

    it('PATCH /admin/users/:id/role — rejects invalid role name (400)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}/role`)
        .set('Authorization', `Bearer ${superAdminToken}`)
        .send({ role: 'GodMode' })
        .expect(400);

      expect(res.body.error.code).toBe('INVALID_ROLE');
    });

    it('PATCH /admin/users/:id/role — Admin cannot assign role (403)', async () => {
      const res = await request(app.getHttpServer())
        .patch(`/api/v1/admin/users/${TARGET_USER_ID}/role`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ role: 'Editor' })
        .expect(403);

      expect(res.body.error.code).toBe('FORBIDDEN');
    });

  });

  // ── 5. Audit Log ───────────────────────────────────────────────────────────

  describe('5. Audit Log', () => {

    it('GET /admin/audit-log returns paginated entries (200)', async () => {
      // Stub the createQueryBuilder chain used by AuditLogService.list()
      mockDataSource.getRepository.mockReturnValue({
        createQueryBuilder: jest.fn().mockReturnValue({
          orderBy: jest.fn().mockReturnThis(),
          skip: jest.fn().mockReturnThis(),
          take: jest.fn().mockReturnThis(),
          andWhere: jest.fn().mockReturnThis(),
          getManyAndCount: jest.fn().mockResolvedValue([
            [
              {
                id: randomUUID(),
                actorId: ADMIN_ID,
                actorRole: 'Admin',
                action: 'user.suspend',
                entityType: 'user',
                entityId: randomUUID(),
                oldValue: null,
                newValue: { isSuspended: true },
                ipAddress: '127.0.0.1',
                createdAt: new Date(),
              },
            ],
            1,
          ]),
        }),
      });

      // Cross-BC enrichment query (actor name from id_users)
      mockDataSource.query.mockResolvedValueOnce([
        { id: ADMIN_ID, full_name: 'Admin User' },
      ]);

      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/audit-log')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].action).toBe('user.suspend');
      expect(res.body.meta.total).toBe(1);
    });

  });

  // ── 6. Auth — 401 without token ────────────────────────────────────────────

  describe('6. Unauthenticated access — all endpoints return 401', () => {

    it('GET /admin/analytics/overview → 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/analytics/overview')
        .expect(401);
    });

    it('GET /admin/system/config → 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/system/config')
        .expect(401);
    });

    it('GET /admin/users → 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/users')
        .expect(401);
    });

    it('GET /admin/audit-log → 401 without token', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/audit-log')
        .expect(401);
    });

  });
});
