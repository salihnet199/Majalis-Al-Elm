/**
 * media-transcode.queue.ts — ADR-013 Stage B
 *
 * اسم الطابور + نوع الـjob. هذا الملف مرجع واحد لكل من:
 *   - MediaTranscodeService (يُضيف jobs)
 *   - TranscodeProcessor (يستقبل jobs)
 *
 * لا توجد logic هنا — فقط ثوابت وأنواع حتى لا يتشتت الاسم في ثلاثة أماكن.
 */

/** اسم الطابور في Redis — يُستخدم في @InjectQueue و @Processor. */
export const MEDIA_TRANSCODE_QUEUE = 'media-transcode';

/**
 * الـjob التي يُضيفها الـHTTP handler وينفذها الـworker.
 *
 * assetId: UUID الـmedia asset في قاعدة البيانات.
 * storageKey: المفتاح في R2/MinIO لقراءة الملف الأصلي.
 *
 * لا يُمرَّر الملف نفسه — الـworker يقرأه مباشرة من التخزين عبر stream.
 */
export interface TranscodeJobData {
  assetId: string;
  storageKey: string;
}
