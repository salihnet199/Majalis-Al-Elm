/**
 * Majalis Al-Elm Platform — NestJS Backend Entry Point
 *
 * Architecture: Modular Monolith (ADR-001)
 * Clean Architecture — 4 concentric layers (P-01)
 * Twelve-Factor App compliant (P-03)
 */

import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app/app.module';
import { assertJwtKeyIntegrity } from './shared/infrastructure/config/jwt-key-integrity';
import { assertStorageIntegrity } from './shared/infrastructure/config/storage-integrity';
import { GlobalExceptionFilter } from './shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from './shared/presentation/interceptors/trace-id.interceptor';

async function bootstrap() {
  // ── Fail fast on weak JWT signing material (POLICY-SEC-001, TECH-DEBT-013) ──
  // Second, independent layer behind the Joi rule in app.config.ts. It runs
  // BEFORE NestFactory.create() on purpose: if the only available signing key is
  // the test-only symmetric secret, the DI container must never get the chance
  // to build JwtRs256Adapter around it. Outside NODE_ENV=test this throws and
  // the process exits — a server that cannot sign trustworthy tokens must not
  // serve traffic at all.
  assertJwtKeyIntegrity();

  // ── Fail fast on unsafe object-storage configuration (ADR-013, TECH-DEBT-014) ──
  // Same pattern, same reason. Joi has already checked that the S3_* variables
  // exist and parse; this judges whether their VALUES are safe for the target
  // environment — no MinIO factory credentials, no cleartext endpoint, no
  // loopback host in production. Runs before the container so no component is
  // ever built around a storage client that must not be used. The bucket's
  // actual existence is proved separately by the HeadBucket probe in
  // StorageModule, which no static check can substitute for.
  assertStorageIntegrity();

  const app = await NestFactory.create(AppModule, {
    // Disable default NestJS logger in favour of pino (configured in AppModule)
    bufferLogs: true,
  });

  // ── API Versioning ──────────────────────────────────────────────────────────
  app.setGlobalPrefix('api/v1');

  // ── Security Headers (P-07: Secure by Default) ──────────────────────────────
  app.use(
    helmet({
      contentSecurityPolicy: false, // Managed at Nginx level
    }),
  );

  // ── CORS ────────────────────────────────────────────────────────────────────
  const allowedOrigins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Trace-Id'],
    exposedHeaders: ['X-Trace-Id'],
    credentials: true,
  });

  // ── Global Pipes — Input Validation (P-07, ADR-004) ────────────────────────
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,       // Strip unknown fields — defence against mass-assignment
      forbidNonWhitelisted: false, // Don't error on extra fields (API clients may add them)
      transform: true,       // Auto-transform payloads to DTO types
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ── Global Filters — Exception → Canonical Error Envelope ──────────────────
  app.useGlobalFilters(new GlobalExceptionFilter());

  // ── Global Interceptors — Trace ID + Request Logging (P-08) ────────────────
  app.useGlobalInterceptors(new TraceIdInterceptor());

  // ── Swagger (OpenAPI 3.1) ────────────────────────────────────────────────
  // Accessible: /docs in dev, admin-only in prod (enforced by Nginx/Guard)
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Majalis Al-Elm API')
      .setDescription('Majalis Al-Elm Educational Platform — REST API v1')
      .setVersion('1.1.0')
      .addBearerAuth()
      .addServer('http://localhost:3000', 'Local Dev')
      .addServer('https://api-staging.majalis-elm.app', 'Staging')
      .build();

    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  // ── Graceful Shutdown (Twelve-Factor: Disposability) ───────────────────────
  app.enableShutdownHooks();

  const port = parseInt(process.env.PORT ?? '3000', 10);
  await app.listen(port, '0.0.0.0');

  Logger.log(
    `🚀 Majalis Al-Elm API running at http://localhost:${port}/api/v1`,
    'Bootstrap',
  );
  if (process.env.NODE_ENV !== 'production') {
    Logger.log(`📖 Swagger UI at http://localhost:${port}/docs`, 'Bootstrap');
  }
}

bootstrap().catch((err) => {
  Logger.error('Failed to bootstrap application', err, 'Bootstrap');
  process.exit(1);
});
