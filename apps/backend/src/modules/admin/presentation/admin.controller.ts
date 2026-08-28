import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
  Req,
  BadRequestException,
  ConflictException,
  NotFoundException,
  Inject,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiQuery,
} from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { AnalyticsService } from '../application/analytics.service';
import { SystemConfigService } from '../application/system-config.service';
import { AuditLogService } from '../application/audit-log.service';
import { UpdateSystemConfigDto } from '../application/dtos/update-system-config.dto';
import { AuditLogFilterDto } from '../application/dtos/audit-log-filter.dto';
import { AnalyticsQueryDto } from '../application/dtos/analytics-query.dto';
import { IUserRepository, USER_REPOSITORY } from '../../identity/domain/ports/user.repository';
import { AUDIT_ACTIONS } from '../domain/models/admin-enums';

// ══════════════════════════════════════════════════════════════════════════════
// AdminAnalyticsController
// GET /api/v1/admin/analytics/overview
// GET /api/v1/admin/analytics/content
// ══════════════════════════════════════════════════════════════════════════════

/**
 * AdminAnalyticsController — BC05
 *
 * Provides dashboard KPIs and content breakdown analytics.
 * All queries hit source tables directly via DataSource.query() — no
 * Cross-BC repository imports (ADR-002).
 *
 * Restricted to Admin and SuperAdmin roles.
 */
@ApiTags('Admin — Analytics')
@ApiBearerAuth()
@Controller('admin/analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'SuperAdmin')
export class AdminAnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  /**
   * GET /admin/analytics/overview
   * Dashboard KPIs: DAU, WAU, MAU, new-users-today, auth-method breakdown, top 5 content.
   */
  @Get('overview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Dashboard analytics overview — DAU/WAU/MAU + top content' })
  @ApiResponse({ status: 200, description: 'Analytics overview returned' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — Admin or SuperAdmin required' })
  async getOverview() {
    return this.analyticsService.overview();
  }

  /**
   * GET /admin/analytics/content?type=ARTICLE&from=2026-01-01&to=2026-08-01
   * Content publication breakdown by type, optionally filtered by date range.
   */
  @Get('content')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Content analytics — count by type with optional date filter' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  async getContentAnalytics(@Query() query: AnalyticsQueryDto) {
    return this.analyticsService.contentAnalytics(query);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AdminSystemConfigController
// GET    /api/v1/admin/system/config
// GET    /api/v1/admin/system/config/:key
// PATCH  /api/v1/admin/system/config/:key   (SuperAdmin only)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * AdminSystemConfigController — BC05
 *
 * Read/Update for the ad_system_config key-value store.
 * Update is transactional: DB row + audit_log in the same TX (SystemConfigService).
 * The in-memory cache is refreshed after the TX commits.
 */
@ApiTags('Admin — System Config')
@ApiBearerAuth()
@Controller('admin/system/config')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AdminSystemConfigController {
  constructor(
    private readonly configService: SystemConfigService,
    private readonly auditLogService: AuditLogService,
  ) {}

  /** GET /admin/system/config — list all config entries ordered by key ASC */
  @Get()
  @Roles('Admin', 'SuperAdmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'List all system config entries' })
  async findAll() {
    const rows = await this.configService.findAll();
    return {
      data: rows.map((r) => ({
        key: r.key,
        value: r.value,
        description: r.description,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /** GET /admin/system/config/:key — get single config entry by key */
  @Get(':key')
  @Roles('Admin', 'SuperAdmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get single system config entry by key' })
  @ApiParam({ name: 'key', example: 'maintenance_mode' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — config key does not exist' })
  async findOne(@Param('key') key: string) {
    const row = await this.configService.findOne(key);
    return {
      key: row.key,
      value: row.value,
      description: row.description,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * PATCH /admin/system/config/:key
   * Update config value. TX-safe: DB update + audit_log in one transaction.
   * SuperAdmin only.
   */
  @Patch(':key')
  @Roles('SuperAdmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Update system config value (SuperAdmin only)' })
  @ApiParam({ name: 'key', example: 'maintenance_mode' })
  @ApiResponse({ status: 200, description: 'Config updated and audit log written' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — SuperAdmin required' })
  @ApiResponse({ status: 404, description: 'NOT_FOUND — key does not exist' })
  async update(
    @Param('key') key: string,
    @Body() dto: UpdateSystemConfigDto,
    @Req() req: Request & { user: { sub: string; role: string } },
  ) {
    const updated = await this.configService.update(key, dto.value, {
      id: req.user.sub,
      role: req.user.role,
      ipAddress: (req.headers['x-real-ip'] as string | undefined) ?? req.ip,
      userAgent: req.headers['user-agent'],
    });
    return {
      key: updated.key,
      value: updated.value,
      description: updated.description,
      updatedAt: updated.updatedAt,
    };
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AdminAuditLogController
// GET /api/v1/admin/audit-log
// ══════════════════════════════════════════════════════════════════════════════

/**
 * AdminAuditLogController — BC05
 *
 * Read-only paginated audit log with optional filters.
 * The audit log is IMMUTABLE — append-only, never modified.
 */
@ApiTags('Admin — Audit Log')
@ApiBearerAuth()
@Controller('admin/audit-log')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'SuperAdmin')
export class AdminAuditLogController {
  constructor(private readonly auditLogService: AuditLogService) {}

  /** GET /admin/audit-log?action=user.suspend&page=1&limit=50 */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated audit log with optional filters' })
  @ApiQuery({ name: 'action', required: false })
  @ApiQuery({ name: 'actorId', required: false })
  @ApiQuery({ name: 'entityType', required: false })
  @ApiQuery({ name: 'entityId', required: false })
  @ApiQuery({ name: 'from', required: false })
  @ApiQuery({ name: 'to', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'limit', required: false })
  async list(@Query() query: AuditLogFilterDto) {
    return this.auditLogService.list({
      action: query.action,
      actorId: query.actorId,
      entityType: query.entityType,
      entityId: query.entityId,
      from: query.from,
      to: query.to,
      page: query.page,
      limit: query.limit,
    });
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// AdminUsersController
// GET   /api/v1/admin/users
// GET   /api/v1/admin/users/:id
// POST  /api/v1/admin/users/:id/suspend
// POST  /api/v1/admin/users/:id/unsuspend
// PATCH /api/v1/admin/users/:id/role      (SuperAdmin only)
// ══════════════════════════════════════════════════════════════════════════════

/**
 * AdminUsersController — BC05
 *
 * Admin-facing user management. Uses IUserRepository (BC01) exported from
 * IdentityModule — compliant with ADR-002 (domain port, not TypeORM repo).
 *
 * Suspension mutations use User domain methods (suspend / unsuspend) and
 * write audit_log entries for every state change.
 */
@ApiTags('Admin — Users')
@ApiBearerAuth()
@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'SuperAdmin')
export class AdminUsersController {
  constructor(
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly auditLogService: AuditLogService,
  ) {}

  /**
   * GET /admin/users?page=1&limit=50
   * Paginated list of all non-deleted users, ordered by created_at DESC.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Paginated list of all users (non-deleted)' })
  @ApiQuery({ name: 'page', required: false, example: 1 })
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  async listUsers(
    @Query('page') page = 1,
    @Query('limit') limit = 50,
  ) {
    const p = Math.max(1, Number(page));
    const l = Math.min(100, Math.max(1, Number(limit)));
    return this.userRepo.findAllPaginated(p, l);
  }

  /**
   * GET /admin/users/:id
   * Single user detail — 404 if not found or soft-deleted.
   */
  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Get single user detail by ID' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  async getUser(@Param('id') id: string) {
    const user = await this.userRepo.findById(id);
    if (!user || user.isDeleted) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }
    return {
      id: user.id.value,
      fullName: user.fullName,
      email: user.email?.value ?? null,
      phoneE164: user.phoneE164,
      locale: user.locale,
      theme: user.theme,
      audioSpeed: user.audioSpeed,
      isSuspended: user.isSuspended,
      suspendedAt: user.suspendedAt,
      createdAt: user.createdAt,
    };
  }

  /**
   * POST /admin/users/:id/suspend
   * Suspend a user account. Idempotent — already-suspended users return 200.
   * Domain method user.suspend() is called, followed by repo.update() + audit_log.
   *
   * Guard: 409 CONFLICT if the target is the last active SuperAdmin.
   * Suspending the last SuperAdmin would lock out all administrative control.
   */
  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Suspend a user account (idempotent)' })
  @ApiParam({ name: 'id', description: 'User UUID to suspend' })
  @ApiResponse({ status: 200, description: 'User suspended (or already suspended — idempotent)' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'LAST_SUPERADMIN_PROTECTED — cannot suspend the last active SuperAdmin' })
  async suspendUser(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string; role: string } },
  ) {
    const user = await this.userRepo.findById(id);
    if (!user || user.isDeleted) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    if (!user.isSuspended) {
      // ── Last-SuperAdmin guard ─────────────────────────────────────────────
      // Only run the count check when the target is a SuperAdmin (avoid
      // unnecessary DB round-trip for non-SuperAdmin users).
      const targetRole = await this.userRepo.getPrimaryRole(id);
      if (targetRole === 'SuperAdmin') {
        const activeSuperAdmins = await this.userRepo.countActiveSuperAdmins();
        if (activeSuperAdmins <= 1) {
          throw new ConflictException({
            code: 'LAST_SUPERADMIN_PROTECTED',
            message:
              'Cannot suspend the last active SuperAdmin. ' +
              'Promote another user to SuperAdmin first.',
          });
        }
      }
      // ─────────────────────────────────────────────────────────────────────

      user.suspend(new Date());
      await this.userRepo.update(user);
      await this.auditLogService.log({
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: AUDIT_ACTIONS.USER_SUSPEND,
        entityType: 'user',
        entityId: id,
        newValue: { isSuspended: true, suspendedAt: user.suspendedAt },
        ipAddress: (req.headers['x-real-ip'] as string | undefined) ?? req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return {
      id: user.id.value,
      isSuspended: user.isSuspended,
      suspendedAt: user.suspendedAt,
    };
  }

  /**
   * POST /admin/users/:id/unsuspend
   * Lift suspension from a user account. Idempotent.
   */
  @Post(':id/unsuspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsuspend (re-activate) a user account (idempotent)' })
  @ApiParam({ name: 'id', description: 'User UUID to unsuspend' })
  @ApiResponse({ status: 200, description: 'User unsuspended (or already active — idempotent)' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  async unsuspendUser(
    @Param('id') id: string,
    @Req() req: Request & { user: { sub: string; role: string } },
  ) {
    const user = await this.userRepo.findById(id);
    if (!user || user.isDeleted) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    if (user.isSuspended) {
      user.unsuspend();
      await this.userRepo.update(user);
      await this.auditLogService.log({
        actorId: req.user.sub,
        actorRole: req.user.role,
        action: AUDIT_ACTIONS.USER_UNSUSPEND,
        entityType: 'user',
        entityId: id,
        newValue: { isSuspended: false },
        ipAddress: (req.headers['x-real-ip'] as string | undefined) ?? req.ip,
        userAgent: req.headers['user-agent'],
      });
    }

    return {
      id: user.id.value,
      isSuspended: user.isSuspended,
      suspendedAt: user.suspendedAt,
    };
  }

  /**
   * PATCH /admin/users/:id/role
   * Assign a primary role to a user. SuperAdmin only.
   * Allowed assignable roles: User | Editor | Moderator | Admin.
   * SuperAdmin cannot be assigned via API — manual DB operation only.
   *
   * Guard: 409 CONFLICT if the target is a SuperAdmin being downgraded and
   * they are the last active SuperAdmin in the system.
   */
  @Patch(':id/role')
  @Roles('SuperAdmin')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Assign role to user (SuperAdmin only)' })
  @ApiParam({ name: 'id', description: 'User UUID' })
  @ApiResponse({ status: 200, description: 'Role assigned and audit log written' })
  @ApiResponse({ status: 400, description: 'INVALID_ROLE' })
  @ApiResponse({ status: 403, description: 'FORBIDDEN — SuperAdmin required' })
  @ApiResponse({ status: 404, description: 'USER_NOT_FOUND' })
  @ApiResponse({ status: 409, description: 'LAST_SUPERADMIN_PROTECTED — cannot downgrade the last active SuperAdmin' })
  async assignRole(
    @Param('id') id: string,
    @Body('role') role: string,
    @Req() req: Request & { user: { sub: string; role: string } },
  ) {
    const ALLOWED_ROLES = ['User', 'Editor', 'Moderator', 'Admin'];
    if (!role || !ALLOWED_ROLES.includes(role)) {
      throw new BadRequestException({
        code: 'INVALID_ROLE',
        message: `Role must be one of: ${ALLOWED_ROLES.join(', ')}`,
      });
    }

    const user = await this.userRepo.findById(id);
    if (!user || user.isDeleted) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User not found' });
    }

    const oldRole = await this.userRepo.getPrimaryRole(id);

    // ── Last-SuperAdmin guard ───────────────────────────────────────────────
    // Only relevant when downgrading FROM SuperAdmin to a lesser role.
    // Assigning SuperAdmin or reassigning within the same tier is never blocked.
    if (oldRole === 'SuperAdmin' && role !== 'SuperAdmin') {
      const activeSuperAdmins = await this.userRepo.countActiveSuperAdmins();
      if (activeSuperAdmins <= 1) {
        throw new ConflictException({
          code: 'LAST_SUPERADMIN_PROTECTED',
          message:
            'Cannot downgrade the last active SuperAdmin. ' +
            'Promote another user to SuperAdmin first.',
        });
      }
    }
    // ───────────────────────────────────────────────────────────────────────

    await this.userRepo.assignRole(id, role);

    await this.auditLogService.log({
      actorId: req.user.sub,
      actorRole: req.user.role,
      action: AUDIT_ACTIONS.USER_ROLE_ASSIGN,
      entityType: 'user',
      entityId: id,
      oldValue: { role: oldRole },
      newValue: { role },
      ipAddress: (req.headers['x-real-ip'] as string | undefined) ?? req.ip,
      userAgent: req.headers['user-agent'],
    });

    return { id, role };
  }
}
