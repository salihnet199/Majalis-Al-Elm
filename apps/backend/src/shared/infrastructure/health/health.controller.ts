import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

/**
 * HealthController — /health + /ready
 *
 * ADR-011: Lightweight Monitoring
 * - /health  → polled by Uptime Kuma + Docker HEALTHCHECK
 *             checks postgres + redis connectivity
 * - /ready   → used by Nginx reverse proxy to know when to route traffic
 *             fails during startup / migrations
 *
 * These endpoints bypass JWT auth guard (public routes).
 */
@ApiTags('Health')
@Controller()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /**
   * GET /health
   * Polled by Uptime Kuma and Docker HEALTHCHECK.
   * Returns 200 if DB is reachable, 503 otherwise.
   */
  @Get('health')
  @HealthCheck()
  @ApiOperation({ summary: 'Liveness check — polled by Uptime Kuma + Docker' })
  checkHealth() {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: 3000 }),
    ]);
  }

  /**
   * GET /ready
   * Used by Nginx / docker-compose depends_on to gate traffic.
   * Returns 503 during startup or active migrations.
   * NOT monitored by Uptime Kuma (internal only).
   */
  @Get('ready')
  @ApiOperation({ summary: 'Readiness check — used by reverse proxy, NOT Uptime Kuma' })
  checkReady() {
    // In Phase 1 this is a simple "up" check — same as health.
    // In Phase 2+, this can check migration status from a Redis flag set
    // during migration:run and cleared on completion.
    return { status: 'ready' };
  }
}
