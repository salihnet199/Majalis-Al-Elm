import {
  IsOptional, IsInt, IsUrl,
  IsArray, ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AuthorTranslationDto } from './translation.dto';

export class UpdateAuthorDto {
  @ApiProperty({ required: false, example: 'https://cdn.majlis-alim.app/avatars/sheikh.jpg' })
  @IsUrl()
  @IsOptional()
  avatarUrl?: string | null;

  @ApiProperty({ required: false })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ required: false, type: [AuthorTranslationDto] })
  @IsArray()
  @IsOptional()
  @ValidateNested({ each: true })
  @Type(() => AuthorTranslationDto)
  translations?: AuthorTranslationDto[];
}
