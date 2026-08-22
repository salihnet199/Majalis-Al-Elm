import {
  IsString, IsOptional, IsInt, IsUrl,
  IsArray, ValidateNested, ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { AuthorTranslationDto } from './translation.dto';

export class CreateAuthorDto {
  @ApiProperty({ example: 'sheikh-ahmad' })
  @IsString()
  slug!: string;

  @ApiProperty({ required: false, example: 'https://cdn.majlis-alim.app/avatars/sheikh.jpg' })
  @IsUrl()
  @IsOptional()
  avatarUrl?: string;

  @ApiProperty({ required: false, default: 0 })
  @IsInt()
  @IsOptional()
  sortOrder?: number;

  @ApiProperty({ type: [AuthorTranslationDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AuthorTranslationDto)
  translations!: AuthorTranslationDto[];
}
