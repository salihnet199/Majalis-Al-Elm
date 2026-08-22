import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule } from '@nestjs/config';

// ── Domain ──────────────────────────────────────────────────────────────────
import { USER_REPOSITORY } from './domain/ports/user.repository';

// ── Infrastructure ───────────────────────────────────────────────────────────
import { UserOrmEntity } from './infrastructure/persistence/entities/user.orm-entity';
import { RoleOrmEntity } from './infrastructure/persistence/entities/role.orm-entity';
import { RefreshTokenOrmEntity } from './infrastructure/persistence/entities/refresh-token.orm-entity';
import { SocialIdentityOrmEntity } from './infrastructure/persistence/entities/social-identity.orm-entity';
import { TypeOrmUserRepository } from './infrastructure/persistence/typeorm-user.repository';
import { BcryptAdapter, PASSWORD_HASHER } from './infrastructure/adapters/bcrypt.adapter';
import { JwtRs256Adapter } from './infrastructure/adapters/jwt-rs256.adapter';
import { JwtStrategy } from './infrastructure/adapters/jwt.strategy';

// ── Presentation ─────────────────────────────────────────────────────────────
import { AuthController } from './presentation/auth.controller';

/**
 * IdentityModule — BC01: Identity & Access
 *
 * Bounded Context: all identity, authentication, and RBAC concerns.
 * ADR-002: This module owns all id_* tables.
 *
 * Phase 1 scope: Email Auth (register, login, refresh, logout).
 * Phase 2 scope: Phone/OTP, Google/Apple/Facebook OAuth.
 */
@Module({
  imports: [
    ConfigModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),

    // Register TypeORM entities for BC01 — scoped to this module
    TypeOrmModule.forFeature([
      UserOrmEntity,
      RoleOrmEntity,
      RefreshTokenOrmEntity,
      SocialIdentityOrmEntity,
    ]),

    // JwtModule registered with no secret — JwtRs256Adapter handles key loading
    JwtModule.register({}),
  ],
  controllers: [
    AuthController,
    // UsersController,  // Phase 1 follow-up: GET/PATCH/DELETE /users/me
  ],
  providers: [
    // Repository — binds IUserRepository token to TypeORM implementation
    {
      provide: USER_REPOSITORY,
      useClass: TypeOrmUserRepository,
    },
    // Password Hasher — binds IPasswordHasher token (P-06: DIP)
    // AuthController injects via PASSWORD_HASHER token, not concrete class
    {
      provide: PASSWORD_HASHER,
      useClass: BcryptAdapter,
    },
    JwtRs256Adapter,
    // Passport JWT Strategy — required by JwtAuthGuard (AuthGuard('jwt'))
    JwtStrategy,
  ],
  exports: [
    // Export JwtRs256Adapter so other modules can verify tokens
    // (e.g., ContentModule checking author identity)
    JwtRs256Adapter,
    USER_REPOSITORY,
  ],
})
export class IdentityModule {}
