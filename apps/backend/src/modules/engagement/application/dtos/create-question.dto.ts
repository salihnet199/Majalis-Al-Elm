import { IsString, MinLength, MaxLength, IsOptional, IsUUID } from 'class-validator';

export class CreateQuestionDto {
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  title!: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;

  /**
   * content_id: Cross-BC reference to ct_content_items.id.
   * Optional — a question may be standalone (not linked to any content item).
   * No FK in DB (DB-SCHEMA §Cross-BC). Existence validated at application layer.
   */
  @IsOptional()
  @IsUUID()
  contentId?: string;
}
