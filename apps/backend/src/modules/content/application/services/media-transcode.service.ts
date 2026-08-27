/**
 * media-transcode.service.ts — ADR-013 Stage B
 *
 * يُضيف job إلى طابور BullMQ بعد نجاح التحقق من الرفع.
 * لا يُنفّذ أي معالجة — فقط يُدرج في الطابور ويُسجّل.
 *
 * لماذا هنا وليس في MediaUploadService مباشرة؟
 * MediaUploadService في طبقة التطبيق ولا يجب أن يعرف تفاصيل البنية التحتية
 * (BullMQ). هذه الخدمة هي الـseam المعلّقة في السطر 286 من media-upload.service.ts —
 * تُحقن عند جهوزية Stage B دون لمس منطق التحقق.
 */
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { MEDIA_TRANSCODE_QUEUE, TranscodeJobData } from '../../../../shared/infrastructure/queue/media-transcode.queue';

@Injectable()
export class MediaTranscodeService {
  private readonly logger = new Logger(MediaTranscodeService.name);

  constructor(
    @InjectQueue(MEDIA_TRANSCODE_QUEUE) private readonly transcodeQueue: Queue<TranscodeJobData>,
  ) {}

  /**
   * يُدرج job معالجة في الطابور ويعود فوراً — لا انتظار، لا blocking.
   *
   * الـjob تحمل assetId وstorageKey فقط — الـworker يقرأ الملف نفسه
   * من التخزين عبر stream مباشرة (لا نسخ في الذاكرة هنا).
   *
   * removeOnComplete: 100 → نحتفظ بآخر 100 job ناجحة للمراقبة.
   * removeOnFail: 500 → نحتفظ بآخر 500 job فاشلة للتشخيص.
   * attempts: 3 + backoff أسي → ثلاث محاولات قبل TRANSCODE_FAILED.
   */
  async enqueue(assetId: string, storageKey: string): Promise<void> {
    const job = await this.transcodeQueue.add(
      'transcode',
      { assetId, storageKey },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    );

    this.logger.log(
      `[Stage B] Transcode job enqueued: jobId=${job.id} assetId=${assetId} key=${storageKey}`,
    );
  }
}
