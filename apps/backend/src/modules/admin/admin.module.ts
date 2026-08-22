import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

// ── Infrastructure — ORM Entities ────────────────────────────────────────────
import { AuditLogOrmEntity } from './infrastructure/persistence/entities/audit-log.orm-entity';
import { SystemConfigOrmEntity } from './infrastructure/persistence/entities/system-config.orm-entity';
import { AnalyticsDailyOrmEntity } from './infrastructure/persistence/entities/analytics-daily.orm-entity';

// ── Application — Services ────────────────────────────────────────────────────
import { AnalyticsService } from './application/analytics.service';
import { AuditLogService } from './application/audit-log.service';
import { SystemConfigService } from './application/system-config.service';

// ── Presentation — Controllers & Guards ──────────────────────────────────────
import {
  AdminAnalyticsController,
  AdminSystemConfigController,
  AdminAuditLogController,
  AdminUsersController,
} from './presentation/admin.controller';
import { RolesGuard } from './presentation/guards/roles.guard';

// ── BC01 — Imported via exported port (ADR-002: cross-BC via domain port only)
import { IdentityModule } from '../identity/identity.module';

/**
 * AdminModule — BC05: Administration, Analytics & Operations
 *
 * Exports nothing — this is a leaf module consumed only by AppModule.
 *
 * Bounded Context boundary:
 * ─────────────────────────
 * • IdentityModule is imported for its exported IUserRepository (USER_REPOSITORY
 *   token) and JwtRs256Adapter. No direct TypeORM entity import from BC01.
 * • DataSource is available globally via TypeOrmModule.forRootAsync in AppModule.
 *
 * Phase 1 scope: Read-only analytics, system config CRUD, audit log, user admin.
 * Phase 2 scope: Background analytics aggregation job, Redis cache invalidation.
 */
@Module({
  imports: [
    // Register BC05 ORM entities — ad_audit_log, ad_system_config, ad_analytics_daily
    TypeOrmModule.forFeature([
      AuditLogOrmEntity,
      SystemConfigOrmEntity,
      AnalyticsDailyOrmEntity,
    ]),

    // Import BC01 for IUserRepository + JwtRs256Adapter (exported by IdentityModule)
    IdentityModule,
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
  ],
})
export class AdminModule {}
