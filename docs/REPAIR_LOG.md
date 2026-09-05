# Repair Log — Majalis Al-Elm

هذه النسخة تحتوي على إصلاحات تنفيذية مبنية على مراجعة المشروع الحالية.

## Backend

- جعل دوران Refresh Token ذريًا عبر `UPDATE ... WHERE is_revoked = false` لمنع نجاح طلبين متزامنين بنفس التوكن.
- أضاف اختبارًا لحالة refresh المتزامنة.
- أصبح `expiresIn` في استجابة تسجيل الدخول/التحديث مأخوذًا من إعداد JWT الفعلي بدل قيمة ثابتة.
- منع استرجاع المستخدمين المحذوفين منطقيًا عبر `IsNull()` في repository.
- أضاف تحققًا فعليًا من صحة IP قبل تخزينه في PostgreSQL `INET`.
- أضاف checksum للمigrations واكتشاف تعديل migration سبق تطبيقها.
- أضاف PostgreSQL advisory lock لمنع تشغيل migrations بالتوازي.
- حسّن قيود حجم حقول كلمات المرور وRefresh Tokens عند حدود API.

## Mobile

- ربط انتهاء الجلسة بحالة Riverpod بدل أن تمسح طبقة الشبكة التوكن فقط بينما يبقى UI بحالة تسجيل دخول.
- منع حلقة 401 غير المنتهية بعد إعادة محاولة الطلب.
- عند غياب Refresh Token أو فشل refresh يتم تنظيف الجلسة وإبلاغ طبقة المصادقة.
- أزيلت أزرار OAuth الوهمية من حالة الاستخدام الفعلية؛ Google وApple يظهران كـ `قريباً` لأن Backend يعيد `503` حاليًا.

## Admin

- منع production build من السقوط بصمت إلى `localhost` عند غياب `VITE_API_BASE_URL`.
- تحقق من صحة زوج التوكن الجديد قبل تخزينه.
- منع إعادة دورة refresh للطلبات المنتظرة داخل queue.

## CI/CD & Docker

- توحيد CI/CD مع الفرع `master`.
- توحيد أسماء قاعدة اختبار CI إلى `majalis_elm_test` بدل أسماء المشروع القديمة.
- إضافة تحقق Flutter إلى CI.
- جعل migrations تعمل تلقائيًا عند تشغيل Backend المحلي داخل Compose.
- تصحيح Nginx لـ `/health` و`/ready` ليوجها إلى `/api/v1/...` بسبب global API prefix.
- تحسين CD لتشغيل صورة PostgreSQL المخصصة قبل migrations.
- فصل `apps/admin/.env` المحلي واستبداله بـ `.env.example`.
- إضافة `.dockerignore` وREADME تشغيلي محدث.

## Verification

تم التحقق من صحة JSON وYAML، ومن سلامة ملفات JavaScript/MJS، وفحص عدم وجود ملفات secrets/PEM متعمدة ضمن المصدر المعدل.

لم يتم اعتبار تشغيل `npm test/build` الكامل ناجحًا: بيئة التنفيذ الحالية لم تستطع إكمال `npm ci` ضمن المهلة، كما أن Flutter SDK غير مثبتة في بيئة الفحص. لذلك يجب تشغيل CI/Build على جهاز التطوير أو GitHub Actions قبل اعتماد الإصدار Production.

## 2026-09-06 — Repair pass 3

- JWT Passport validation now checks the active user state on every authenticated request, so suspension/soft-delete/role changes take effect without waiting for token expiry.
- Active-email and active-phone existence checks now respect `deleted_at IS NULL`.
- `/ready` now performs a real PostgreSQL readiness check instead of returning a constant success response.
- CI validates all migrations through the repository's `pg-mem` validator and keeps E2E as a separate application smoke gate.
- Mobile audio/PDF catalog screens now load published content from the backend API instead of shipping hardcoded `example.com` sample records.
- Catalog screens now expose loading, retry, and server-error states.

## Expert Pass — 2026-09-06 (v7)

- Fixed offline-download search so clearing search preserves the selected content-type filter.
- Purged stale offline metadata and download-queue entries when the backing file is gone.
- Corrected transcode worker state names to the database enum (`PENDING/PROCESSING/DONE/FAILED`).
- Transcoding is now opt-in via `MEDIA_TRANSCODE_ENABLED`; the current worker refuses to fabricate `DONE` until a real FFmpeg pipeline exists.
- Only audio uploads are eligible for the current transcode queue; PDF/image uploads do not enter an audio-processing pipeline.
- Added a regression test proving a missing FFmpeg pipeline results in an explicit failed job rather than a fabricated successful transcode.
- Added the transcode feature flag to environment examples and Compose files.

