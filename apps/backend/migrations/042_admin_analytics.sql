-- ─────────────────────────────────────────────────────────────────────────────
-- Migration 042 — BC05: Analytics Daily Aggregates
-- DB-SCHEMA.md v1.1.0 §BC05
-- Table: ad_analytics_daily
--
-- CORRECTION (2026-08-09 per DB-SCHEMA.md §CHANGE LOG):
-- PRIMARY KEY avoids COALESCE() expressions — PostgreSQL rejects expressions
-- in PRIMARY KEY definitions. dimension_key and dimension_value use
-- NOT NULL DEFAULT '' — empty string means "no dimension" (explicit proxy for NULL).
--
-- Phase 1: table is created but left EMPTY (YAGNI — AnalyticsService
-- queries source tables directly in Phase 1).
-- Phase 2: nightly aggregation job will populate this table.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE ad_analytics_daily (
  date            DATE         NOT NULL,
  metric          VARCHAR(100) NOT NULL,
  dimension_key   VARCHAR(100) NOT NULL DEFAULT '',
  dimension_value VARCHAR(200) NOT NULL DEFAULT '',
  value           BIGINT       NOT NULL DEFAULT 0,
  PRIMARY KEY (date, metric, dimension_key, dimension_value)
);

CREATE INDEX idx_ad_analytics_date ON ad_analytics_daily(date DESC, metric);
