# Runbook: إعداد البيئة الأولية بعد أول Production Deployment

## AF-OPS-001 — First-Boot Operations Runbook

| الحقل | القيمة |
|-------|--------|
| المرجع | AF-OPS-001 |
| الإصدار | 1.0.0 |
| التاريخ | 2026-08-17 |
| الناظر | Chief Software Architect / DevOps Lead |
| الحالة | ✅ معتمد — إلزامي لكل Production deployment جديد |

---

> [!CAUTION]
> هذا الـ Runbook يحتوي على خطوات إلزامية يجب تنفيذها **مرة واحدة فقط** بعد أول `migration` على بيئة Production أو Staging جديدة. تجاهل أي خطوة سيُعطِّل وظائف إدارية حرجة.

---

## ترتيب التنفيذ بعد `docker compose up` الأول

```
1. تأكد من نجاح كل الـ migrations (000 → 042)
2. أنشئ حساب SuperAdmin (هذا الـ Runbook)
3. أكمل إعداد النظام عبر لوحة التحكم
```

---

## الخطوة 1 — تشغيل كل الـ Migrations بالترتيب

```bash
# من مجلد المشروع:
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/000_bootstrap.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/001_identity_users.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/002_identity_roles.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/003_identity_auth_tokens.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/004_identity_oauth_otp.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/010_content_types.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/011_content_taxonomy.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/012_content_media.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/013_content_items.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/014_content_translations.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/020_engagement_types.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/021_engagement_comments.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/022_engagement_qa.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/030_notifications_types.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/031_notifications_devices.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/032_notifications_preferences.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/033_notifications_log.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/040_admin_audit_log.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/041_admin_system_config.sql
docker compose exec postgres psql -U majlisalim -d majlisalim -f /migrations/042_admin_analytics.sql
```

---

## الخطوة 2 — إنشاء حساب SuperAdmin الأول ⚠️ إلزامي

> [!IMPORTANT]
> دور `SuperAdmin` **لا يمكن إسناده عبر API** (قرار أمني مقصود — `PATCH /admin/users/:id/role` يرفض SuperAdmin عن عمد). الإسناد الأول يجب أن يكون SQL مباشر في قاعدة البيانات.
>
> بعد هذه الخطوة فقط يمكن للـ SuperAdmin تعيين أدوار Admin و Editor و Moderator للمستخدمين الآخرين عبر واجهة API.

### أ. سجِّل حساب SuperAdmin عبر API (يُنشئ المستخدم بدور User افتراضي)

```bash
curl -X POST https://YOUR_DOMAIN/api/v1/auth/register/email \
  -H "Content-Type: application/json" \
  -d '{
    "fullName": "مدير النظام",
    "email": "superadmin@majlisalim.example.com",
    "password": "YOUR_SECURE_PASSWORD_HERE"
  }'
```

> [!IMPORTANT]
> بريد `superadmin@majlisalim.example.com` هو مجرد نطاق وهمي توثيقي (`placeholder`). يجب استبداله ببريد إلكتروني إداري رسمي وحقيقي قبل أي تشغيل فعلي في بيئة الإنتاج (`Production`).

احتفظ بـ `user.id` من الـ response — ستحتاجه في الخطوة التالية.

### ب. احصل على UUID للمستخدم من قاعدة البيانات

```sql
SELECT id, full_name, email
FROM id_users
WHERE email = 'superadmin@majlisalim.example.com';
```

### ج. أسند دور SuperAdmin مباشرةً في قاعدة البيانات

```sql
-- أسند دور SuperAdmin للمستخدم (استبدل USER_UUID بالـ UUID الفعلي)
INSERT INTO id_user_roles (user_id, role_id, assigned_by)
SELECT
  'USER_UUID'::uuid,
  r.id,
  'USER_UUID'::uuid   -- assigned_by = نفس المستخدم (bootstrap)
FROM id_roles r
WHERE r.name = 'SuperAdmin';

-- تحقق من نجاح الإسناد:
SELECT u.full_name, u.email, r.name AS role
FROM id_users u
JOIN id_user_roles ur ON ur.user_id = u.id
JOIN id_roles r ON r.id = ur.role_id
WHERE u.email = 'superadmin@majlisalim.example.com';
```

**النتيجة المتوقعة:**

```
full_name    | email                           | role
-------------+---------------------------------+------------
مدير النظام  | superadmin@majlisalim.example.com   | SuperAdmin
```

### د. تحقق من صلاحيات SuperAdmin عبر API

```bash
# Login للحصول على token
LOGIN_RESPONSE=$(curl -s -X POST https://YOUR_DOMAIN/api/v1/auth/login/email \
  -H "Content-Type: application/json" \
  -d '{"email":"superadmin@majlisalim.example.com","password":"YOUR_SECURE_PASSWORD_HERE"}')

TOKEN=$(echo $LOGIN_RESPONSE | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])")

# اختبر الوصول لـ API إدارية (يجب أن يُعيد 200)
curl -H "Authorization: Bearer $TOKEN" https://YOUR_DOMAIN/api/v1/admin/analytics/overview

# اختبر PATCH لـ system config (SuperAdmin only — يجب أن يُعيد 200)
curl -X PATCH https://YOUR_DOMAIN/api/v1/admin/system/config/maintenance_mode \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"value": false}'
```

---

## الخطوة 3 — التحقق من System Config المُبذَّرة

```sql
-- يجب أن تُعيد 4 صفوف بعد Migration 041:
SELECT key, value, description FROM ad_system_config ORDER BY key;
```

**النتيجة المتوقعة:**

```
key                           | value | description
------------------------------+-------+-----------------------------------------
comment.edit_window_minutes   | 15    | النافذة الزمنية بالدقائق...
feature_flag.qa               | true  | تفعيل نظام الأسئلة والأجوبة
maintenance_mode              | false | إذا true: API يُعيد 503 لغير-admin
max_upload_size_mb            | 500   | الحجم الأقصى لرفع الملفات
```

---

## الخطوة 4 — إنشاء Admin و Editor أوليين (اختياري)

بعد تسجيل الدخول كـ SuperAdmin، يمكن إسناد أدوار المستخدمين الآخرين عبر API:

```bash
# مثال: إسناد دور Admin لمستخدم مسجَّل مسبقاً
curl -X PATCH https://YOUR_DOMAIN/api/v1/admin/users/EDITOR_USER_UUID/role \
  -H "Authorization: Bearer $SUPERADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"role": "Admin"}'
```

الأدوار المتاحة عبر API: `User | Editor | Moderator | Admin`

> [!WARNING]
> `SuperAdmin` لا يمكن إسناده عبر API — هذا تصميم مقصود (OWASP A01: Broken Access Control). كل إسناد SuperAdmin إضافي يستوجب وصولاً مباشراً لقاعدة البيانات من مهندس مُخوَّل.

---

## قائمة تحقق نهائية (Checklist)

```
☐ كل 20 migration نُفِّذت بالترتيب بدون أخطاء
☐ حساب SuperAdmin تم إنشاؤه ومنحه الدور عبر DB مباشرة
☐ تسجيل الدخول بـ SuperAdmin يُعيد role='SuperAdmin' في JWT payload
☐ PATCH /admin/system/config/maintenance_mode يُعيد 200 (لا 403)
☐ GET /admin/analytics/overview يُعيد بيانات (لا 500)
☐ ad_system_config تحتوي 4 صفوف مُبذَّرة
```

---

## استرداد الطوارئ

إن احتجت لحذف دور SuperAdmin من مستخدم في حالة طوارئ:

```sql
DELETE FROM id_user_roles
WHERE user_id = 'USER_UUID'::uuid
  AND role_id = (SELECT id FROM id_roles WHERE name = 'SuperAdmin');
```

> [!CAUTION]
> إن حذفت الدور من **كل** المستخدمين في آنٍ واحد ستفقد القدرة على إسناد الأدوار عبر API. احتفظ دائماً بحساب SuperAdmin واحد على الأقل نشط.
