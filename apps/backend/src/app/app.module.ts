import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { TerminusModule } from '@nestjs/terminus';
import { APP_GUARD } from '@nestjs/core';
import { HttpModule } from '@nestjs/axios';
import { IdentityModule } from '../modules/identity/identity.module';
import { ContentModule } from '../modules/content/content.module';
import { EngagementModule } from '../modules/engagement/engagement.module';
import { NotificationsModule } from '../modules/notifications/notifications.module';
import { AdminModule } from '../modules/admin/admin.module';
import { HealthController } from '../shared/infrastructure/health/health.controller';
import {
  appConfig,
  databaseConfig,
  jwtConfig,
  throttleConfig,
  logConfig,
  validateConfig,
} from '../shared/infrastructure/config/app.config';

@Module({
  imports: [
    // ── Configuration (Twelve-Factor: Config) ─────────────────────────────────
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      load: [appConfig, databaseConfig, jwtConfig, throttleConfig, logConfig],
      validate: validateConfig,
    }),

    // ── Database (ADR-005: PostgreSQL, ADR-006: TypeORM 0.3.x) ───────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        host: config.get<string>('database.host'),
        port: config.get<number>('database.port'),
        database: config.get<string>('database.name'),
        username: config.get<string>('database.user'),
        password: config.get<string>('database.password'),
        ssl: config.get<boolean>('database.ssl')
          ? { rejectUnauthorized: false }
          : false,
        // Entities auto-loaded by each module's TypeOrmModule.forFeature()
        autoLoadEntities: true,
        // NEVER synchronize:true in production — migrations only (DB-SCHEMA is source of truth)
        synchronize: false,
        logging: config.get<string>('app.nodeEnv') === 'development',
        extra: {
          // Connection pool settings (PgBouncer handles pooling in prod)
          max: 10,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
        },
      }),
    }),

    // ── Rate Limiting (API-DESIGN: throttle per endpoint group) ──────────────
    ThrottlerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            name: 'default',
            ttl: config.get<number>('throttle.ttl', 60000),
            limit: config.get<number>('throttle.limit', 200),
          },
        ],
        storage: undefined, // Will be replaced by Redis ThrottlerStorage in identity module
      }),
    }),

    // ── Health Checks (ADR-011: /health + /ready) ─────────────────────────────
    TerminusModule,
    HttpModule,

    // ── Bounded Context Modules ───────────────────────────────────────────────
    // BC01: Identity & Access (Phase 1 — Email Auth implemented)
    IdentityModule,
    // BC02: Content & Media Library (Phase 2)
    ContentModule,
    // BC03: Engagement (Comments / Q&A)
    EngagementModule,
    // BC04: Notifications (Push + Email + SMS + In-App)
    NotificationsModule,
    // BC05: Administration, Analytics & Ops
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    // ── Global Rate Limit Guard ────────────────────────────────────────────────
    // Per-endpoint overrides use @Throttle() decorator in controllers
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
