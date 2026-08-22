import { IsNotEmpty } from 'class-validator';

export class UpdateSystemConfigDto {
  /**
   * The new JSONB value for the config key.
   * Examples:
   *   { "value": true }                  → maintenance_mode
   *   { "value": 30 }                    → comment.edit_window_minutes
   *   { "value": 250 }                   → max_upload_size_mb
   */
  @IsNotEmpty()
  value!: unknown;
}
