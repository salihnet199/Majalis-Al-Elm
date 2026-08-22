import { IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class InitiateMediaUploadDto {
  @ApiProperty({ example: 'lecture.mp3' })
  @IsString()
  fileName!: string;

  @ApiProperty({ example: 'audio/mpeg' })
  @IsString()
  mimeType!: string;

  @ApiProperty({ example: 52428800 })
  @IsInt()
  @Min(1)
  sizeBytes!: number;
}
