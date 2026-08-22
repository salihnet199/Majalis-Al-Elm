-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 040 — BC05: Admin Audit Log
-- DB-SCHEMA.md v1.1.0 §BC05 — معتمد رسمياً
-- Table: ad_audit_log
--
-- IMMUTABLE by design — rows are NEVER deleted or updated.
-- Retention policy: 7 years (enforced at storage/archive layer).
--
-- ip_address: نوع INET كما في DB-SCHEMA.md
--   الملاحظة التقنية: AuditLogService يُحوِّل قيمة header الخام إلى
--   صيغة IP نظيفة قبل الحفظ (inet_normalize في TypeScript).
--   القيمة NULL مقبولة إن تعذَّر استخلاص عنوان IP صالح.
--
-- actor_id: UUID NOT NULL بلا REFERENCES id_users(id) — Cross-BC reference.
--   DB-SCHEMA.md يذكر FK في تعريف الجدول، لكن ADR-002 يمنع FK عبر
--   حدود الـ Bounded Contexts (ad_* → id_*). القرار الفعلي هو UUID-only
--   reference كما هو مُطبَّق هنا. الـ actor name يُسترجع بـ raw SQL JOIN
--   في AuditLogService.list() عند الحاجة.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE ad_audit_log (
  id          UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  actor_id    UUID         NOT NULL,          -- Cross-BC UUID ref: ADR-002 — no FK across BC boundaries
  actor_role  VARCHAR(50)  NOT NULL,
  action      VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id   UUID,
  old_value   JSONB,
  new_value   JSONB,
  ip_address  INET,                           -- INET: يطابق DB-SCHEMA.md — يُخزَّن بعد التطبيع في layer التطبيق
  user_agent  TEXT,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ad_audit_actor  ON ad_audit_log(actor_id, created_at DESC);
CREATE INDEX idx_ad_audit_entity ON ad_audit_log(entity_type, entity_id, created_at DESC);
CREATE INDEX idx_ad_audit_action ON ad_audit_log(action, created_at DESC);
