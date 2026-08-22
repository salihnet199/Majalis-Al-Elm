import {
  IsUUID, IsOptional, IsBoolean, IsInt, IsISO8601,
  IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TranslationEntryDto } from './translation.dto';

/** slug is immutable after creation (API-003: slug = canonical URL) */
export class UpdateContentItemDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  authorId?: string | null;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  categoryId?: string | null;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  mediaAssetId?: string | null;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ required: false })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiProperty({ required: false, format: 'date-time', nullable: true })
  @IsISO8601()
  @IsOptional()
  scheduledAt?: string | null;

  @ApiProperty({ required: false, type: [TranslationEntryDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => TranslationEntryDto)
  translations?: TranslationEntryDto[];

  @ApiProperty({ required: false, type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  tagIds?: string[];
}
