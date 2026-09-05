# إصلاحات 2026-09-06 — Majalis Al-Elm

## ما تم إكماله

- تثبيت مسار Docker/Nx وبناء Backend من monorepo الحقيقي.
- تشديد بوابات الاختبارات وCI وE2E.
- إزالة مخاطر JWT/Storage وlocalhost في production.
- إضافة readiness صحي حقيقي يعتمد على PostgreSQL.
- إضافة migration runner آمن مع checksum وadvisory lock.
- تفعيل تنزيل فعلي للـ PDF/Audio/Image على الهاتف عبر رابط S3/R2 موقّع.
- التحقق من وجود الملف وحجمه قبل تسجيله كمحفوظ محلياً.
- حذف الملف المحلي عند حذف العنصر من قائمة التنزيلات.
- إصلاح دورة 401/refresh في تطبيق الهاتف ولوحة الإدارة.
- منع تجميد آخر SuperAdmin على الخادم.
- إزالة مصادر بيانات تجريبية من مسارات المحتوى التي كانت قيد العرض للمستخدم.
- تحديث وثائق الديون التقنية وحالة TECH-DEBT-012 وTECH-DEBT-016.

## ما يزال يحتاج بيئة تشغيل فعلية

- Flutter analyze/test/build على SDK حقيقي.
- Docker compose build/up على Docker Engine حقيقي.
- اختبار E2E مع PostgreSQL المخصص الذي يحتوي pg_uuidv7.
- تنفيذ Phone OTP وGoogle/Apple/Facebook OAuth.
- تنفيذ مرحلة media transcoding وSHA-256 للمسارات multipart الكبيرة.
- تحويل إعدادات نبذة الشيخ/صورة صاحب المجلس إلى API دائم.
- استكمال حقول analytics غير المصدّرة حالياً.
