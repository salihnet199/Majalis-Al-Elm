# DB-SCHEMA.md — مخطط قاعدة البيانات النهائي
## Majlis Al-Alim (مجالس العالم) Educational Platform · PostgreSQL 16 Schema

| الحقل | القيمة |
|-------|--------|
| الوثيقة | AF-DB-SCHEMA-001 |
| الإصدار | 1.1.0 — APPROVED |
| التاريخ | 2026-08-10 |
| المُعِد | Chief Software Architect |
| الحالة | ✅ معتمد — جاهز للتنفيذ بعد موافقة الراعي النهائية |

---

## القرارات المُقفلة (مرجع سريع)

| القرار | الاختيار | المرجع |
|--------|---------|--------|
| UUIDv7 implementation | pg_uuidv7 PostgreSQL extension — `uuid_generate_v7()` | DB-001 — موافقة رسمية 2026-08-09 |
| Arabic Full-Text Search | `ILIKE` فقط في Phase 1 — FTS متقدم مؤجل | DB-002 — Charter §3.2 |
| Categories tree | Adjacency List بـ `parent_id` فقط — بلا `lft`/`rgt`/`depth` | DB-003 — موافقة رسمية 2026-08-09 |

> [!IMPORTANT]
> **قاعدة صارمة:** لا يجوز كتابة أي TypeORM entity قبل كتابة migration مقابلة لهذا الملف. Schema هنا هي source of truth — وليس العكس.

---

## مبادئ التصميم العامة

| المبدأ | التطبيق |
|--------|---------|
| **Primary Keys** | UUIDv7 عبر `uuid_generate_v7()` من pg_uuidv7 extension — monotonic, sortable |
| **Soft Deletes** | `deleted_at TIMESTAMPTZ NULL` في كل جدول قابل للحذف |
| **Table Prefixes** | `id_*` · `ct_*` · `eg_*` · `nt_*` · `ad_*` — يعكس الـ Bounded Context |
| **Timestamps** | كل جدول يحتوي على `created_at` و`updated_at` بـ `TIMESTAMPTZ NOT NULL DEFAULT NOW()` |
| **Cross-BC References** | مسموح كـ UUID فقط (no FK) عبر الـ BC boundaries |
| **i18n** | جدول `ct_translations` مركزي — جميع النصوص القابلة للترجمة تخزن هناك |
| **Migrations** | كل تغيير على Schema = migration مُرقَّمة + DOWN migration + اختبار على staging أولاً |

---

## Migration 000 — Bootstrap (يُنفَّذ أولاً)

```sql
-- pg_uuidv7 : مطلوب — يوفّر uuid_generate_v7() للـ Primary Keys
-- citext    : مطلوب — حقول email بلا حساسية لحالة الأحرف
-- pgcrypto  : مطلوب — gen_random_bytes() لتوليد رموز OTP/Reset بأمان
--
-- unaccent  : محذوف (YAGNI — Phase 1)
--   البحث في Phase 1 يعتمد ILIKE فقط (DB-002).
--   إضافة unaccent مُرجأة لحين الحاجة الفعلية لبحث عربي بلا تشكيل.
--   عند إضافته لاحقاً: CREATE EXTENSION IF NOT EXISTS "unaccent";
--   ثم استخدامه عبر: unaccent(field) ILIKE unaccent('%query%')

CREATE EXTENSION IF NOT EXISTS "pg_uuidv7";
CREATE EXTENSION IF NOT EXISTS "citext";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ملاحظة: CREATE EXTENSION IF NOT EXISTS يفشل تلقائياً إن لم تكن
-- المكتبة مثبّتة على النظام. لا حاجة لـ DO block للتحقق بعده.
-- إن فشل pg_uuidv7: apt install postgresql-16-uuidv7 ثم أعِد التشغيل.
```

---

## BC01: Identity & Access Management — `id_*`

```sql
-- Migration: 001_identity_users.sql

CREATE TABLE id_users (
  id            UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  full_name     VARCHAR(200) NOT NULL,
  email         CITEXT       UNIQUE,
  phone_e164    VARCHAR(20)  UNIQUE,
  password_hash VARCHAR(255),
  avatar_url    TEXT,
  bio           TEXT,
  locale        VARCHAR(10)  NOT NULL DEFAULT 'ar',
  theme         VARCHAR(20)  NOT NULL DEFAULT 'system',
  audio_speed   DECIMAL(3,2) NOT NULL DEFAULT 1.00
                             CHECK (audio_speed BETWEEN 0.5 AND 2.0),
  is_suspended  BOOLEAN      NOT NULL DEFAULT FALSE,
  suspended_at  TIMESTAMPTZ,
  suspended_by  UUID         REFERENCES id_users(id),
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_id_users_contact
    CHECK (email IS NOT NULL OR phone_e164 IS NOT NULL),
  CONSTRAINT chk_id_users_suspension
    CHECK (is_suspended = FALSE OR suspended_at IS NOT NULL)
);

-- Migration: 002_identity_roles.sql

CREATE TABLE id_roles (
  id          UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  name        VARCHAR(50) NOT NULL UNIQUE,
  description TEXT,
  is_system   BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO id_roles (name, description, is_system) VALUES
  ('SuperAdmin',  'Full platform access — immutable',           TRUE),
  ('Admin',       'Platform administration and user management', TRUE),
  ('Editor',      'Content CRUD, media library, publishing',    TRUE),
  ('Moderator',   'Comments/QA moderation, user suspension',    TRUE),
  ('User',        'Default authenticated end-user',             TRUE);

CREATE TABLE id_user_roles (
  user_id     UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  role_id     UUID        NOT NULL REFERENCES id_roles(id) ON DELETE RESTRICT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  assigned_by UUID        REFERENCES id_users(id),
  PRIMARY KEY (user_id, role_id)
);

-- Migration: 003_identity_auth_tokens.sql

CREATE TABLE id_refresh_tokens (
  id           UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID         NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  token_hash   VARCHAR(64)  NOT NULL UNIQUE,
  token_family UUID         NOT NULL,
  device_name  VARCHAR(200),
  device_ip    INET,
  user_agent   TEXT,
  is_revoked   BOOLEAN      NOT NULL DEFAULT FALSE,
  revoked_at   TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ  NOT NULL,
  created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_id_refresh_revocation
    CHECK (is_revoked = FALSE OR revoked_at IS NOT NULL)
);

CREATE TABLE id_password_reset_tokens (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  token_hash VARCHAR(64) NOT NULL UNIQUE,
  is_used    BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migration: 004_identity_oauth_otp.sql

CREATE TABLE id_social_identities (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id     UUID         NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  provider    VARCHAR(20)  NOT NULL CHECK (provider IN ('google', 'apple', 'facebook')),
  provider_id VARCHAR(255) NOT NULL,
  email       CITEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (provider, provider_id)
);

CREATE TABLE id_otp_challenges (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  phone_e164   VARCHAR(20) NOT NULL,
  otp_hash     VARCHAR(64) NOT NULL,
  purpose      VARCHAR(30) NOT NULL CHECK (purpose IN ('login', 'register', 'reset_password')),
  attempts     SMALLINT    NOT NULL DEFAULT 0,
  max_attempts SMALLINT    NOT NULL DEFAULT 3,
  is_used      BOOLEAN     NOT NULL DEFAULT FALSE,
  expires_at   TIMESTAMPTZ NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_id_otp_attempts CHECK (attempts >= 0 AND attempts <= max_attempts)
);
```

**Indexes — BC01:**

```sql
CREATE UNIQUE INDEX idx_id_users_email_active  ON id_users(email) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX idx_id_users_phone_active  ON id_users(phone_e164) WHERE deleted_at IS NULL;
CREATE INDEX idx_id_refresh_user_active        ON id_refresh_tokens(user_id) WHERE NOT is_revoked;
CREATE INDEX idx_id_refresh_family             ON id_refresh_tokens(token_family);
CREATE INDEX idx_id_refresh_expires            ON id_refresh_tokens(expires_at) WHERE NOT is_revoked;
CREATE INDEX idx_id_otp_phone_expires          ON id_otp_challenges(phone_e164, expires_at) WHERE NOT is_used;
CREATE INDEX idx_id_social_user                ON id_social_identities(user_id);
```

---

## BC02: Content & Media Library — `ct_*`

```sql
-- Migration: 010_content_types.sql

CREATE TYPE ct_content_type     AS ENUM ('AUDIO', 'PDF', 'TEXT', 'IMAGE');
CREATE TYPE ct_content_status   AS ENUM ('DRAFT', 'REVIEW', 'PUBLISHED', 'ARCHIVED');
CREATE TYPE ct_transcode_status AS ENUM ('PENDING', 'PROCESSING', 'DONE', 'FAILED');

-- Migration: 011_content_taxonomy.sql

CREATE TABLE ct_authors (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       VARCHAR(150) NOT NULL UNIQUE,
  avatar_url TEXT,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE ct_categories (
  -- DB-003 (2026-08-09): Adjacency List فقط — لا lft / rgt / depth
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       VARCHAR(100) NOT NULL UNIQUE,
  parent_id  UUID         REFERENCES ct_categories(id),
  sort_order INTEGER      NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE ct_tags (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Migration: 012_content_media.sql

CREATE TABLE ct_media_assets (
  id               UUID                PRIMARY KEY DEFAULT uuid_generate_v7(),
  original_name    VARCHAR(500)        NOT NULL,
  storage_key      TEXT                NOT NULL UNIQUE,
  -- cdn_url: رابط دائم للأصول العامة فقط — thumbnails والصور المعروضة مباشرة.
  -- المحتوى المحمي (ملفات صوت، PDF) لا يُخزَّن هنا —
  -- يُولَّد رابطه عبر Presigned URL مؤقتة عند الطلب (راجع API-002).
  -- إن كان cdn_url موجوداً على أصل محمي: يُعامَل على أنه خطأ تصميمي.
  cdn_url          TEXT,
  mime_type        VARCHAR(100)        NOT NULL,
  size_bytes       BIGINT              NOT NULL CHECK (size_bytes > 0),
  duration_ms      INTEGER             CHECK (duration_ms IS NULL OR duration_ms > 0),
  page_count       INTEGER             CHECK (page_count IS NULL OR page_count > 0),
  width_px         INTEGER             CHECK (width_px IS NULL OR width_px > 0),
  height_px        INTEGER             CHECK (height_px IS NULL OR height_px > 0),
  thumbnail_key    TEXT,               -- key للـ thumbnail (أصل عام — cdn_url مقبول)
  transcode_status ct_transcode_status NOT NULL DEFAULT 'PENDING',
  transcode_error  TEXT,
  uploaded_by      UUID                NOT NULL REFERENCES id_users(id),
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ         NOT NULL DEFAULT NOW()
);

-- Migration: 013_content_items.sql

CREATE TABLE ct_content_items (
  id             UUID              PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug           VARCHAR(300)      NOT NULL UNIQUE,
  type           ct_content_type   NOT NULL,
  status         ct_content_status NOT NULL DEFAULT 'DRAFT',
  primary_locale VARCHAR(10)       NOT NULL DEFAULT 'ar',
  author_id      UUID              REFERENCES ct_authors(id),
  category_id    UUID              REFERENCES ct_categories(id),
  media_asset_id UUID              REFERENCES ct_media_assets(id),
  view_count     BIGINT            NOT NULL DEFAULT 0,
  sort_order     INTEGER           NOT NULL DEFAULT 0,
  is_featured    BOOLEAN           NOT NULL DEFAULT FALSE,
  published_at   TIMESTAMPTZ,
  scheduled_at   TIMESTAMPTZ,
  created_by     UUID              NOT NULL REFERENCES id_users(id),
  last_edited_by UUID              REFERENCES id_users(id),
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ       NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_ct_items_published
    CHECK (status != 'PUBLISHED' OR published_at IS NOT NULL)
);

CREATE TABLE ct_content_tags (
  content_id UUID NOT NULL REFERENCES ct_content_items(id) ON DELETE CASCADE,
  tag_id     UUID NOT NULL REFERENCES ct_tags(id)          ON DELETE CASCADE,
  PRIMARY KEY (content_id, tag_id)
);

-- Migration: 014_content_translations.sql

CREATE TABLE ct_translations (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  entity_type VARCHAR(50)  NOT NULL,
  entity_id   UUID         NOT NULL,
  locale      VARCHAR(10)  NOT NULL CHECK (locale IN ('ar', 'en', 'fr', 'ur', 'ms')),
  field_name  VARCHAR(100) NOT NULL,
  content     TEXT         NOT NULL,
  created_by  UUID         REFERENCES id_users(id),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (entity_type, entity_id, locale, field_name)
);
```

**Indexes — BC02:**

```sql
CREATE INDEX idx_ct_items_status_type    ON ct_content_items(status, type) WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_items_category       ON ct_content_items(category_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_items_author         ON ct_content_items(author_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_items_published_desc ON ct_content_items(published_at DESC)
  WHERE status = 'PUBLISHED' AND deleted_at IS NULL;
CREATE INDEX idx_ct_items_featured       ON ct_content_items(is_featured)
  WHERE is_featured = TRUE AND deleted_at IS NULL;
CREATE INDEX idx_ct_items_scheduled      ON ct_content_items(scheduled_at)
  WHERE scheduled_at IS NOT NULL AND status = 'DRAFT';
CREATE INDEX idx_ct_translations_lookup  ON ct_translations(entity_type, entity_id, locale);
CREATE INDEX idx_ct_media_transcode      ON ct_media_assets(transcode_status) WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_categories_parent    ON ct_categories(parent_id) WHERE deleted_at IS NULL;
```

---

## BC03: Engagement (Community) — `eg_*`

> **تذكير مُقفل:** لا progress tracking، لا bookmarks، لا favorites — Charter §3.2.

```sql
-- Migration: 020_engagement_types.sql

CREATE TYPE eg_moderation_status AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'FLAGGED');

-- Migration: 021_engagement_comments.sql

CREATE TABLE eg_comments (
  id            UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  content_id    UUID                 NOT NULL,   -- Cross-BC: ct_content_items.id — بدون FK
  user_id       UUID                 NOT NULL REFERENCES id_users(id),
  parent_id     UUID                 REFERENCES eg_comments(id),
  body          TEXT                 NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  upvotes_count INTEGER              NOT NULL DEFAULT 0 CHECK (upvotes_count >= 0),
  status        eg_moderation_status NOT NULL DEFAULT 'PENDING',
  moderated_by  UUID                 REFERENCES id_users(id),
  moderated_at  TIMESTAMPTZ,
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_eg_comments_moderation
    CHECK (status = 'PENDING' OR moderated_by IS NOT NULL)
);

CREATE TABLE eg_comment_votes (
  user_id    UUID        NOT NULL REFERENCES id_users(id),
  comment_id UUID        NOT NULL REFERENCES eg_comments(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, comment_id)
);

-- Migration: 022_engagement_qa.sql

CREATE TABLE eg_questions (
  id            UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  content_id    UUID,                -- Cross-BC — اختياري
  user_id       UUID                 NOT NULL REFERENCES id_users(id),
  title         VARCHAR(500)         NOT NULL CHECK (char_length(title) BETWEEN 5 AND 500),
  body          TEXT                 CHECK (body IS NULL OR char_length(body) <= 5000),
  status        eg_moderation_status NOT NULL DEFAULT 'PENDING',
  is_answered   BOOLEAN              NOT NULL DEFAULT FALSE,
  moderated_by  UUID                 REFERENCES id_users(id),  -- added in 043_engagement_questions_moderation_audit.sql
  moderated_at  TIMESTAMPTZ,                                   -- added in 043_engagement_questions_moderation_audit.sql
  deleted_at    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_eg_questions_moderation                       -- added in 043_engagement_questions_moderation_audit.sql
    CHECK (status = 'PENDING' OR moderated_by IS NOT NULL)
);

CREATE TABLE eg_answers (
  id               UUID                 PRIMARY KEY DEFAULT uuid_generate_v7(),
  question_id      UUID                 NOT NULL REFERENCES eg_questions(id) ON DELETE CASCADE,
  user_id          UUID                 NOT NULL REFERENCES id_users(id),
  body             TEXT                 NOT NULL CHECK (char_length(body) BETWEEN 1 AND 10000),
  is_accepted      BOOLEAN              NOT NULL DEFAULT FALSE,
  answered_by_role VARCHAR(50)          NOT NULL DEFAULT 'User',
  status           eg_moderation_status NOT NULL DEFAULT 'PENDING',
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ          NOT NULL DEFAULT NOW()
);
```

**Indexes — BC03:**

```sql
CREATE INDEX idx_eg_comments_content_approved ON eg_comments(content_id, created_at DESC)
  WHERE status = 'APPROVED' AND deleted_at IS NULL;
CREATE INDEX idx_eg_comments_pending          ON eg_comments(status, created_at) WHERE status = 'PENDING';
CREATE INDEX idx_eg_comments_user             ON eg_comments(user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_eg_comments_parent           ON eg_comments(parent_id)
  WHERE parent_id IS NOT NULL AND deleted_at IS NULL;
CREATE INDEX idx_eg_questions_content         ON eg_questions(content_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_eg_questions_pending         ON eg_questions(status) WHERE status = 'PENDING' AND deleted_at IS NULL;
CREATE INDEX idx_eg_answers_question          ON eg_answers(question_id) WHERE deleted_at IS NULL;
```

---

## BC04: Notifications — `nt_*`

```sql
-- Migration: 030_notifications_types.sql

CREATE TYPE nt_channel AS ENUM ('FCM_PUSH', 'EMAIL', 'SMS', 'IN_APP');
CREATE TYPE nt_status  AS ENUM ('QUEUED', 'SENT', 'FAILED', 'READ');

-- Migration: 031_notifications_devices.sql

CREATE TABLE nt_user_devices (
  id           UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id      UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  fcm_token    TEXT        NOT NULL,
  device_name  VARCHAR(200),
  platform     VARCHAR(10) NOT NULL CHECK (platform IN ('android', 'ios')),
  is_active    BOOLEAN     NOT NULL DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, fcm_token)
);

-- Migration: 032_notifications_preferences.sql

CREATE TABLE nt_notification_preferences (
  user_id    UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  channel    nt_channel  NOT NULL,
  category   VARCHAR(50) NOT NULL,
  is_enabled BOOLEAN     NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, channel, category)
);

-- Migration: 033_notifications_log.sql

CREATE TABLE nt_notifications (
  id         UUID        PRIMARY KEY DEFAULT uuid_generate_v7(),
  user_id    UUID        NOT NULL REFERENCES id_users(id) ON DELETE CASCADE,
  channel    nt_channel  NOT NULL,
  category   VARCHAR(50) NOT NULL,
  title      VARCHAR(255),
  body       TEXT        NOT NULL,
  data       JSONB,
  status     nt_status   NOT NULL DEFAULT 'QUEUED',
  sent_at    TIMESTAMPTZ,
  read_at    TIMESTAMPTZ,
  error_msg  TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_nt_sent  CHECK (status != 'SENT' OR sent_at IS NOT NULL),
  CONSTRAINT chk_nt_read  CHECK (status != 'READ' OR read_at IS NOT NULL)
);

CREATE TABLE nt_announcements (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  title      VARCHAR(255) NOT NULL,
  body       TEXT         NOT NULL,
  target     VARCHAR(50)  NOT NULL DEFAULT 'ALL',
  sent_at    TIMESTAMPTZ,
  created_by UUID         NOT NULL REFERENCES id_users(id),
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
```

**Indexes — BC04:**

```sql
CREATE INDEX idx_nt_notifications_user_unread ON nt_notifications(user_id, created_at DESC)
  WHERE status IN ('QUEUED', 'SENT');
CREATE INDEX idx_nt_notifications_queued      ON nt_notifications(status, created_at) WHERE status = 'QUEUED';
CREATE INDEX idx_nt_devices_user_active       ON nt_user_devices(user_id) WHERE is_active = TRUE;
```

---

## BC05: Administration, Analytics & Ops — `ad_*`

```sql
-- Migration: 040_admin_audit_log.sql

CREATE TABLE ad_audit_log (
  -- لا soft delete — audit log لا يُحذف أبداً. Retention: 7 سنوات.
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_id    UUID         NOT NULL REFERENCES id_users(id),
  actor_role  VARCHAR(50)  NOT NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Migration: 041_admin_system_config.sql

CREATE TABLE ad_system_config (
  key         VARCHAR(100) PRIMARY KEY,
  value       JSONB        NOT NULL,
  description TEXT,
  updated_by  UUID         REFERENCES id_users(id),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

INSERT INTO ad_system_config (key, value, description) VALUES
  ('maintenance_mode',             'false', 'إذا true: API يُعيد 503 لغير-admin'),
  ('max_upload_size_mb',           '500',   'الحجم الأقصى لرفع الملفات بالميغابايت'),
  ('feature_flag.qa',              'true',  'تفعيل نظام الأسئلة والأجوبة'),
  -- نافذة تعديل التعليق — قابلة للتغيير من لوحة التحكم دون deployment جديد
  -- يُطبَّق في طبقة التطبيق عند PATCH /api/v1/comments/:id (راجع API-003)
  ('comment.edit_window_minutes',  '15',    'النافذة الزمنية بالدقائق التي يُسمح فيها لصاحب التعليق بتعديله');

-- Migration: 042_admin_analytics.sql

CREATE TABLE ad_analytics_daily (
  -- ═══════════════════════════════════════════════════════════════
  -- CORRECTION (2026-08-09): PRIMARY KEY كان يستخدم COALESCE()
  -- لا يقبل PostgreSQL تعابير في PRIMARY KEY مباشرة.
  -- الحل: dimension_key وdimension_value = NOT NULL DEFAULT ''
  -- '' تعني "بلا dimension" (بديل صريح عن NULL)
  -- PRIMARY KEY على الأعمدة الأربعة مباشرة — بلا تعابير
  -- ═══════════════════════════════════════════════════════════════
  date            DATE         NOT NULL,
  metric          VARCHAR(100) NOT NULL,
  dimension_key   VARCHAR(100) NOT NULL DEFAULT '',
  dimension_value VARCHAR(200) NOT NULL DEFAULT '',
  value           BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (date, metric, dimension_key, dimension_value)
);
```

**Indexes — BC05:**

```sql
CREATE INDEX idx_ad_audit_actor        ON ad_audit_log(actor_id, created_at DESC);
CREATE INDEX idx_ad_audit_entity       ON ad_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_ad_audit_action       ON ad_audit_log(action, created_at DESC);
CREATE INDEX idx_ad_analytics_date     ON ad_analytics_daily(date DESC, metric);
```

---

## قواعد Cross-Boundary References

```
داخل نفس الـ BC:   FOREIGN KEY مباشرة ✅
عبر الـ BC:        UUID reference بدون FK — تحقق على مستوى التطبيق ✅
عبر الـ BC:        Raw SQL JOIN — ممنوع ❌
عبر الـ BC:        Direct Repository import — ممنوع ❌
```

| الجدول | العمود | يشير لـ | سبب غياب FK |
|--------|--------|---------|-------------|
| `eg_comments` | `content_id` | `ct_content_items.id` | Cross-BC |
| `eg_questions` | `content_id` | `ct_content_items.id` | Cross-BC |
| `ad_audit_log` | `entity_id` | أي جدول في أي BC | Polymorphic |

---

## ترتيب Migration الكامل

```
000_bootstrap
001_identity_users
002_identity_roles
003_identity_auth_tokens
004_identity_oauth_otp
010_content_types
011_content_taxonomy
012_content_media
013_content_items
014_content_translations
020_engagement_types
021_engagement_comments
022_engagement_qa
030_notifications_types
031_notifications_devices
032_notifications_preferences
033_notifications_log
040_admin_audit_log
041_admin_system_config
042_admin_analytics
```

---

## CHANGE LOG

| الإصدار | التاريخ | التغيير |
|---------|---------|---------|
| 1.1.0 | 2026-08-10 | **3 توضيحات دقيقة:** (1) حذف extension `unaccent` — YAGNI، Phase 1 يستخدم ILIKE فقط (DB-002)، مُرجأ لحين الحاجة. (2) إزالة DO block — الفحص بعد `CREATE EXTENSION IF NOT EXISTS` غير قابل للوصول عملياً؛ استُبدل بتعليق توضيحي. (3) توثيق نطاق `cdn_url` في `ct_media_assets` — أصول عامة فقط (thumbnails)؛ المحتوى المحمي يستخدم Presigned URLs (API-002). |
| 1.0.0 | 2026-08-09 | الإصدار الأول المعتمد. تصحيح `ad_analytics_daily` PRIMARY KEY (إزالة COALESCE، dimension_key وdimension_value = NOT NULL DEFAULT ''). حذف lft/rgt/depth من ct_categories (DB-003). توثيق DB-001 (pg_uuidv7) كقرار رسمي. |
