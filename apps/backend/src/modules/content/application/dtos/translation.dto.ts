import { IsString, IsIn, IsOptional, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export const SUPPORTED_LOCALES = ['ar', 'en', 'fr', 'ur', 'ms'] as const;
export type SupportedLocale = typeof SUPPORTED_LOCALES[number];

export class TranslationEntryDto {
  @ApiProperty({ enum: SUPPORTED_LOCALES, example: 'ar' })
  @IsIn(SUPPORTED_LOCALES)
  locale!: SupportedLocale;

  @ApiProperty({ example: 'محاضرة في العقيدة' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  title!: string;

  @ApiProperty({ required: false, example: 'شرح مفصّل' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /** Body: used only for TEXT type content — stored in ct_translations.content */
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  body?: string;
}

export class CategoryTranslationDto {
  @ApiProperty({ enum: SUPPORTED_LOCALES })
  @IsIn(SUPPORTED_LOCALES)
  locale!: SupportedLocale;

  @ApiProperty({ example: 'العقيدة' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}

export class AuthorTranslationDto {
  @ApiProperty({ enum: SUPPORTED_LOCALES })
  @IsIn(SUPPORTED_LOCALES)
  locale!: SupportedLocale;

  @ApiProperty({ example: 'د. أحمد' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  bio?: string;
}

export class TagTranslationDto {
  @ApiProperty({ enum: SUPPORTED_LOCALES })
  @IsIn(SUPPORTED_LOCALES)
  locale!: SupportedLocale;

  @ApiProperty({ example: 'التوحيد' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;
}
