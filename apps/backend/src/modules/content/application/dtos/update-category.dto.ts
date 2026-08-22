import {
  IsUUID, IsOptional, IsInt,
  IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CategoryTranslationDto } from './translation.dto';

export class UpdateCategoryDto {
  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  parentId?: string | null;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ required: false, type: [CategoryTranslationDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations?: CategoryTranslationDto[];
}
