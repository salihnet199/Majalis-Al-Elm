import {
  IsString, IsUUID, IsOptional, IsInt,
  IsArray, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { CategoryTranslationDto } from './translation.dto';

export class CreateCategoryDto {
  @ApiProperty({ example: 'tafseer' })
  @IsString()
  slug!: string;

  @ApiProperty({ required: false, format: 'uuid' })
  @IsUUID()
  @IsOptional()
  parentId?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ type: [CategoryTranslationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CategoryTranslationDto)
  translations!: CategoryTranslationDto[];
}
