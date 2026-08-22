-- Migration: 011_content_taxonomy.sql
-- BC02: Authors, Categories (Adjacency List — DB-003), Tags
-- DB-SCHEMA.md v1.1.0 §BC02

-- ct_authors: independent entity — NO FK to id_users (YAGNI per decision 2)
CREATE TABLE ct_authors (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       VARCHAR(150) NOT NULL UNIQUE,
  avatar_url TEXT,
  sort_order INTEGER      NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ct_categories: Adjacency List — DB-003 (2026-08-09): parent_id only — NO lft/rgt/depth
CREATE TABLE ct_categories (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       VARCHAR(100) NOT NULL UNIQUE,
  parent_id  UUID         REFERENCES ct_categories(id),
  sort_order INTEGER      NOT NULL DEFAULT 0,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ct_tags: flat tag list
CREATE TABLE ct_tags (
  id         UUID         PRIMARY KEY DEFAULT uuid_generate_v7(),
  slug       VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_ct_categories_parent ON ct_categories(parent_id) WHERE deleted_at IS NULL;
CREATE INDEX idx_ct_authors_slug      ON ct_authors(slug)          WHERE deleted_at IS NULL;
