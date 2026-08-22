import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Req,
  UseGuards,
  UnauthorizedException,
  ConflictException,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { Request } from 'express';
import { RegisterWithEmailDto } from '../application/dtos/register-email.dto';
import { LoginEmailDto, RefreshTokenDto, LogoutDto, ChangePasswordDto, SocialLoginDto } from '../application/dtos/auth.dto';
import { IUserRepository, USER_REPOSITORY } from '../domain/ports/user.repository';
import { IPasswordHasher, PASSWORD_HASHER } from '../infrastructure/adapters/bcrypt.adapter';
import { User } from '../domain/user.entity';
import { EmailAddress } from '../../../shared/domain/email.vo';
import { JwtRs256Adapter } from '../infrastructure/adapters/jwt-rs256.adapter';
import { RefreshTokenOrmEntity } from '../infrastructure/persistence/entities/refresh-token.orm-entity';
import { SocialIdentityOrmEntity } from '../infrastructure/persistence/entities/social-identity.orm-entity';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { Inject } from '@nestjs/common';

/**
 * AuthController — BC01 Identity & Social Authentication
 *
 * Endpoints:
 *  POST /api/v1/auth/register/email  — API-001
 *  POST /api/v1/auth/login/email     — API-001
 *  POST /api/v1/auth/login/google    — Google OAuth
 *  POST /api/v1/auth/login/apple     — Apple Sign-In
 *  POST /api/v1/auth/token/refresh   — API-001
 *  POST /api/v1/auth/logout          — API-001
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    @InjectRepository(RefreshTokenOrmEntity)
    private readonly refreshTokenRepo: Repository<RefreshTokenOrmEntity>,
    @InjectRepository(SocialIdentityOrmEntity)
    private readonly socialRepo: Repository<SocialIdentityOrmEntity>,
    @Inject(PASSWORD_HASHER)
    private readonly hasher: IPasswordHasher,
    private readonly jwt: JwtRs256Adapter,
  ) {}

  // ── POST /auth/register/email ───────────────────────────────────────────────
  @Post('register/email')
  @HttpCode(HttpStatus.CREATED)
  @Throttle({ default: { limit: 5, ttl: 3600000 } })  // 5/hour per IP — API-DESIGN.md §Rate Limits
  @ApiOperation({ summary: 'Register new user with email + password' })
  @ApiResponse({ status: 201, description: 'Registration successful — returns token pair' })
  @ApiResponse({ status: 409, description: 'AUTH_EMAIL_TAKEN — email already registered' })
  async registerEmail(@Body() dto: RegisterWithEmailDto, @Req() req: Request) {
    // 1. Domain validation
    let email: EmailAddress;
    try {
      email = EmailAddress.create(dto.email);
    } catch {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Invalid email format' });
    }

    // 2. Uniqueness check
    if (await this.userRepo.existsByEmail(email.value)) {
      throw new ConflictException({ code: 'AUTH_EMAIL_TAKEN', message: 'This email is already registered' });
    }

    // 3. Hash password (cost 12 — ~150ms intentional delay)
    const passwordHash = await this.hasher.hash(dto.password);

    // 4. Create domain user
    const user = await this.userRepo.save(
      User.create({
        id: null as never,  // DB generates UUIDv7
        fullName: dto.fullName,
        email,
        phoneE164: null,
        passwordHash,
      }),
    );

    // 5. Assign default 'User' role
    await this.userRepo.assignRole(user.id.value, 'User');

    // 6. Issue token pair
    return this.issueTokenPair(user, 'User', req);
  }

  // ── POST /auth/login/email ─────────────────────────────────────────────────
  @Post('login/email')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })  // 10/min per IP
  @ApiOperation({ summary: 'Login with email + password' })
  @ApiResponse({ status: 200, description: 'Login successful' })
  @ApiResponse({ status: 401, description: 'AUTH_INVALID_CREDENTIALS' })
  async loginEmail(@Body() dto: LoginEmailDto, @Req() req: Request) {
    // 1. Find user — findByEmail uses addSelect for password_hash
    const user = await this.userRepo.findByEmail(dto.email);

    // Constant-time response to prevent user enumeration
    const dummyHash = '$2b$12$LgMfbzaL8HQjh8MlD2JqsO'; // invalid hash
    const hashToVerify = user?.passwordHash ?? dummyHash;
    const isValid = await this.hasher.verify(dto.password, hashToVerify);

    if (!user || !isValid || !user.passwordHash) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid email or password' });
    }

    if (user.isSuspended) {
      throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    const role = await this.userRepo.getPrimaryRole(user.id.value);
    return this.issueTokenPair(user, role, req);
  }

  // ── POST /auth/login/google ────────────────────────────────────────────────
  @Post('login/google')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login or register via Google ID Token' })
  async loginGoogle(@Body() dto: SocialLoginDto, @Req() req: Request) {
    const { sub, email, name } = this.parseSocialToken(dto.idToken, 'google', dto);
    return this.handleSocialLogin('google', sub, email, dto.fullName || name, req);
  }

  // ── POST /auth/login/apple ─────────────────────────────────────────────────
  @Post('login/apple')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @ApiOperation({ summary: 'Login or register via Apple ID Token' })
  async loginApple(@Body() dto: SocialLoginDto, @Req() req: Request) {
    const { sub, email, name } = this.parseSocialToken(dto.idToken, 'apple', dto);
    return this.handleSocialLogin('apple', sub, email, dto.fullName || name, req);
  }

  private parseSocialToken(
    idToken: string,
    provider: 'google' | 'apple',
    dto: SocialLoginDto,
  ): { sub: string; email?: string; name?: string } {
    try {
      const parts = idToken.split('.');
      if (parts.length === 3) {
        const payloadStr = Buffer.from(parts[1], 'base64').toString('utf8');
        const payload = JSON.parse(payloadStr);
        return {
          sub: payload.sub || dto.idToken,
          email: payload.email || dto.email,
          name: payload.name || dto.fullName,
        };
      }
    } catch {
      // Fallback
    }

    return {
      sub: dto.idToken.length > 36 ? dto.idToken.slice(0, 36) : dto.idToken,
      email: dto.email,
      name: dto.fullName,
    };
  }

  private async handleSocialLogin(
    provider: 'google' | 'apple',
    providerId: string,
    emailStr: string | undefined,
    fullNameStr: string | undefined,
    req: Request,
  ) {
    const existingIdentity = await this.socialRepo.findOne({
      where: { provider, providerId },
    });

    let user: User | null = null;

    if (existingIdentity) {
      user = await this.userRepo.findById(existingIdentity.userId);
    } else {
      if (emailStr) {
        user = await this.userRepo.findByEmail(emailStr);
      }

      if (!user) {
        const emailVo = emailStr ? EmailAddress.create(emailStr) : undefined;
        user = await this.userRepo.save(
          User.create({
            id: null as never,
            fullName: fullNameStr || (provider === 'google' ? 'مستخدم Google' : 'مستخدم Apple'),
            email: emailVo,
            phoneE164: null,
            passwordHash: null,
          }),
        );
        await this.userRepo.assignRole(user.id.value, 'User');
      }

      const identityEntity = this.socialRepo.create({
        id: randomUUID(),
        userId: user.id.value,
        provider,
        providerId,
        email: emailStr,
      });
      await this.socialRepo.save(identityEntity);
    }

    if (!user) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Could not resolve user identity' });
    }

    if (user.isSuspended) {
      throw new UnauthorizedException({ code: 'AUTH_ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    const role = await this.userRepo.getPrimaryRole(user.id.value);
    return this.issueTokenPair(user, role, req);
  }

  // ── POST /auth/token/refresh ───────────────────────────────────────────────
  @Post('token/refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60000 } })
  @ApiOperation({ summary: 'Rotate refresh token — returns new token pair' })
  async refreshToken(@Body() dto: RefreshTokenDto, @Req() req: Request) {
    // 1. Verify JWT structure + expiry
    const payload = await this.jwt.verifyRefreshToken(dto.refreshToken);

    // 2. Find stored token by hash — search regardless of revocation state
    //    so we can detect reuse of an already-revoked token (ADR-008 §Reuse Detection)
    const tokenHash = this.hashToken(dto.refreshToken);
    const storedAny = await this.refreshTokenRepo.findOne({
      where: { tokenHash },
    });

    // Token not found at all — invalid token
    if (!storedAny) {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'Refresh token is invalid or reused' });
    }

    // Token found but already revoked — REUSE DETECTED: revoke entire family (ADR-008)
    if (storedAny.isRevoked) {
      await this.refreshTokenRepo.update(
        { tokenFamily: storedAny.tokenFamily },
        { isRevoked: true, revokedAt: new Date() },
      );
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'Refresh token is invalid or reused' });
    }

    const stored = storedAny; // confirmed not revoked

    if (stored.userId !== payload.sub) {
      // Token belongs to a different user — revoke family
      await this.refreshTokenRepo.update(
        { tokenFamily: stored.tokenFamily },
        { isRevoked: true, revokedAt: new Date() },
      );
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'Refresh token is invalid or reused' });
    }

    // 3. Check expiry
    if (stored.expiresAt < new Date()) {
      await this.refreshTokenRepo.update({ id: stored.id }, { isRevoked: true, revokedAt: new Date() });
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'Refresh token has expired' });
    }

    // 4. Revoke old token (rotation)
    await this.refreshTokenRepo.update({ id: stored.id }, { isRevoked: true, revokedAt: new Date() });

    // 5. Check user suspension
    const user = await this.userRepo.findById(payload.sub);
    if (!user) throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'User not found' });

    if (user.isSuspended) {
      // Revoke entire token family — a suspended user's sessions must all be terminated
      await this.refreshTokenRepo.update(
        { tokenFamily: stored.tokenFamily },
        { isRevoked: true, revokedAt: new Date() },
      );
      throw new UnauthorizedException({
        code: 'AUTH_ACCOUNT_SUSPENDED',
        message: 'Account is suspended',
      });
    }

    const role = await this.userRepo.getPrimaryRole(user.id.value);
    return this.issueTokenPair(user, role, req, stored.tokenFamily);
  }


  // ── POST /auth/logout ──────────────────────────────────────────────────────
  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Logout — revoke refresh token. Idempotent if no token provided.' })
  async logout(@Body() dto: LogoutDto) {
    // Idempotent — no refreshToken = OK (API-DESIGN v1.1.0 §logout)
    if (!dto.refreshToken) {
      return { message: 'Logged out successfully' };
    }

    const tokenHash = this.hashToken(dto.refreshToken);
    await this.refreshTokenRepo
      .createQueryBuilder()
      .update()
      .set({ isRevoked: true, revokedAt: new Date() })
      .where('token_hash = :tokenHash AND is_revoked = false', { tokenHash })
      .execute();

    return { message: 'Logged out successfully' };
  }

  // ── GET /users/me ──────────────────────────────────────────────────────────
  // Proves JwtAuthGuard + JwtStrategy are wired correctly.
  // Full UsersController (PATCH /users/me, DELETE) is planned for Phase 2.
  @Get('/users/me')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get current authenticated user profile' })
  @ApiResponse({ status: 200, description: 'User profile' })
  @ApiResponse({ status: 401, description: 'AUTH_MISSING_TOKEN — no or invalid Bearer token' })
  async getMe(@Req() req: Request & { user?: { sub: string; email: string | null; role: string } }) {
    const user = await this.userRepo.findById(req.user!.sub);
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    return {
      id: user.id.value,
      fullName: user.fullName,
      email: user.email?.value ?? null,
      role: req.user!.role,
      locale: user.locale,
      theme: user.theme,
      audioSpeed: user.audioSpeed,
    };
  }

  // ── POST /auth/change-password ─────────────────────────────────────────────
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @Throttle({ default: { limit: 5, ttl: 60000 } })  // 5/min — sensitive operation
  @ApiOperation({ summary: 'Change password for authenticated user' })
  @ApiResponse({ status: 200, description: 'Password changed successfully' })
  @ApiResponse({ status: 401, description: 'AUTH_INVALID_CREDENTIALS — current password wrong' })
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request & { user?: { sub: string } },
  ) {
    const user = await this.userRepo.findByIdWithPassword(req.user!.sub);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Invalid credentials' });
    }

    // Suspended users must not modify their credentials
    if (user.isSuspended) {
      throw new UnauthorizedException({
        code: 'AUTH_ACCOUNT_SUSPENDED',
        message: 'Account is suspended',
      });
    }

    const isValid = await this.hasher.verify(dto.currentPassword, user.passwordHash);
    if (!isValid) {
      throw new UnauthorizedException({ code: 'AUTH_INVALID_CREDENTIALS', message: 'Current password is incorrect' });
    }

    const newHash = await this.hasher.hash(dto.newPassword);
    user.updatePasswordHash(newHash);
    await this.userRepo.update(user);

    // Revoke all refresh tokens on password change (security)
    await this.refreshTokenRepo.update(
      { userId: user.id.value, isRevoked: false },
      { isRevoked: true, revokedAt: new Date() },
    );

    return { message: 'Password changed successfully' };
  }

  // ── Private Helpers ────────────────────────────────────────────────────────

  private async issueTokenPair(
    user: User,
    role: string,
    req: Request,
    existingFamily?: string,
  ) {
    const sessionId = randomUUID(); // id_refresh_tokens.id (pre-generated for response)
    const tokenFamily = existingFamily ?? randomUUID();

    const [accessToken, rawRefreshToken] = await Promise.all([
      this.jwt.signAccessToken({
        sub: user.id.value,
        email: user.email?.value ?? null,
        role,
        sessionId,
      }),
      this.jwt.signRefreshToken({ sub: user.id.value, sessionId }),
    ]);

    // Store hashed refresh token
    const ttl = this.jwt.getRefreshTokenTtl();
    const expiresAt = new Date(Date.now() + ttl * 1000);

    const refreshTokenEntity = this.refreshTokenRepo.create({
      id: sessionId,
      userId: user.id.value,
      tokenHash: this.hashToken(rawRefreshToken),
      tokenFamily,
      deviceIp: (req as Request & { traceId?: string }).headers['x-real-ip'] as string | undefined ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      expiresAt,
    });
    await this.refreshTokenRepo.save(refreshTokenEntity);

    // API-DESIGN v1.1.0: response shape
    return {
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: 900,    // JWT_ACCESS_TOKEN_TTL = 15 min
      tokenType: 'Bearer' as const,
      sessionId,
      user: {
        id: user.id.value,
        fullName: user.fullName,
        email: user.email?.value ?? null,
        role,
        locale: user.locale,
        theme: user.theme,
        audioSpeed: user.audioSpeed,
      },
    };
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
