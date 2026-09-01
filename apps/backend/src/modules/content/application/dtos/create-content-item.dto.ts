import {
  IsString, IsEnum, IsIn, IsUUID, IsOptional,
  IsBoolean, IsInt, IsISO8601, IsArray,
  ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TranslationEntryDto, SUPPORTED_LOCALES } from './translation.dto';

export const CONTENT_TYPES = ['AUDIO', 'PDF', 'TEXT', 'IMAGE'] as const;

export class CreateContentItemDto {
  @ApiProperty({ example: 'lecture-aqeedah-001' })
  @IsString()
  slug!: string;

  @ApiProperty({ enum: CONTENT_TYPES })
  @IsEnum(CONTENT_TYPES)
  type!: string;

  @ApiProperty({ enum: SUPPORTED_LOCALES, default: 'ar' })
  @IsIn(SUPPORTED_LOCALES)
  @IsOptional()
  primaryLocale?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  authorId?: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  /** UUID of existing ct_media_assets record (entered manually — Presigned upload in Phase 3) */
  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  mediaAssetId?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ required: false, default: false })
  @IsBoolean()
  @IsOptional()
  isFeatured?: boolean;

  @ApiProperty({ required: false, format: 'date-time' })
  @IsISO8601()
  @IsOptional()
  scheduledAt?: string;

  @ApiProperty({ type: [TranslationEntryDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TranslationEntryDto)
  translations!: TranslationEntryDto[];

  @ApiProperty({ required: false, description: 'Tag IDs to associate', type: [String] })
  @IsArray()
  @IsUUID('all', { each: true })
  @IsOptional()
  tagIds?: string[];
}
