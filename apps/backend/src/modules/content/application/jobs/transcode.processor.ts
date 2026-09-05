/**
 * transcode.processor.ts — ADR-013 Stage B
 *
 * BullMQ Worker embedded في نفس الـNestJS process (قرار المرحلة الأولى).
 *
 * كل job تمر بالمراحل:
 *   DB: QUEUED → TRANSCODING (بداية المعالجة)
 *   معالجة: stream من R2 → pipe إلى ffmpeg → رفع النتيجة إلى R2
 *   DB: TRANSCODING → TRANSCODED (نجاح)
 *     أو  → TRANSCODE_FAILED + سبب مُسجَّل (فشل بعد 3 محاولات)
 *
 * concurrency = 2: حدّان متوازيان فقط، لا يُثقلان VPS.
 *
 * NOTE: The worker intentionally refuses to claim DONE until a real FFmpeg
 * pipeline is wired. MEDIA_TRANSCODE_ENABLED is therefore false by default,
 * and old queued jobs fail visibly instead of fabricating completion.
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { MEDIA_TRANSCODE_QUEUE, TranscodeJobData } from '../../../../shared/infrastructure/queue/media-transcode.queue';

/**
 * حالات transcode في DB — تتوافق مع migration 016.
 * PENDING/PROCESSING/DONE/FAILED كانت القيم الأصلية (migration 010) ولا تزال
 * موجودة في الـ enum للتوافق الخلفي مع صفوف قديمة فقط — الكود الجديد يجب أن
 * يستخدم حصريًا القيم التي أضافتها migration 016 لمرحلة Stage B.
 */
type TranscodeStatus = 'QUEUED' | 'TRANSCODING' | 'TRANSCODED' | 'TRANSCODE_FAILED';

@Processor(MEDIA_TRANSCODE_QUEUE, { concurrency: 2 })
export class TranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodeProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  // ── Job entry point ────────────────────────────────────────────────────────

  async process(job: Job<TranscodeJobData>): Promise<void> {
    const { assetId } = job.data;
    this.logger.log(`[Stage B] Starting transcode: jobId=${job.id} assetId=${assetId}`);

    await this.setTranscodeStatus(assetId, 'TRANSCODING', null);

    try {
      // Never fabricate a successful transcode. The worker image does not yet
      // contain FFmpeg or a byte-streaming storage API, so this job must fail
      // explicitly instead of marking the original object as TRANSCODED.
      throw new Error(
        'FFmpeg transcoding is not enabled in this deployment; refusing to fabricate a TRANSCODED asset',
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      // Only mark TRANSCODE_FAILED on the last attempt — BullMQ retries before that.
      if (job.attemptsMade >= (job.opts.attempts ?? 1) - 1) {
        await this.setTranscodeStatus(assetId, 'TRANSCODE_FAILED', reason);
        this.logger.error(`[Stage B] Transcode failed permanently: assetId=${assetId} — ${reason}`);
      } else {
        this.logger.warn(
          `[Stage B] Transcode attempt ${job.attemptsMade + 1} failed, will retry: assetId=${assetId} — ${reason}`,
        );
      }
      throw err; // Re-throw so BullMQ applies the backoff/retry logic.
    }
  }

  // ── Lifecycle events ───────────────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`[Stage B] Job completed: jobId=${job.id}`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, err: Error): void {
    this.logger.error(`[Stage B] Job failed: jobId=${job?.id} — ${err.message}`);
  }

  // ── DB helpers ─────────────────────────────────────────────────────────────

  private async setTranscodeStatus(
    assetId: string,
    status: TranscodeStatus,
    error: string | null,
  ): Promise<void> {
    await this.dataSource.query(
      `UPDATE ct_media_assets
          SET transcode_status = $1,
              transcode_error   = $2,
              updated_at        = NOW()
        WHERE id = $3`,
      [status, error, assetId],
    );
  }

}
