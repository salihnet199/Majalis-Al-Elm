# مجالس العلم — Majalis Al-Elm

منصة تعليمية وإسلامية متعددة التطبيقات، مبنية كـ Nx monorepo وتضم Backend بـ NestJS، لوحة إدارة React، وتطبيق Flutter.

## مكونات المشروع

- `apps/backend` — REST API بـ NestJS + PostgreSQL + TypeORM
- `apps/admin` — لوحة الإدارة React/Vite
- `apps/mobile` — تطبيق Flutter
- `apps/backend-e2e` — اختبارات Smoke/E2E للـ API
- `infra/docker` — PostgreSQL المخصص وNginx

## التشغيل المحلي

```bash
cp .env.example .env.local
bash scripts/gen-jwt-keys.sh
npm ci
docker compose --env-file .env.local up -d postgres minio
node scripts/ensure-media-bucket.mjs
npx nx serve backend
```

API: `http://localhost:3000/api/v1`
Swagger: `http://localhost:3000/docs`
Health: `http://localhost:3000/api/v1/health`

## الفحوصات

```bash
npm run lint
npm run type-check
npm test
npm run test:e2e
npm run test:db
npm run test:storage
cd apps/mobile && flutter analyze && flutter test && flutter build apk --release
```

## متطلبات الإنتاج

يجب توفير مفاتيح JWT RS256، إعدادات PostgreSQL، وS3/R2 حقيقي قبل التشغيل. التطبيق يرفض الإقلاع في `staging` و`production` عند وجود إعدادات تخزين أو مفاتيح غير آمنة.

لا تضع أسرارًا داخل ملفات `.env` المتتبعة أو داخل Vite `VITE_*`؛ استخدم `.env.local` أو أسرار بيئة CI/CD.
