# API-DESIGN.md — عقد واجهة برمجة التطبيقات
## Majlis Al-Alim (مجالس العالم) Educational Platform · REST API v1

| الحقل | القيمة |
|-------|--------|
| الوثيقة | AF-API-DESIGN-001 |
| الإصدار | 1.1.0 — APPROVED |
| التاريخ | 2026-08-10 |
| المُعِد | Chief Software Architect |
| الحالة | ✅ معتمد — جاهز للتنفيذ |

---

## القرارات المُقفلة (مرجع سريع)

| القرار | الاختيار | المرجع |
|--------|---------|--------|
| API Style | REST + JSON:API conventions | ADR-004 |
| Pagination للموبايل | Cursor-based | API-001 — موافقة 2026-08-09 |
| Pagination للوحة التحكم | Offset-based | API-001 — موافقة 2026-08-09 |
| Media Streaming | Presigned URL بصلاحية 60 دقيقة + تجديد تلقائي | API-002 — موافقة 2026-08-09 |
| Auth | JWT RS256 + Rotating Refresh Tokens | ADR-008 |
| Content URL pattern | `/content/:slug/*` فقط — لا يُكشف internal id للعميل | API-003 — موافقة 2026-08-10 |

---

## المبادئ العامة

### Base URL
```
Production:  https://api.majlis-alim.app/api/v1
Staging:     https://api-staging.majlis-alim.app/api/v1
Local Dev:   http://localhost:3000/api/v1
```

### Authentication
```
Header: Authorization: Bearer <access_token>

Token specs:
  access_token:  JWT RS256, TTL=15 min, payload: { sub, role, jti, iat, exp }
  refresh_token: Opaque string, TTL=7 days, stored HttpOnly cookie OR in body
  token_family:  UUID — reuse detection (rotation invalidates whole family on reuse)
```

### Content-Type
```
Request:  Content-Type: application/json; charset=utf-8
Response: Content-Type: application/json; charset=utf-8
Uploads:  multipart/form-data (presigned URL flow — direct to S3, not this API)
```

### Response Envelope

**نجاح:**
```json
{
  "data": { ... } | [...],
  "meta": {
    "total": 150,
    "limit": 20,
    "nextCursor": "eyJpZCI6Ii4uLiJ9",
    "prevCursor": null
  }
}
```

**خطأ:**
```json
{
  "error": {
    "code": "AUTH_TOKEN_EXPIRED",
    "message": "Access token has expired",
    "details": [...],
    "trace_id": "01920abc-def0-7890-abcd-ef0123456789"
  }
}
```

### Error Codes (canonical list)

| HTTP | Code | السبب |
|------|------|-------|
| 400 | `VALIDATION_ERROR` | فشل التحقق من المدخلات |
| 401 | `AUTH_MISSING_TOKEN` | لا يوجد Authorization header |
| 401 | `AUTH_TOKEN_EXPIRED` | انتهت صلاحية الـ access token |
| 401 | `AUTH_TOKEN_INVALID` | توقيع JWT غير صحيح |
| 401 | `AUTH_INVALID_CREDENTIALS` | بيانات الدخول خاطئة (email أو password) |
| 401 | `AUTH_REFRESH_REUSED` | إعادة استخدام refresh token محذوف (هجوم محتمل) |
| 403 | `FORBIDDEN` | الـ token صحيح لكن الصلاحية غير كافية |
| 404 | `NOT_FOUND` | المورد غير موجود |
| 409 | `CONFLICT` | تعارض (email موجود، slug مكرر...) |
| 410 | `RESOURCE_EXPIRED` | الرمز منتهي الصلاحية أو مستخدم مسبقاً (OTP، Reset Token) |
| 422 | `UNPROCESSABLE` | البيانات صحيحة التنسيق لكن غير قابلة للمعالجة |
| 429 | `RATE_LIMITED` | تجاوز حد الطلبات |
| 503 | `MAINTENANCE_MODE` | الصيانة المجدولة |

### Rate Limiting Headers
```
X-RateLimit-Limit:     100
X-RateLimit-Remaining: 87
X-RateLimit-Reset:     1722985200
Retry-After:           60          (فقط عند 429)
```

### Rate Limits — جدول مفصّل

> الحدود مُطبَّقة على Redis (sliding window).
> قيم الـ Auth endpoints ثابتة كحماية من brute-force ولا تقبل تجاوزاً.
> قيم باقي الـ endpoints مخزونة في `ad_system_config` وتقبل التعديل من لوحة التحكم دون deployment.

| Endpoint | الحد | النافذة | المعيار |
|----------|------|---------|---------|
| `POST /auth/register/email` | 5 | ساعة / IP | منع التسجيل المتكرر |
| `POST /auth/register/phone/initiate` | 3 | 10 دقائق / phone | منع إغراق SMS |
| `POST /auth/login/email` | 10 | دقيقة / IP | منع brute-force كلمة المرور |
| `POST /auth/login/phone/initiate` | 3 | 10 دقائق / phone | منع إغراق SMS |
| `POST /auth/token/refresh` | 30 | دقيقة / user | منع rotation flooding |
| `POST /auth/password/reset/request` | 3 | ساعة / IP | منع timing-based email enumeration |
| جميع `/api/v1/admin/*` | 60 | دقيقة / user | حد Admin عام |
| جميع endpoints أخرى | 200 | دقيقة / user | الحد العام |

### Pagination

**Cursor (للموبايل / infinite scroll):**
```
GET /api/v1/content?limit=20&cursor=eyJpZCI6Ii4uLiJ9
Response meta: { nextCursor, prevCursor, limit }
```

**Offset (للوحة التحكم Admin فقط):**
```
GET /api/v1/admin/users?page=3&limit=25
Response meta: { total, page, limit, totalPages }
```

---

## BC01: Identity — Endpoints (Phase 1 مُنجز كاملاً)

### Auth — التسجيل

```
POST /api/v1/auth/register/email
```
```json
Request:
{
  "fullName": "أحمد محمد",
  "email": "ahmed@example.com",
  "password": "SecurePass123!"
}

Response 201:
{
  "data": {
    "user": { "id": "...", "fullName": "أحمد محمد", "email": "ahmed@example.com", "role": "User" },
    "accessToken": "eyJ...",
    "refreshToken": "opaque_token_string",
    "expiresIn": 900
  }
}

Errors: 409 CONFLICT (email موجود) | 400 VALIDATION_ERROR
```

---

```
POST /api/v1/auth/register/phone/initiate
```
```json
Request:  { "phoneE164": "+966501234567" }
Response 200:
{
  "data": {
    "challengeId": "01920abc-...",   -- UUID — يُمرَّر لـ /verify
    "expiresAt": "2026-08-10T08:00:00Z",
    "otpLength": 6
  }
}
Errors: 409 CONFLICT (phone موجود) | 429 RATE_LIMITED
```

---

```
POST /api/v1/auth/register/phone/verify
```
```json
Request:  { "challengeId": "uuid", "otp": "123456", "fullName": "أحمد محمد" }
Response 201: { "data": { "user": {...}, "accessToken": "...", "refreshToken": "...", "expiresIn": 900 } }
Errors: 400 VALIDATION_ERROR (OTP خاطئ أو challengeId مجهول)
      | 410 RESOURCE_EXPIRED (OTP منتهي الصلاحية أو مستخدم مسبقاً)
```

---

### Auth — تسجيل الدخول

```
POST /api/v1/auth/login/email
```
```json
Request:  { "email": "ahmed@example.com", "password": "SecurePass123!" }
Response 200: { "data": { "user": {...}, "accessToken": "...", "refreshToken": "...", "expiresIn": 900 } }
Errors: 401 AUTH_INVALID_CREDENTIALS (email أو password خاطئ — رسالة موحّدة لمنع enumeration)
      | 403 FORBIDDEN (حساب موقوف)
```

---

```
POST /api/v1/auth/login/phone/initiate
```
```json
Request:  { "phoneE164": "+966501234567" }
Response 200:
{
  "data": {
    "challengeId": "01920abc-...",   -- UUID جديد في كل طلب (حتى لو نفس الرقم)
    "expiresAt": "2026-08-10T08:00:00Z",
    "otpLength": 6
  }
}
Errors: 404 NOT_FOUND (phone غير مسجّل) | 429 RATE_LIMITED
```

---

```
POST /api/v1/auth/login/phone/verify
```
```json
Request:  { "challengeId": "uuid", "otp": "123456" }
-- لا يوجد fullName هنا (مستخدم موجود مسبقاً)
Response 200: { "data": { "user": {...}, "accessToken": "...", "refreshToken": "...", "expiresIn": 900 } }
Errors: 400 VALIDATION_ERROR (OTP خاطئ أو challengeId مجهول)
      | 410 RESOURCE_EXPIRED (OTP منتهي الصلاحية أو مستخدم مسبقاً)
      | 403 FORBIDDEN (حساب موقوف)
```

---

```
POST /api/v1/auth/login/google
```
```json
Request:  { "idToken": "google_id_token_string" }
Response 200: { "data": { "user": {...}, "accessToken": "...", "refreshToken": "...", "expiresIn": 900, "isNewUser": false } }
Errors: 401 AUTH_TOKEN_INVALID (token فاسد أو منتهي)
```

```
POST /api/v1/auth/login/apple
POST /api/v1/auth/login/facebook
```
*(نفس الصيغة — idToken للـ Apple، accessToken للـ Facebook)*

---

### Auth — Token Management

```
POST /api/v1/auth/token/refresh
```
```json
Request:  { "refreshToken": "opaque_token_string" }
Response 200: { "data": { "accessToken": "eyJ...", "refreshToken": "new_opaque_token", "expiresIn": 900 } }
Errors: 401 AUTH_REFRESH_REUSED | 401 AUTH_TOKEN_EXPIRED (refresh منتهي)
```

---

```
POST /api/v1/auth/logout
Authorization: Bearer <access_token>
```
```json
Request:  { "refreshToken": "opaque_token_string" }
-- إن لم يُرسَل refreshToken: يُقبل الطلب، لا أثر على DB (access token سيُبطَل عند انتهائه طبيعياً)
-- إن أُرسل refreshToken منتهٍ أو مجهول: يُقبل الطلب بنجاح (idempotent — لا يُعيد خطأ)
Response 200: { "data": { "message": "Logged out successfully" } }
```

---

```
POST /api/v1/auth/logout/all
Authorization: Bearer <access_token>
```
*(يُلغي جميع refresh tokens للمستخدم الحالي — جميع الأجهزة)*
```json
Response 200: { "data": { "revokedCount": 3 } }
```

---

### Auth — Password Management

```
POST /api/v1/auth/password/reset/request
```
```json
Request:  { "email": "ahmed@example.com" }
Response 200: { "data": { "message": "If this email exists, a reset link was sent" } }
-- لا تُعيد 404 حتى لو email غير موجود (يمنع email enumeration)
```

---

```
POST /api/v1/auth/password/reset/confirm
```
```json
Request:  { "token": "reset_token_from_email", "newPassword": "NewSecurePass456!" }
Response 200: { "data": { "message": "Password reset successfully" } }
Errors: 400 VALIDATION_ERROR (كلمة المرور لا تستوفي الشروط)
      | 410 RESOURCE_EXPIRED (token منتهي الصلاحية أو مستخدم مسبقاً)
```

---

```
POST /api/v1/auth/password/change
Authorization: Bearer <access_token>
```
```json
Request:  { "currentPassword": "OldPass123!", "newPassword": "NewPass456!" }
Response 200: { "data": { "message": "Password changed. All other sessions revoked." } }
-- يُلغي جميع refresh tokens الأخرى (إلا الحالية)
```

---

### User Profile

> [!NOTE]
> **قرار معماري (Architectural Decision):**
> * **الواقع الفعلي الحالي (Phase 1 / BC01):** يُقدَّم مسار جلب الملف الشخصي عبر `GET /api/v1/auth/users/me` داخل `AuthController` للتحقق من صحة توثيق Bearer Token (RS256).
> * **مبرر القرار والتأجيل:** نظراً لأن هذا الـ Endpoint هو الوحيد المفعل حالياً لبيانات المستخدم، ويعمل ومختبر بالكامل بنسبة 100% في الـ Backend وتطبيق Flutter، فقد تم اعتماد توثيقه الحالي لتفادي أي كسر في عقود التشغيل الحالية.
> * **خطة المرحلة الثانية (Phase 2):** عند إضافة باقي مسارات إدارة الحساب (`PATCH /users/me`, `DELETE /users/me`, `GET/DELETE /users/me/sessions`)، سيتم استخراج `UsersController` مستقل تحت بادئة `/users` بكل نظافة وسهولة كإعادة هيكلة للـ routing دون المساس بمنطق الـ Domain والـ Repositories.

```
GET /api/v1/auth/users/me
Authorization: Bearer <access_token>
```
```json
Response 200:
{
  "data": {
    "id": "01920abc-...",
    "fullName": "أحمد محمد",
    "email": "ahmed@example.com",
    "phoneE164": null,
    "avatarUrl": null,
    "bio": null,
    "locale": "ar",
    "theme": "system",
    "audioSpeed": 1.0,
    "role": "User",
    "createdAt": "2026-08-09T20:00:00Z"
  }
}
```

---

```
PATCH /api/v1/users/me
Authorization: Bearer <access_token>
```
```json
Request (جميع الحقول اختيارية):
{
  "fullName": "أحمد محمد العمري",
  "bio": "طالب علم",
  "locale": "ar",
  "theme": "dark",
  "audioSpeed": 1.25
}
Response 200: { "data": { ...updated_user } }
Errors: 400 VALIDATION_ERROR
```

---

```
DELETE /api/v1/users/me
Authorization: Bearer <access_token>
```
```json
Request:  { "password": "CurrentPass123!" }
-- أو { "confirmText": "DELETE" } للـ OAuth-only accounts
Response 200: { "data": { "message": "Account scheduled for deletion in 30 days" } }
-- Soft delete: deleted_at = NOW()، PII يُحذف بعد 30 يوماً (GDPR)
```

---

```
GET /api/v1/users/me/sessions
Authorization: Bearer <access_token>
```
```json
Response 200:
{
  "data": [
    {
      "id": "01920abc-...",        -- هذا هو id_refresh_tokens.id — يُستخدم كـ :sessionId في DELETE أدناه
      "deviceName": "iPhone 15 Pro",
      "deviceIp": "192.168.1.1",
      "createdAt": "2026-08-01T10:00:00Z",
      "expiresAt": "2026-08-08T10:00:00Z",
      "isCurrent": true
    }
  ]
}
```

---

```
DELETE /api/v1/users/me/sessions/:sessionId
Authorization: Bearer <access_token>
```
```json
-- :sessionId = id_refresh_tokens.id (كما يُعاد في GET /me/sessions — ليس UUID مختلف)
Response 200: { "data": { "message": "Session revoked" } }
Errors: 404 NOT_FOUND | 403 FORBIDDEN (لا تستطيع حذف session شخص آخر)
```

---

### Admin — User Management
*(يتطلب Role: SuperAdmin أو Admin)*

```
GET /api/v1/admin/users?page=1&limit=25&search=ahmed&role=Editor&suspended=false
Authorization: Bearer <access_token>
```
```json
Response 200:
{
  "data": [ { "id": "...", "fullName": "...", "email": "...", "role": "Editor", "isSuspended": false, "createdAt": "..." } ],
  "meta": { "total": 47, "page": 1, "limit": 25, "totalPages": 2 }
}
```

---

```
GET    /api/v1/admin/users/:id
PATCH  /api/v1/admin/users/:id/roles        — body: { "role": "Moderator" }
POST   /api/v1/admin/users/:id/suspend      — body: { "reason": "انتهاك الشروط" }
POST   /api/v1/admin/users/:id/unsuspend
```

---

## BC02: Content — Endpoints (Phase 1 Scaffold → Phase 2 Implementation)

### Public (يتطلب Auth)

```
GET /api/v1/content?limit=20&cursor=...&type=AUDIO&category=quran&locale=ar
```
```json
Response 200:
{
  "data": [
    {
      "id": "...",
      "slug": "lecture-arabic-101",
      "type": "AUDIO",
      "status": "PUBLISHED",
      "title": "محاضرة في العقيدة",        -- من ct_translations
      "description": "...",
      "author": { "id": "...", "name": "د. أحمد" },
      "category": { "id": "...", "name": "العقيدة" },
      "media": { "durationMs": 3600000, "thumbnailUrl": "https://cdn.majlis-alim.app/..." },
      "viewCount": 1240,
      "publishedAt": "2026-07-01T00:00:00Z"
    }
  ],
  "meta": { "nextCursor": "eyJ...", "prevCursor": null, "limit": 20 }
}
```

---

```
GET /api/v1/content/:slug
```
```json
Response 200:
{
  "data": {
    "id": "...",
    "slug": "lecture-arabic-101",
    "type": "AUDIO",
    "title": "محاضرة في العقيدة",
    "body": "...",
    "media": {
      "durationMs": 3600000,
      "thumbnailUrl": "https://cdn.majlis-alim.app/..."
      -- لا streamUrl هنا — المحتوى المحمي يُطلب منفصلاً عبر GET /:slug/media/stream (API-002)
    },
    "author": { "id": "...", "name": "د. أحمد", "avatarUrl": "..." },
    "category": { "id": "...", "slug": "aqeedah", "name": "العقيدة" },
    "tags": [ { "id": "...", "slug": "tawheed", "name": "التوحيد" } ],
    "availableLocales": ["ar", "en"],
    "viewCount": 1241,
    "publishedAt": "2026-07-01T00:00:00Z"
  }
}
```

---

```
GET /api/v1/content/:slug/media/stream
Authorization: Bearer <access_token>
```
```json
-- API-002: Presigned URL — صلاحية 60 دقيقة (3600 ثانية)
-- يُستخدم للمحتوى المحمي فقط (AUDIO، PDF) — الـ thumbnails تأتي عبر cdn_url في الـ media object مباشرة
Response 200:
{
  "data": {
    "url": "https://r2.cloudflarestorage.com/...?X-Amz-Expires=3600&...",
    "expiresAt": "2026-08-09T22:00:00Z",
    "mimeType": "audio/mpeg",
    "durationMs": 3600000
  }
}
-- الموبايل: يطلب URL جديد 5 دقائق قبل الانتهاء (auto-refresh)
```

---

```
GET /api/v1/content/categories
```
```json
-- يُعيد الشجرة كاملة flat مع parentId — العميل يبني الشجرة nested بـ O(n)
-- حد أقصى مراقَب: 200 تصنيف. إن تجاوز يُطبَّق cursor pagination لاحقاً.
Response 200:
{
  "data": [
    { "id": "...", "slug": "quran",   "name": "القرآن",  "parentId": null,  "sortOrder": 0 },
    { "id": "...", "slug": "tafseer","name": "التفسير", "parentId": "...", "sortOrder": 1 },
    { "id": "...", "slug": "aqeedah","name": "العقيدة", "parentId": null,  "sortOrder": 2 }
  ]
}
```

---

```
GET /api/v1/content/categories/:slug
```
```json
-- تصنيف واحد + أبناؤه المباشرون فقط (depth=1)
Response 200:
{
  "data": {
    "id": "...", "slug": "quran", "name": "القرآن", "parentId": null, "sortOrder": 0,
    "children": [
      { "id": "...", "slug": "tafseer", "name": "التفسير", "sortOrder": 1 }
    ]
  }
}
```

---

```
GET /api/v1/content/tags
```
```json
Response 200: { "data": [ { "id": "...", "slug": "tawheed", "name": "التوحيد" } ] }
```

---

### Admin Content Management
*(يتطلب Role: Editor أو Admin أو SuperAdmin)*

```
POST   /api/v1/admin/content
PATCH  /api/v1/admin/content/:id
POST   /api/v1/admin/content/:id/submit-review   -- DRAFT -> REVIEW
POST   /api/v1/admin/content/:id/publish         -- REVIEW -> PUBLISHED
POST   /api/v1/admin/content/:id/archive         -- PUBLISHED -> ARCHIVED
DELETE /api/v1/admin/content/:id
```

**Upload Flow (S3 Presigned):**
```
1. POST /api/v1/admin/media/upload/initiate
   Request:  { "fileName": "lecture.mp3", "mimeType": "audio/mpeg", "sizeBytes": 52428800 }
   Response: { "data": { "uploadId": "uuid", "presignedUrl": "https://...", "expiresAt": "..." } }

2. Client: PUT <presignedUrl> بـ binary data مباشرة إلى S3

3. POST /api/v1/admin/media/upload/complete
   Request:  { "uploadId": "uuid" }
   Response: { "data": { "mediaAssetId": "uuid", "transcodeStatus": "PENDING" } }

4. Webhook / polling: GET /api/v1/admin/media/:id/status
   Response:
   {
     "data": {
       "transcodeStatus": "DONE",
       "thumbnailUrl": "https://cdn.majlis-alim.app/...",          -- رابط CDN عام دائم (thumbnail فقط)
       "isPublicAsset": false,                                  -- AUDIO/PDF = false، IMAGE = true
       "streamEndpoint": "/api/v1/content/:slug/media/stream"  -- للمحتوى المحمي (API-002)
       -- لا cdnUrl خام للأصل الأصلي — المحتوى المحمي لا يُعرض برابط دائم مطلقاً
     }
   }
```

---

## BC03: Engagement — Endpoints (Phase 1 Scaffold → Phase 2-3 Implementation)

### Comments

```
GET  /api/v1/content/:contentId/comments?limit=20&cursor=...
POST /api/v1/content/:contentId/comments
```
```json
POST Request:  { "body": "جزاك الله خيراً", "parentId": null }
POST Response 201: { "data": { "id": "...", "body": "...", "upvotesCount": 0, "status": "PENDING", ... } }
-- status=PENDING: يظهر للكاتب مباشرة، يظهر للآخرين بعد موافقة Moderator
```

```
PATCH /api/v1/comments/:id
```
```json
-- تعديل تعليق: صاحبه فقط، ضمن نافذة زمنية قابلة للتعديل من لوحة التحكم
-- النافذة مُحدَّدة في ad_system_config مفتاح "comment.edit_window_minutes" (افتراضي: 15)
-- تعديل القيمة عبر: PATCH /api/v1/admin/system/config/comment.edit_window_minutes
Request:  { "body": "النص المعدّل" }
Response 200: { "data": { ...updated_comment } }
Errors: 403 FORBIDDEN (ليس صاحب التعليق، أو انتهت نافذة التعديل)
```

```
DELETE /api/v1/comments/:id              -- حذف (صاحبه أو Moderator)
POST   /api/v1/comments/:id/vote         -- upvote / unvote (toggle)
```

### Q&A

```
GET  /api/v1/questions?limit=20&cursor=...&contentId=...&answered=false
POST /api/v1/questions
GET  /api/v1/questions/:id
POST /api/v1/questions/:id/answers
```

### Moderation (Moderator/Admin)

```
GET  /api/v1/admin/moderation/comments?status=PENDING&page=1&limit=25
POST /api/v1/admin/moderation/comments/:id/approve
POST /api/v1/admin/moderation/comments/:id/reject     -- body: { "reason": "..." }
POST /api/v1/admin/moderation/comments/:id/flag

GET  /api/v1/admin/moderation/questions?status=PENDING&page=1&limit=25
POST /api/v1/admin/moderation/questions/:id/approve
POST /api/v1/admin/moderation/questions/:id/reject
```

---

## BC04: Notifications — Endpoints (Phase 1 Scaffold → Phase 3)

```
GET   /api/v1/notifications?limit=20&cursor=...&unreadOnly=true
POST  /api/v1/notifications/read-all
PATCH /api/v1/notifications/:id/read
```
```json
GET Response:
{
  "data": [
    {
      "id": "...",
      "channel": "IN_APP",
      "category": "qa_answer",
      "title": "تم الرد على سؤالك",
      "body": "أجاب د. أحمد على سؤالك: ...",
      "data": { "questionId": "..." },
      "status": "SENT",
      "createdAt": "..."
    }
  ],
  "meta": {
    "unreadCount": 5,    -- إجمالي الإشعارات غير المقروءة للمستخدم (جميع الصفحات، ليس الصفحة الحالية فقط)
                         -- يُستخدم لعرض الـ badge في تطبيق الموبايل
    "nextCursor": "...",
    "limit": 20
  }
}
```

---

```
GET   /api/v1/notifications/preferences
PATCH /api/v1/notifications/preferences
```
```json
PATCH Request:
{
  "preferences": [
    { "channel": "FCM_PUSH", "category": "new_content", "isEnabled": true },
    { "channel": "EMAIL",    "category": "qa_answer",   "isEnabled": false }
  ]
}
```

---

```
POST   /api/v1/notifications/devices     -- تسجيل FCM token
DELETE /api/v1/notifications/devices/:id -- حذف device (عند تسجيل الخروج)
```
```json
POST Request:
{ "fcmToken": "fZ1...", "deviceName": "iPhone 15 Pro", "platform": "ios" }
```

---

```
-- Admin only
POST /api/v1/admin/announcements
GET  /api/v1/admin/announcements?page=1&limit=25
```
```json
POST Request:
{ "title": "تحديث المنصة", "body": "يسعدنا...", "target": "ALL" }
```

---

## Health & Admin System — Endpoints

### Health Checks (Docker / Uptime Kuma)

> المشروع يعمل على Docker Compose + Hostinger VPS (ADR-007). المصطلحات أدناه خاصة بـ Docker وUptime Kuma، لا بـ Kubernetes.

```
GET /health
```
> **الغرض:** فحص حيوية الـ container.
> - يُستخدم في `HEALTHCHECK` بـ `docker-compose.yml` لمعرفة إن كان الـ container يعمل.
> - يُراقَب بواسطة **Uptime Kuma** كـ HTTP monitor لإرسال تنبيهات عند الانقطاع.
> - يُعيد `200` فقط إن كانت قاعدة البيانات وRedis متاحتَين معاً.

```json
Response 200:
{
  "status": "ok",
  "info": {
    "database": { "status": "up" },
    "redis":    { "status": "up" }
  },
  "error": {},
  "details": { ... }
}

Response 503 (أي component فاشل):
{
  "status": "error",
  "info":  { "database": { "status": "up" } },
  "error": { "redis": { "status": "down", "message": "Connection refused" } }
}
```

---

```
GET /ready
```
> **الغرض:** فحص جاهزية التطبيق لاستقبال الطلبات — مختلف تماماً عن `/health`.
> - لا يُراقَب بواسطة Uptime Kuma (هو داخلي فقط).
> - يُستخدم من Nginx / reverse proxy للتحقق قبل توجيه الطلبات للخدمة.
> - يُستخدم في `docker-compose` لشرط `condition: service_healthy` بين services.
> - يُعيد `503` خلال startup أو أثناء تشغيل migrations حتى لا يصل إليه الـ proxy قبل الجاهزية.

```json
Response 200: { "status": "ready" }
Response 503: { "status": "starting", "reason": "running migrations" }
```

---

### Analytics (Admin)

```
GET /api/v1/admin/analytics/overview
```
```json
Response 200:
{
  "data": {
    "dau": 342, "wau": 1240, "mau": 4800,
    "newUsersToday": 23,
    "topContent": [
      { "id": "...", "title": "...", "type": "AUDIO", "viewCount": 1240 }
    ],
    "authMethodBreakdown": {
      "email": 45, "phone": 30, "google": 20, "apple": 4, "facebook": 1
    }
  }
}
```

```
GET /api/v1/admin/analytics/content?type=AUDIO&from=2026-08-01&to=2026-08-09
```

---

### Audit Log (Admin)

```
GET /api/v1/admin/audit-log?page=1&limit=50&action=user.suspend&actorId=...&from=...&to=...
```
```json
Response 200:
{
  "data": [
    {
      "id": "...",
      "actor": { "id": "...", "name": "أحمد", "role": "Admin" },
      "action": "user.suspend",
      "entityType": "user",
      "entityId": "...",
      "oldValue": { "isSuspended": false },
      "newValue":  { "isSuspended": true, "reason": "انتهاك الشروط" },
      "ipAddress": "192.168.1.1",
      "createdAt": "..."
    }
  ],
  "meta": { "total": 234, "page": 1, "limit": 50, "totalPages": 5 }
}
```

---

### System Config (SuperAdmin only)

```
GET   /api/v1/admin/system/config
PATCH /api/v1/admin/system/config/:key
```
```json
PATCH Request: { "value": <json_value> }
-- مثال: PATCH /api/v1/admin/system/config/maintenance_mode             body: { "value": true }
-- مثال: PATCH /api/v1/admin/system/config/comment.edit_window_minutes  body: { "value": 30 }
-- مثال: PATCH /api/v1/admin/system/config/max_upload_size_mb           body: { "value": 250 }
```

---

## Role Authorization Matrix

| Endpoint Group | User | Moderator | Editor | Admin | SuperAdmin |
|---------------|------|-----------|--------|-------|------------|
| Auth endpoints | ✅ | ✅ | ✅ | ✅ | ✅ |
| Content browse | ✅ | ✅ | ✅ | ✅ | ✅ |
| Media stream | ✅ | ✅ | ✅ | ✅ | ✅ |
| Comments/QA write | ✅ | ✅ | ✅ | ✅ | ✅ |
| Moderation actions | ❌ | ✅ | ❌ | ✅ | ✅ |
| Content CRUD | ❌ | ❌ | ✅ | ✅ | ✅ |
| Media upload | ❌ | ❌ | ✅ | ✅ | ✅ |
| User management | ❌ | ❌ | ❌ | ✅ | ✅ |
| Role assignment | ❌ | ❌ | ❌ | ✅ | ✅ |
| Analytics | ❌ | ❌ | ❌ | ✅ | ✅ |
| System config | ❌ | ❌ | ❌ | ❌ | ✅ |
| Announcements | ❌ | ❌ | ❌ | ✅ | ✅ |

---

## API Versioning Policy

```
/api/v1/* — الإصدار الحالي (Phase 1)
/api/v2/* — سيُفتح عند تغيير breaking (مع نافذة 6 أشهر overlap)

Breaking changes تستوجب إصدار جديد:
  - حذف field من response
  - تغيير نوع field
  - تغيير URL structure
  - تغيير auth mechanism

Non-breaking (لا تستوجب إصدار جديد):
  - إضافة field جديد للـ response
  - إضافة endpoint جديد
  - إضافة query param اختياري
```

---

## Swagger UI

```
Local Dev:  http://localhost:3000/docs
Staging:    https://api-staging.majlis-alim.app/docs
Production: متاح فقط لـ Admin role (JWT مطلوب — protected route) — لا يُعرض للعموم
```

---

## CHANGE LOG

| الإصدار | التاريخ | التغيير |
|---------|---------|---------|
| 1.1.0 | 2026-08-10 | **13 تعديل:** (API-003) توحيد `/content/:slug/*` — لا يُكشف internal id للعميل. `AUTH_INVALID_CREDENTIALS` (401) و`RESOURCE_EXPIRED` (410) للقائمة الرسمية. حذف `streamUrl: null` من response. `:sessionId = id_refresh_tokens.id` موثّق صراحةً. فصل `thumbnailUrl`/`streamEndpoint` في upload response (أمان — API-002، لا cdnUrl خام). `comment.edit_window_minutes` في `ad_system_config`. categories response format (flat+parentId). login/phone/verify بتفاصيل كاملة. logout بدون refreshToken = idempotent. `unreadCount` = إجمالي. preferences wrapper موحّد. جدول Rate Limits مفصّل. `/health` و`/ready` بمصطلحات Docker/Uptime Kuma. |
| 1.0.0 | 2026-08-09 | الإصدار الأول المعتمد. تحديد Cursor للموبايل + Offset للـ Admin (API-001). Presigned URL 60 دقيقة (API-002). Matrix كامل للصلاحيات. |
