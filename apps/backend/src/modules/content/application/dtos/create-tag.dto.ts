import {
  IsString, IsArray, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TagTranslationDto } from './translation.dto';

export class CreateTagDto {
  @ApiProperty({ example: 'tawheed' })
  @IsString()
  slug!: string;

  @ApiProperty({ type: [TagTranslationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TagTranslationDto)
  translations!: TagTranslationDto[];
}
