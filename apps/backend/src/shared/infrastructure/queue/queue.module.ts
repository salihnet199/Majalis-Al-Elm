/**
 * queue.module.ts — البند (د) ADR-013 Stage B
 *
 * BullMQ embedded module — قرار المستخدم: embedded في المرحلة الأولى.
 * Redis: Upstash (قرار المستخدم) — يُقرأ من REDIS_URL في config.
 *
 * لماذا forRootAsync وليس forRoot مباشرة؟
 * لأن ConfigService لا يكون جاهزاً حتى يُحمَّل ConfigModule، وfoRootAsync
 * يضمن تسلسل التهيئة بدلاً من القراءة في وقت بناء الوحدة.
 */
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const redisUrl = config.get<string>('REDIS_URL');
        if (!redisUrl) {
          throw new Error(
            '[QueueModule] REDIS_URL is required for BullMQ (ADR-013 Stage B). ' +
              'Set it to your Upstash Redis URL (rediss://... or redis://...).',
          );
        }

        // Upstash uses rediss:// (TLS). Parse the URL ourselves so BullMQ's
        // ioredis client gets explicit host/port/password/tls options — the
        // URL string form is accepted but the tls field is still needed for
        // Upstash's mandatory TLS.
        let url: URL;
        try {
          url = new URL(redisUrl);
        } catch {
          throw new Error(
            `[QueueModule] REDIS_URL is not a valid URL: "${redisUrl}". ` +
              'Expected format: rediss://default:<password>@<host>:<port>',
          );
        }

        const tls = url.protocol === 'rediss:';
        return {
          connection: {
            host: url.hostname,
            port: Number(url.port) || (tls ? 6380 : 6379),
            password: url.password ? decodeURIComponent(url.password) : undefined,
            username: url.username ? decodeURIComponent(url.username) : undefined,
            tls: tls ? {} : undefined,
            // Upstash closes idle connections after 1 min. keepAlive prevents
            // the worker from getting ECONNRESET on the first job after a quiet
            // period.
            enableOfflineQueue: false,
            maxRetriesPerRequest: null, // required by BullMQ
          },
          // Prefix all keys so different environments (staging/prod) can share
          // the same Upstash database without colliding.
          prefix: `{majalis-elm}`,
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
