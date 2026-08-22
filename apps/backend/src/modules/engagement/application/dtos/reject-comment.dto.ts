import { IsString, IsOptional } from 'class-validator';

/**
 * RejectCommentDto — body for POST /admin/moderation/comments/:id/reject
 *
 * YAGNI-DECISION (2026-08-15): `reason` is accepted from the UI for display
 * purposes but is NOT persisted to the database. DB-SCHEMA.md §BC03 defines
 * no `rejection_reason` column in `eg_comments`. If admin audit trail of
 * rejection reasons is needed in the future, add a migration:
 *   ALTER TABLE eg_comments ADD COLUMN rejection_reason TEXT NULL;
 * No changes to this service layer are required at that point.
 */
export class RejectCommentDto {
  @IsOptional()
  @IsString()
  reason?: string;
}
