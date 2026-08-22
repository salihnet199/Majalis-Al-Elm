# ADR-015: استراتيجية تثبيت pg_uuidv7 في صورة Docker PostgreSQL

| الحقل | القيمة |
|---|---|
| **المعرف** | ADR-015 |
| **العنوان** | استراتيجية بناء وتثبيت pg_uuidv7 في postgres:16-alpine |
| **الحالة** | مقبول بمخاطر موثّقة ومُراقَبة |
| **التاريخ** | 2026-08-18 |
| **يرتبط بـ** | ADR-005 (PostgreSQL 16)، ADR-007 (Docker Compose) |

---

## السياق والمشكلة

منذ DB-SCHEMA.md v1.1.0، تعتمد كل Primary Keys على uuid_generate_v7() من
extension pg_uuidv7 (fboulnois/pg_uuidv7). هذه الدالة ليست جزءاً من
PostgreSQL القياسي وتحتاج تثبيتاً يدوياً في صورة Docker المخصصة.

خلال تنفيذ TECH-DEBT-006 بتاريخ 2026-08-18، ظهر عدم توافق LLVM:
- postgres:16-alpine مبنيّة ضد LLVM 21 (وقت بناء الـbase image)
- Alpine Linux v3.24 ترقّت إلى LLVM 22 في حزمها الحالية

الأخطاء:
  clang-21: No such file or directory          # أثناء make
  /usr/lib/llvm21/bin/llvm-lto: not found      # أثناء make install

الحل المُطبَّق: symlinks ديناميكية لتوجيه LLVM 21 إلى LLVM 22.

---

## ملاحظة عملية القرار

هذا القسم يُوثّق التقييم الذي كان يجب أن يسبق تطبيق الـsymlinks.
الواقع: الحل طُبّق أولاً ثم جاء التقييم استجابةً للمراجعة.
هذا انحراف عن عملية القرار الصحيحة يجب عدم تكراره.

---

## البدائل الثلاثة المُقيَّمة

### البديل أ: صورة جاهزة تحتوي pg_uuidv7

- لا توجد صورة رسمية موثوقة تجمع postgres:16 + pg_uuidv7
- Image مجتمعي: مخاطر أمنية وصيانة غير مُتحكَّم بها
- Binary Debian (glibc) لن يعمل على Alpine (musl)
- الحكم: غير عملي بدون بناء binary خاص

### البديل ب: postgres:16 Debian-based بدل Alpine

- يحل LLVM mismatch جذرياً — postgresql-server-dev-16 تتوافق تلقائياً
- لا symlinks — أقل هشاشة على المدى البعيد
- الحجم أكبر: ~400MB vs ~225MB
- الحكم: الخيار الأفضل طويل المدى — مُوصى به إذا انكسر الحل الحالي

### البديل ج: UUID على مستوى التطبيق

- يحل المشكلة جذرياً — لا extension = لا مشكلة build
- يعمل على أي PostgreSQL بلا تعديل
- تأثير بنيوي: مراجعة 25 جدول، إزالة DEFAULT uuid_generate_v7()
- يُفقد ضمان database-level default
- الحكم: مكلف جداً في Phase 1 — مُؤجَّل

---

## القرار: الاستمرار بالـsymlinks بشرطين إلزاميين

الشرط الأول: تثبيت digest الـimage (يمنع تحديث Alpine غير متوقع)
الشرط الثاني: توثيق خطة الطوارئ

المبرر: البديل (ب) هو الهدف الصحيح لكن تغييره في نهاية Phase 1
يتطلب وقتاً وإعادة اختبار. الـsymlinks قابلة للإدارة بشرط تثبيت الـdigest.

---

## تثبيت Digest

الـDigest المُثبَّت في Dockerfile:
  sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685

يحتوي: PostgreSQL 16.15 + Alpine 3.24 + LLVM 21 كـbuild dependency أصلي
تاريخ التحقق: 2026-08-18

إجراء مراجعة ربع سنوي: اختبار البناء في dev قبل تحديث الـdigest في production.

---

## مخاطر الإنتاج طويلة المدى

الخطر | الاحتمالية | الأثر | الإجراء
تغيير اسم clang/llvm في Alpine | عالية (إذا غُيّر الـdigest) | عالٍ | تثبيت digest يمنع هذا
تغيير Makefile في pg_uuidv7 | منخفضة | متوسط | اختبار قبل الدفع
انقطاع GitHub وقت البناء | منخفضة | عالٍ | retry في CI
ثغرة أمنية تستلزم تغيير image | متوسطة | متوسط | تحديث digest مدروس

المخاطرة الرئيسية الموثّقة:
الـsymlinks هشة بطبيعتها. التثبيت بـdigest يحول هشاشتها من "غير محمية"
إلى "محمية ومُدارة"، لكنها تظل أدنى من حل جذري كالتبديل لـDebian.

---

## خطة الطوارئ إذا انكسر البناء على الإنتاج

### المستوى الأول: تشخيص سريع (أقل من 5 دقائق)
```
docker build --no-cache -t al-fajr/postgres:test ./infra/docker/postgres/ 2>&1 | tail -30
```
ابحث عن: "No such file or directory" أو "not found" في مخرجات make

### المستوى الثاني: Debian fallback (أقل من 30 دقيقة)
استبدال Dockerfile بـ:

```dockerfile
FROM postgres:16

RUN apt-get update && apt-get install -y --no-install-recommends \
      git make gcc postgresql-server-dev-16 \
    && git clone --depth 1 https://github.com/fboulnois/pg_uuidv7.git /tmp/pg_uuidv7 \
    && cd /tmp/pg_uuidv7 && make && make install \
    && cd / && rm -rf /tmp/pg_uuidv7 \
    && apt-get purge -y git make gcc postgresql-server-dev-16 \
    && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*
```

لا يعتمد على LLVM أو symlinks — يعمل مباشرة.

### المستوى الثالث: Application-Level UUID (أقل من يوم عمل)
إزالة DEFAULT uuid_generate_v7() من 25 جدول + توليد UUID في NestJS.

---

## جدول المراجعة

الحدث | الإجراء
ترقية PostgreSQL 16.x minor | اختبار بناء في dev، تحديث digest
انتقال Alpine إلى v3.25+ | اختبار في dev أولاً
الانتقال لـPostgreSQL 17 | إعادة تقييم هذا ADR بالكامل
Phase 2 kickoff | مراجعة البديل (ب) كأساس للـproduction image

---

## الاستخلاص

الحل الحالي يعمل ويمكن إدارته بشرط تثبيت الـdigest. لكنه ليس
الحل الأمثل للإنتاج طويل المدى. البديل (ب) Debian-based هو الهدف
الطبيعي لـPhase 2 إذا ظهرت أي مشكلة.

هذا القرار يُقبَل لإغلاق Phase 1، ويُعاد تقييمه في بداية Phase 2.
