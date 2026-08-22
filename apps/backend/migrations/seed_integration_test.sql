-- Seed Integration Test Data (Idempotent: ON CONFLICT DO NOTHING)

-- 1. Test Seed User
INSERT INTO id_users (id, full_name, email, password_hash, locale)
VALUES (
  '018d0000-0000-7000-8000-000000000001'::uuid,
  'الشيخ الكاتب التجريبي',
  'seed_author@test.majaliselm.local',
  '$2b$10$F4AFFIeofhqr2Rbww1zWOe5Xmxf7INQNKnyFN7vn3Pq/eD8aj5yae',
  'ar'
) ON CONFLICT (id) DO NOTHING;

-- Assign Admin/Editor Role
INSERT INTO id_user_roles (user_id, role_id)
SELECT '018d0000-0000-7000-8000-000000000001'::uuid, id
FROM id_roles WHERE name = 'Editor'
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 2. Test Categories
INSERT INTO ct_categories (id, slug, sort_order)
VALUES 
  ('018d0000-0000-7000-8000-000000000010'::uuid, 'aqeedah', 1),
  ('018d0000-0000-7000-8000-000000000011'::uuid, 'fiqh', 2),
  ('018d0000-0000-7000-8000-000000000012'::uuid, 'tafseer', 3)
ON CONFLICT (slug) DO NOTHING;

-- Category Translations
INSERT INTO ct_translations (entity_type, entity_id, locale, field_name, content, created_by)
VALUES
  ('category', '018d0000-0000-7000-8000-000000000010'::uuid, 'ar', 'name', 'العقيدة والتوحيد', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('category', '018d0000-0000-7000-8000-000000000011'::uuid, 'ar', 'name', 'الفقه وأصوله', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('category', '018d0000-0000-7000-8000-000000000012'::uuid, 'ar', 'name', 'التفسير وعلوم القرآن', '018d0000-0000-7000-8000-000000000001'::uuid)
ON CONFLICT (entity_type, entity_id, locale, field_name) DO NOTHING;

-- 3. Test Tags
INSERT INTO ct_tags (id, slug)
VALUES
  ('018d0000-0000-7000-8000-000000000020'::uuid, 'tawheed'),
  ('018d0000-0000-7000-8000-000000000021'::uuid, 'iman'),
  ('018d0000-0000-7000-8000-000000000022'::uuid, 'salah')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ct_translations (entity_type, entity_id, locale, field_name, content, created_by)
VALUES
  ('tag', '018d0000-0000-7000-8000-000000000020'::uuid, 'ar', 'name', 'التوحيد', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('tag', '018d0000-0000-7000-8000-000000000021'::uuid, 'ar', 'name', 'الإيمان', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('tag', '018d0000-0000-7000-8000-000000000022'::uuid, 'ar', 'name', 'الصلاة', '018d0000-0000-7000-8000-000000000001'::uuid)
ON CONFLICT (entity_type, entity_id, locale, field_name) DO NOTHING;

-- 4. Test Author
INSERT INTO ct_authors (id, slug, sort_order)
VALUES ('018d0000-0000-7000-8000-000000000030'::uuid, 'sheikh-salih-alfawzan', 1)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO ct_translations (entity_type, entity_id, locale, field_name, content, created_by)
VALUES
  ('author', '018d0000-0000-7000-8000-000000000030'::uuid, 'ar', 'name', 'فضيلة الشيخ صالح الفوزان', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('author', '018d0000-0000-7000-8000-000000000030'::uuid, 'ar', 'bio', 'عضو هيئة كبار العلماء', '018d0000-0000-7000-8000-000000000001'::uuid)
ON CONFLICT (entity_type, entity_id, locale, field_name) DO NOTHING;

-- 5. Test Media Assets
INSERT INTO ct_media_assets (id, original_name, storage_key, mime_type, size_bytes, duration_ms, page_count, cdn_url, uploaded_by)
VALUES
  ('018d0000-0000-7000-8000-000000000040'::uuid, 'intro_tawheed.mp3', 'media/audio/intro_tawheed.mp3', 'audio/mpeg', 15485760, 1800000, NULL, 'https://cdn.majaliselm.local/media/audio/intro_tawheed.mp3', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('018d0000-0000-7000-8000-000000000041'::uuid, 'kitab_at_tawheed.pdf', 'media/pdf/kitab_at_tawheed.pdf', 'application/pdf', 5242880, NULL, 120, 'https://cdn.majaliselm.local/media/pdf/kitab_at_tawheed.pdf', '018d0000-0000-7000-8000-000000000001'::uuid)
ON CONFLICT (storage_key) DO NOTHING;

-- 6. Test Content Items
INSERT INTO ct_content_items (id, slug, type, status, primary_locale, author_id, category_id, media_asset_id, published_at, created_by)
VALUES
  (
    '018d0000-0000-7000-8000-000000000050'::uuid,
    'audio-lecture-intro-tawheed',
    'AUDIO',
    'PUBLISHED',
    'ar',
    '018d0000-0000-7000-8000-000000000030'::uuid,
    '018d0000-0000-7000-8000-000000000010'::uuid,
    '018d0000-0000-7000-8000-000000000040'::uuid,
    NOW(),
    '018d0000-0000-7000-8000-000000000001'::uuid
  ),
  (
    '018d0000-0000-7000-8000-000000000051'::uuid,
    'book-kitab-at-tawheed',
    'PDF',
    'PUBLISHED',
    'ar',
    '018d0000-0000-7000-8000-000000000030'::uuid,
    '018d0000-0000-7000-8000-000000000010'::uuid,
    '018d0000-0000-7000-8000-000000000041'::uuid,
    NOW(),
    '018d0000-0000-7000-8000-000000000001'::uuid
  ),
  (
    '018d0000-0000-7000-8000-000000000052'::uuid,
    'article-virtues-of-knowledge',
    'TEXT',
    'PUBLISHED',
    'ar',
    '018d0000-0000-7000-8000-000000000030'::uuid,
    '018d0000-0000-7000-8000-000000000011'::uuid,
    NULL,
    NOW(),
    '018d0000-0000-7000-8000-000000000001'::uuid
  )
ON CONFLICT (slug) DO NOTHING;

-- Content Translations
INSERT INTO ct_translations (entity_type, entity_id, locale, field_name, content, created_by)
VALUES
  ('content_item', '018d0000-0000-7000-8000-000000000050'::uuid, 'ar', 'title', 'مقدمة في توحيد العبادة', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('content_item', '018d0000-0000-7000-8000-000000000050'::uuid, 'ar', 'description', 'شرح تفصيلي لمعنى التوحيد وأقسامه', '018d0000-0000-7000-8000-000000000001'::uuid),
  
  ('content_item', '018d0000-0000-7000-8000-000000000051'::uuid, 'ar', 'title', 'كتاب التوحيد الذي هو حق الله على العبيد', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('content_item', '018d0000-0000-7000-8000-000000000051'::uuid, 'ar', 'description', 'متن كتاب التوحيد للإمام محمد بن عبد الوهاب', '018d0000-0000-7000-8000-000000000001'::uuid),

  ('content_item', '018d0000-0000-7000-8000-000000000052'::uuid, 'ar', 'title', 'فضل طلب العلم الشرعي', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('content_item', '018d0000-0000-7000-8000-000000000052'::uuid, 'ar', 'description', 'مقالة مختصرة حول فضل العلم وأهله', '018d0000-0000-7000-8000-000000000001'::uuid),
  ('content_item', '018d0000-0000-7000-8000-000000000052'::uuid, 'ar', 'body', 'إن طلب العلم من أجلّ القربات وأعظم الطاعات...', '018d0000-0000-7000-8000-000000000001'::uuid)
ON CONFLICT (entity_type, entity_id, locale, field_name) DO NOTHING;
