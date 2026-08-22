import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * AnalyticsService — BC05
 *
 * All queries hit source tables directly (id_users, ct_content_items,
 * ct_translations) via DataSource.query() — no Cross-BC repository imports
 * per ADR-002. The ad_analytics_daily table is left empty in Phase 1 (YAGNI).
 *
 * topContent: uses ct_content_items.view_count incremented fire-and-forget
 * in ContentController.getContentBySlug() (verified in BC02 codebase).
 *
 * Translation table: ct_translations (verified from TranslationOrmEntity
 * @Entity name — NOT 'ct_content_translations').
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly dataSource: DataSource) {}

  async overview() {
    const [
      dauRes,
      wauRes,
      mauRes,
      newUsersRes,
      authBreakdownRes,
      topContentRes,
    ] = await Promise.all([
      // DAU — users created today (proxy: no session/activity table in Phase 1)
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count
         FROM id_users
         WHERE DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
           AND deleted_at IS NULL`,
      ),

      // WAU — users created in last 7 days
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count
         FROM id_users
         WHERE created_at >= NOW() - INTERVAL '7 days'
           AND deleted_at IS NULL`,
      ),

      // MAU — users created in last 30 days
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count
         FROM id_users
         WHERE created_at >= NOW() - INTERVAL '30 days'
           AND deleted_at IS NULL`,
      ),

      // New users today
      this.dataSource.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count
         FROM id_users
         WHERE DATE(created_at AT TIME ZONE 'UTC') = CURRENT_DATE
           AND deleted_at IS NULL`,
      ),

      // authMethodBreakdown — inferred from email/phone column presence
      this.dataSource.query<{ method: string; count: string }[]>(`
        SELECT
          CASE
            WHEN email IS NOT NULL AND phone_e164 IS NULL THEN 'email'
            WHEN phone_e164 IS NOT NULL AND email IS NULL THEN 'phone'
            WHEN email IS NOT NULL AND phone_e164 IS NOT NULL THEN 'both'
            ELSE 'unknown'
          END AS method,
          COUNT(*)::text AS count
        FROM id_users
        WHERE deleted_at IS NULL
        GROUP BY 1
        ORDER BY count DESC
      `),

      // topContent — view_count is incremented in getContentBySlug() fire-and-forget
      // Table: ct_translations (NOT ct_content_translations — verified from ORM entity)
      this.dataSource.query<{
        id: string;
        type: string;
        view_count: string;
        title: string;
      }[]>(`
        SELECT
          ci.id,
          ci.type,
          ci.view_count::text,
          COALESCE(
            (
              SELECT t.content
              FROM ct_translations t
              WHERE t.entity_type = 'content_item'
                AND t.entity_id = ci.id
                AND t.field_name = 'title'
                AND t.locale = 'ar'
              LIMIT 1
            ),
            ci.slug
          ) AS title
        FROM ct_content_items ci
        WHERE ci.status = 'PUBLISHED'
          AND ci.deleted_at IS NULL
        ORDER BY ci.view_count DESC
        LIMIT 5
      `),
    ]);

    const authMethodBreakdown: Record<string, number> = {};
    for (const row of authBreakdownRes) {
      authMethodBreakdown[row.method] = parseInt(row.count, 10);
    }

    return {
      data: {
        dau: parseInt(dauRes[0].count, 10),
        wau: parseInt(wauRes[0].count, 10),
        mau: parseInt(mauRes[0].count, 10),
        newUsersToday: parseInt(newUsersRes[0].count, 10),
        authMethodBreakdown,
        topContent: topContentRes.map((r) => ({
          id: r.id,
          title: r.title,
          type: r.type,
          viewCount: parseInt(r.view_count, 10),
        })),
      },
    };
  }

  async contentAnalytics(query: { type?: string; from?: string; to?: string }) {
    const conditions: string[] = ['ci.deleted_at IS NULL'];
    const params: unknown[] = [];

    if (query.type) {
      params.push(query.type);
      conditions.push(`ci.type = $${params.length}`);
    }
    if (query.from) {
      params.push(query.from);
      conditions.push(`ci.published_at >= $${params.length}`);
    }
    if (query.to) {
      params.push(query.to);
      conditions.push(`ci.published_at <= $${params.length}`);
    }

    const where = conditions.join(' AND ');
    const sql = `
      SELECT ci.type, COUNT(*)::text AS count
      FROM ct_content_items ci
      WHERE ${where}
      GROUP BY ci.type
      ORDER BY count DESC
    `;

    const rows = await this.dataSource.query<{ type: string; count: string }[]>(sql, params);
    return {
      data: rows.map((r) => ({ type: r.type, count: parseInt(r.count, 10) })),
    };
  }
}
