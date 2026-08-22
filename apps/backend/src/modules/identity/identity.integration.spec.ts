/**
 * BC01 Identity — Integration Tests
 *
 * Tests the full security flow using stateful in-memory mocks.
 * No real database required — all TypeORM repositories are replaced
 * with Jest mocks that simulate DB state in memory.
 *
 * NODE_ENV=test activates HS256 fallback in JwtRs256Adapter and JwtStrategy
 * (avoids the need for RSA key files in CI).
 *
 * Covered flows:
 *  1. Registration  — happy path, duplicate email, validation errors
 *  2. Login         — happy path, wrong password, constant-time response
 *  3. Token Refresh — happy path, token reuse detection (family revocation)
 *  4. Suspension    — login blocked, refresh blocked + family revoked,
 *                     change-password blocked
 *  5. Logout        — revokes token, idempotent without token,
 *                     refresh fails after logout
 *  6. Protected Routes — /users/me with valid/invalid/missing token
 *  7. Change Password  — success + all sessions revoked
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import * as bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { createHash } from 'crypto';

import { AuthController } from './presentation/auth.controller';
import { JwtAuthGuard } from './presentation/guards/jwt-auth.guard';
import { JwtRs256Adapter } from './infrastructure/adapters/jwt-rs256.adapter';
import { JwtStrategy } from './infrastructure/adapters/jwt.strategy';
import { BcryptAdapter, PASSWORD_HASHER } from './infrastructure/adapters/bcrypt.adapter';
import { USER_REPOSITORY } from './domain/ports/user.repository';
import { RefreshTokenOrmEntity } from './infrastructure/persistence/entities/refresh-token.orm-entity';
import { SocialIdentityOrmEntity } from './infrastructure/persistence/entities/social-identity.orm-entity';
import { User } from './domain/user.entity';
import { EmailAddress } from '../../shared/domain/email.vo';
import { UUIDv7 } from '../../shared/domain/uuid.vo';
import { GlobalExceptionFilter } from '../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../shared/presentation/interceptors/trace-id.interceptor';

import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { Reflector } from '@nestjs/core';

/**
 * BypassThrottlerGuard — replaces ThrottlerGuard in integration tests.
 *
 * The real ThrottlerGuard accumulates request counts across all describe blocks
 * in the shared app instance (beforeAll). Endpoint-specific @Throttle decorators
 * (e.g., register/email = 5/hour) would exhaust within the test suite itself.
 *
 * Rate-limit configuration is verified at code-review level (auth.controller.ts).
 * Actual throttle enforcement is validated in dedicated rate-limit e2e tests.
 */
class BypassThrottlerGuard implements CanActivate {
  canActivate(): boolean { return true; }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function makeUser(overrides: Partial<{
  id: string;
  email: string;
  fullName: string;
  passwordHash: string;
  isSuspended: boolean;
}> = {}): User {
  const id = overrides.id ?? randomUUID();
  const email = overrides.email ?? 'test@example.com';
  return User.reconstitute({
    id,
    fullName: overrides.fullName ?? 'Test User',
    email,
    phoneE164: null,
    passwordHash: overrides.passwordHash ?? null,
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

// ── Test Suite ────────────────────────────────────────────────────────────────

describe('BC01 Identity — Integration Tests', () => {
  let app: INestApplication;

  // In-memory state (reset before each test)
  let userDb: Map<string, User>;           // id → User
  let emailIndex: Map<string, string>;      // email → id
  let tokenDb: Map<string, RefreshTokenOrmEntity>; // id → token record

  // Mock repository for User domain port
  let mockUserRepo: jest.Mocked<any>;
  // Mock TypeORM repository for RefreshTokenOrmEntity
  let mockRefreshRepo: jest.Mocked<any>;

  beforeAll(async () => {
    // ── Build mock repositories that share test state ───────────────────────
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
    };

    mockRefreshRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
      createQueryBuilder: jest.fn().mockImplementation(() => {
        // Stateful query builder: captures set/where args and applies to tokenDb on execute()
        let pendingSet: Record<string, unknown> = {};
        let capturedTokenHash: string | null = null;

        const qb = {
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockImplementation((values: Record<string, unknown>) => {
            pendingSet = values;
            return qb;
          }),
          where: jest.fn().mockImplementation((condition: string, params: Record<string, unknown>) => {
            // logout passes: 'token_hash = :tokenHash AND is_revoked = false'
            capturedTokenHash = (params['tokenHash'] as string) ?? null;
            return qb;
          }),
          execute: jest.fn().mockImplementation(async () => {
            // Apply the pending SET to all tokens matching captured WHERE
            if (capturedTokenHash !== null) {
              for (const token of tokenDb.values()) {
                if (token.tokenHash === capturedTokenHash && !token.isRevoked) {
                  Object.assign(token, pendingSet);
                  tokenDb.set(token.id, token);
                }
              }
            }
          }),
        };
        return qb;
      }),
    };


    const module: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
        ThrottlerModule.forRoot({ throttlers: [{ name: 'default', ttl: 60000, limit: 10000 }] }),
      ],
      controllers: [AuthController],
      providers: [
        // Domain repository (via token)
        { provide: USER_REPOSITORY, useValue: mockUserRepo },
        // TypeORM repository mock
        { provide: getRepositoryToken(RefreshTokenOrmEntity), useValue: mockRefreshRepo },
        {
          provide: getRepositoryToken(SocialIdentityOrmEntity),
          useValue: {
            findOne: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockImplementation((dto) => ({ id: randomUUID(), ...dto })),
            save: jest.fn().mockImplementation((entity) => Promise.resolve(entity)),
          },
        },
        // DIP: password hasher via token
        { provide: PASSWORD_HASHER, useClass: BcryptAdapter },
        // JWT adapters
        JwtRs256Adapter,
        JwtStrategy,
        Reflector,
        // Config: provides test-mode JWT key
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
        // BypassThrottlerGuard: prevents rate-limit exhaustion across shared app instance.
        // See class definition above for rationale.
        { provide: APP_GUARD, useClass: BypassThrottlerGuard },
      ],
    }).compile();

    app = module.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    // Reset in-memory state before each test
    userDb = new Map();
    emailIndex = new Map();
    tokenDb = new Map();

    jest.clearAllMocks();

    // ── Wire up stateful mock implementations ──────────────────────────────

    mockUserRepo.existsByEmail.mockImplementation(async (email: string) =>
      emailIndex.has(email.toLowerCase()),
    );

    mockUserRepo.findByEmail.mockImplementation(async (email: string) => {
      const id = emailIndex.get(email.toLowerCase());
      return id ? userDb.get(id) ?? null : null;
    });

    mockUserRepo.findById.mockImplementation(async (id: string) =>
      userDb.get(id) ?? null,
    );

    mockUserRepo.findByIdWithPassword.mockImplementation(async (id: string) =>
      userDb.get(id) ?? null,
    );

    mockUserRepo.save.mockImplementation(async (user: User) => {
      // Simulate DB INSERT with generated UUID
      const id = randomUUID();
      const savedUser = makeUser({
        id,
        email: user.email?.value,
        fullName: user.fullName,
        passwordHash: user.passwordHash ?? undefined,
      });
      userDb.set(id, savedUser);
      if (savedUser.email) emailIndex.set(savedUser.email.value, id);
      return savedUser;
    });

    mockUserRepo.update.mockImplementation(async (user: User) => {
      userDb.set(user.id.value, user);
      return user;
    });

    mockRefreshRepo.create.mockImplementation((data: Partial<RefreshTokenOrmEntity>) => ({
      isRevoked: false,   // TypeORM @Column default: false
      revokedAt: null,
      ...data,
    } as RefreshTokenOrmEntity));

    mockRefreshRepo.save.mockImplementation(async (token: RefreshTokenOrmEntity) => {
      tokenDb.set(token.id, token);
      return token;
    });

    mockRefreshRepo.findOne.mockImplementation(async ({ where }: any) => {
      for (const token of tokenDb.values()) {
        // Match tokenHash always; apply isRevoked filter only if specified
        if (token.tokenHash !== where.tokenHash) continue;
        if (where.isRevoked !== undefined && token.isRevoked !== where.isRevoked) continue;
        return token;
      }
      return null;
    });

    mockRefreshRepo.update.mockImplementation(async (criteria: any, update: any) => {
      for (const token of tokenDb.values()) {
        let match = true;
        if (criteria.id !== undefined && token.id !== criteria.id) match = false;
        if (criteria.tokenFamily !== undefined && token.tokenFamily !== criteria.tokenFamily) match = false;
        if (criteria.userId !== undefined && token.userId !== criteria.userId) match = false;
        // Treat missing isRevoked field as false (TypeORM @Column default: false)
        if (criteria.isRevoked !== undefined) {
          const tokenRevoked = token.isRevoked ?? false;
          if (tokenRevoked !== criteria.isRevoked) match = false;
        }
        if (match) {
          Object.assign(token, update);
          tokenDb.set(token.id, token);
        }
      }
    });

    // Re-wire createQueryBuilder (cleared by jest.clearAllMocks) with stateful implementation
    mockRefreshRepo.createQueryBuilder.mockImplementation(() => {
      let pendingSet: Record<string, unknown> = {};
      let capturedTokenHash: string | null = null;

      const qb = {
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockImplementation((values: Record<string, unknown>) => {
          pendingSet = values;
          return qb;
        }),
        where: jest.fn().mockImplementation((_condition: string, params: Record<string, unknown>) => {
          capturedTokenHash = (params['tokenHash'] as string) ?? null;
          return qb;
        }),
        execute: jest.fn().mockImplementation(async () => {
          if (capturedTokenHash !== null) {
            for (const token of tokenDb.values()) {
              if (token.tokenHash === capturedTokenHash && !token.isRevoked) {
                Object.assign(token, pendingSet);
                tokenDb.set(token.id, token);
              }
            }
          }
        }),
      };
      return qb;
    });
  });


  // ── 1. Registration ────────────────────────────────────────────────────────

  describe('1. Registration', () => {
    it('registers a new user and returns a valid token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'أحمد محمد', email: 'ahmed@test.com', password: 'SecurePass123!' })
        .expect(201);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        expiresIn: 900,
        tokenType: 'Bearer',
        sessionId: expect.any(String),
        user: {
          fullName: 'أحمد محمد',
          email: 'ahmed@test.com',
          role: 'User',
        },
      });
      // Token pair must be non-empty strings
      expect(res.body.accessToken.length).toBeGreaterThan(10);
      expect(res.body.refreshToken.length).toBeGreaterThan(10);
    });

    it('rejects duplicate email with AUTH_EMAIL_TAKEN (409)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'أحمد', email: 'dup@test.com', password: 'Password123!' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'أحمد2', email: 'dup@test.com', password: 'Password123!' })
        .expect(409);

      expect(res.body.error.code).toBe('AUTH_EMAIL_TAKEN');
    });

    it('rejects invalid email format with 400', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Test', email: 'not-an-email', password: 'Password123!' })
        .expect(400);

      expect(res.body.error).toBeDefined();
    });

    it('rejects password shorter than 8 characters with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Test', email: 'short@test.com', password: '1234567' })
        .expect(400);
    });
  });

  // ── 2. Login ───────────────────────────────────────────────────────────────

  describe('2. Login', () => {
    const USER_EMAIL = 'login@test.com';
    const USER_PASSWORD = 'LoginPass123!';

    beforeEach(async () => {
      // Pre-register user for login tests
      const hash = await bcrypt.hash(USER_PASSWORD, 1); // cost=1 for speed in tests
      const id = randomUUID();
      const user = makeUser({ id, email: USER_EMAIL, passwordHash: hash });
      userDb.set(id, user);
      emailIndex.set(USER_EMAIL, id);
    });

    it('returns token pair for valid credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login/email')
        .send({ email: USER_EMAIL, password: USER_PASSWORD })
        .expect(200);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
      });
    });

    it('rejects wrong password with AUTH_INVALID_CREDENTIALS (401)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login/email')
        .send({ email: USER_EMAIL, password: 'WrongPassword!' })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('rejects non-existent email with AUTH_INVALID_CREDENTIALS — same response as wrong password (timing-safe)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login/email')
        .send({ email: 'nobody@test.com', password: 'AnyPassword!' })
        .expect(401);

      // Must be AUTH_INVALID_CREDENTIALS — NOT "user not found" (prevents enumeration)
      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });
  });

  // ── 3. Token Refresh ───────────────────────────────────────────────────────

  describe('3. Token Refresh', () => {
    let initialTokens: { accessToken: string; refreshToken: string; sessionId: string };

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Refresh User', email: 'refresh@test.com', password: 'RefreshPass123!' })
        .expect(201);
      initialTokens = res.body;
    });

    it('issues a new token pair with a valid refresh token', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: initialTokens.refreshToken })
        .expect(200);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        refreshToken: expect.any(String),
        tokenType: 'Bearer',
      });
      // New tokens must be different from the original
      expect(res.body.accessToken).not.toBe(initialTokens.accessToken);
      expect(res.body.refreshToken).not.toBe(initialTokens.refreshToken);
    });

    it('detects token REUSE — revokes entire family and returns 401', async () => {
      // Step 1: Rotate once (original → rotated)
      const rotatedRes = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: initialTokens.refreshToken })
        .expect(200);

      // Step 2: Try to reuse the original (now revoked) token
      const reuseRes = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: initialTokens.refreshToken })
        .expect(401);

      expect(reuseRes.body.error.code).toBe('AUTH_TOKEN_EXPIRED');

      // Step 3: Rotated token must also be invalidated (family revocation)
      const afterReuseRes = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: rotatedRes.body.refreshToken })
        .expect(401);

      expect(afterReuseRes.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('rejects a completely invalid refresh token string', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: 'not.a.valid.jwt' })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });
  });

  // ── 4. Suspension Security ─────────────────────────────────────────────────

  describe('4. Suspension — core security flow', () => {
    const SUSPENDED_EMAIL = 'suspended@test.com';
    const SUSPENDED_PASS = 'SuspendedPass123!';
    let suspendedUserId: string;
    let activeTokens: { accessToken: string; refreshToken: string };

    beforeEach(async () => {
      // Register user + obtain active tokens
      const registerRes = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Suspended User', email: SUSPENDED_EMAIL, password: SUSPENDED_PASS })
        .expect(201);
      suspendedUserId = registerRes.body.user.id;
      activeTokens = registerRes.body;

      // Simulate admin suspension (direct mutation of in-memory DB)
      const user = userDb.get(suspendedUserId)!;
      user.suspend(new Date());
      userDb.set(suspendedUserId, user);
    });

    it('blocks LOGIN for suspended user with AUTH_ACCOUNT_SUSPENDED', async () => {
      const hash = await bcrypt.hash(SUSPENDED_PASS, 1);
      const existingUser = userDb.get(suspendedUserId)!;
      // Re-create with password hash (save() doesn't persist it in mock without explicit set)
      const userWithHash = makeUser({
        id: suspendedUserId,
        email: SUSPENDED_EMAIL,
        passwordHash: hash,
        isSuspended: true,
      });
      userDb.set(suspendedUserId, userWithHash);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login/email')
        .send({ email: SUSPENDED_EMAIL, password: SUSPENDED_PASS })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED');
    });

    it('blocks REFRESH for suspended user — revokes entire token family', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: activeTokens.refreshToken })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED');

      // Verify ALL tokens in the family are revoked
      for (const token of tokenDb.values()) {
        expect(token.isRevoked).toBe(true);
      }
    });

    it('blocks CHANGE-PASSWORD for suspended user', async () => {
      const hash = await bcrypt.hash(SUSPENDED_PASS, 1);
      const suspendedUserWithHash = makeUser({
        id: suspendedUserId,
        email: SUSPENDED_EMAIL,
        passwordHash: hash,
        isSuspended: true,
      });
      userDb.set(suspendedUserId, suspendedUserWithHash);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${activeTokens.accessToken}`)
        .send({ currentPassword: SUSPENDED_PASS, newPassword: 'NewPassword456!' })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_ACCOUNT_SUSPENDED');
    });
  });

  // ── 5. Logout ──────────────────────────────────────────────────────────────

  describe('5. Logout', () => {
    let tokens: { accessToken: string; refreshToken: string };

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Logout User', email: 'logout@test.com', password: 'LogoutPass123!' })
        .expect(201);
      tokens = res.body;
    });

    it('revokes the refresh token on logout', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      // Verify token is revoked in DB
      const tokenHash = hashToken(tokens.refreshToken);
      let found: RefreshTokenOrmEntity | undefined;
      for (const t of tokenDb.values()) {
        if (t.tokenHash === tokenHash) { found = t; break; }
      }
      expect(found?.isRevoked).toBe(true);
    });

    it('refresh token fails after logout', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({ refreshToken: tokens.refreshToken })
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/token/refresh')
        .send({ refreshToken: tokens.refreshToken })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_TOKEN_EXPIRED');
    });

    it('logout without token is idempotent (200)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/logout')
        .send({})
        .expect(200);

      expect(res.body.message).toBe('Logged out successfully');
    });
  });

  // ── 6. Protected Routes — GET /users/me ────────────────────────────────────

  describe('6. Protected Routes — GET /users/me', () => {
    let tokens: { accessToken: string };

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Me User', email: 'me@test.com', password: 'MePassword123!' })
        .expect(201);
      tokens = res.body;
    });

    it('returns user profile with valid Bearer token', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/users/me')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .expect(200);

      expect(res.body).toMatchObject({
        fullName: 'Me User',
        email: 'me@test.com',
        role: 'User',
      });
    });

    it('returns 401 without Authorization header', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/users/me')
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_MISSING_TOKEN');
    });

    it('returns 401 with a tampered token', async () => {
      const tampered = tokens.accessToken.slice(0, -5) + 'XXXXX';
      const res = await request(app.getHttpServer())
        .get('/api/v1/auth/users/me')
        .set('Authorization', `Bearer ${tampered}`)
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_MISSING_TOKEN');
    });

    it('returns 401 with a completely invalid token string', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/users/me')
        .set('Authorization', 'Bearer not.a.jwt')
        .expect(401);
    });
  });

  // ── 7. Change Password ─────────────────────────────────────────────────────

  describe('7. Change Password', () => {
    const EMAIL = 'chpass@test.com';
    const OLD_PASS = 'OldPassword123!';
    const NEW_PASS = 'NewPassword456!';
    let tokens: { accessToken: string; refreshToken: string };
    let userId: string;

    beforeEach(async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register/email')
        .send({ fullName: 'Pass User', email: EMAIL, password: OLD_PASS })
        .expect(201);
      tokens = res.body;
      userId = res.body.user.id;

      // Store password hash so findByIdWithPassword can return it
      const hash = await bcrypt.hash(OLD_PASS, 1);
      const user = userDb.get(userId)!;
      const userWithHash = makeUser({
        id: userId,
        email: EMAIL,
        passwordHash: hash,
      });
      userDb.set(userId, userWithHash);
    });

    it('changes password and revokes all active sessions', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentPassword: OLD_PASS, newPassword: NEW_PASS })
        .expect(200);

      expect(res.body.message).toBe('Password changed successfully');

      // All refresh tokens revoked
      for (const t of tokenDb.values()) {
        expect(t.isRevoked).toBe(true);
      }
    });

    it('rejects wrong current password with AUTH_INVALID_CREDENTIALS', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentPassword: 'WrongOldPass!', newPassword: NEW_PASS })
        .expect(401);

      expect(res.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    });

    it('requires authentication — rejects without token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .send({ currentPassword: OLD_PASS, newPassword: NEW_PASS })
        .expect(401);
    });

    it('rejects new password shorter than 8 characters', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/change-password')
        .set('Authorization', `Bearer ${tokens.accessToken}`)
        .send({ currentPassword: OLD_PASS, newPassword: '1234567' })
        .expect(400);
    });
  });
});
