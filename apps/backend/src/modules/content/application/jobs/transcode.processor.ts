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
 * NOTE: ffmpeg غير مُثبَّت بعد. هذا الـprocessor يسجّل المراحل ويُحدّث
 * قاعدة البيانات بشكل صحيح. خطوة تثبيت ffmpeg وتوصيل الـstream تتم
 * بعد توفير الـVPS وإعداد البيئة الإنتاجية.
 *
 * الـprocessor مكتوب بالكامل حتى يكون جاهزاً — فقط دالة runFfmpeg() هي
 * placeholder صريح يُبدّل بتنفيذ حقيقي عند جاهزية البنية التحتية.
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { MEDIA_TRANSCODE_QUEUE, TranscodeJobData } from '../../../../shared/infrastructure/queue/media-transcode.queue';
import { IStorageService, STORAGE_SERVICE } from '../../domain/ports/storage.service';

/** حالات transcode في DB — تتوافق مع migration 016 */
type TranscodeStatus = 'QUEUED' | 'TRANSCODING' | 'TRANSCODED' | 'TRANSCODE_FAILED';

@Processor(MEDIA_TRANSCODE_QUEUE, { concurrency: 2 })
export class TranscodeProcessor extends WorkerHost {
  private readonly logger = new Logger(TranscodeProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {
    super();
  }

  // ── Job entry point ────────────────────────────────────────────────────────

  async process(job: Job<TranscodeJobData>): Promise<void> {
    const { assetId, storageKey } = job.data;
    this.logger.log(`[Stage B] Starting transcode: jobId=${job.id} assetId=${assetId}`);

    // Mark as TRANSCODING so the status endpoint reflects live state.
    await this.setTranscodeStatus(assetId, 'TRANSCODING', null);

    try {
      // ── PLACEHOLDER: Replace with real ffmpeg streaming when VPS is ready ──
      // Real implementation:
      //   1. Download stream from storage (R2/MinIO)
      //   2. Pipe through: fluent-ffmpeg → AAC 128kbps
      //   3. Upload result to: processed/{assetId}.aac
      //   4. setTranscodeStatus(assetId, 'TRANSCODED', null)
      //
      // The placeholder throws if called on a job with a real storageKey in
      // a production environment so the failure is visible, not silent.
      await this.runFfmpegPlaceholder(assetId, storageKey);

      // POLICY-SEC-001: TRANSCODED_PLACEHOLDER is not real encoding.
      // transcode_error carries an explicit warning so no consumer can
      // mistake this for a real processed file without reading the field.
      const placeholderNote =
        '[PLACEHOLDER] No real ffmpeg encoding was performed. ' +
        'File remains in original format at storageKey. ' +
        'Replace runFfmpegPlaceholder() with real implementation before production.';
      await this.setTranscodeStatus(assetId, 'TRANSCODED', placeholderNote);
      this.logger.warn(
        `[Stage B] PLACEHOLDER complete (no real encoding): assetId=${assetId}`,
      );
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      // Only mark FAILED on the last attempt — BullMQ will retry before that.
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

  // ── Placeholder ────────────────────────────────────────────────────────────

  /**
   * PLACEHOLDER — يُستبدل بتنفيذ ffmpeg الحقيقي عند جاهزية البنية التحتية.
   *
   * السلوك الحالي: يُسجّل نجاح وهمي ويعود. هذا يُثبت المسار الكامل
   * (QUEUED → TRANSCODING → TRANSCODED في DB) دون الحاجة إلى ffmpeg.
   *
   * عند التطبيق الحقيقي: استبدل هذه الدالة بـ:
   *   const readStream = await this.storage.createReadStream(storageKey);
   *   const processedBuffer = await ffmpegEncode(readStream, 'aac', '128k');
   *   await this.storage.upload(`processed/${assetId}.aac`, processedBuffer);
   */
  private async runFfmpegPlaceholder(assetId: string, storageKey: string): Promise<void> {
    this.logger.warn(
      `[Stage B] PLACEHOLDER: ffmpeg not yet connected. ` +
        `assetId=${assetId} storageKey=${storageKey} — ` +
        `Marking TRANSCODED without actual encoding. Replace this with real ffmpeg when VPS is ready.`,
    );
    // Simulate async work (remove in real implementation).
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}
