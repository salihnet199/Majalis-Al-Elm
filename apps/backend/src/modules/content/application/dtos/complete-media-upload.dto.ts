import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteMediaUploadDto {
  @ApiProperty({ format: 'uuid', example: '01920abc-0000-7000-8000-000000000001' })
  @IsUUID()
  uploadId!: string;
}
