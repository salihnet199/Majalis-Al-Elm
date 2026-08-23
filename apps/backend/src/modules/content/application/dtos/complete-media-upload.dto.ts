import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** One finished part of a multipart upload, as reported by storage to the client. */
export class CompletedUploadPartDto {
  @ApiProperty({ example: 1, minimum: 1 })
  @IsInt()
  @Min(1)
  partNumber!: number;

  /**
   * The ETag storage returned in the response header for that part. The client
   * cannot invent it: CompleteMultipartUpload fails if any ETag does not match
   * what storage recorded for the part.
   */
  @ApiProperty({ example: '"9bb58f26192e4ba00f01e2e7b136bbd8"' })
  @IsString()
  etag!: string;
}

/**
 * Body of POST /admin/media/upload/complete.
 *
 * This endpoint does NOT take the client's word for anything. It calls
 * headObject and only marks the asset UPLOADED if storage confirms an object of
 * the expected size. `parts` is required for a multipart upload because storage
 * will not assemble the object without it.
 */
export class CompleteMediaUploadDto {
  @ApiProperty({ example: '018f1a2b-3c4d-7e5f-8a9b-0c1d2e3f4a5b' })
  @IsUUID()
  uploadId!: string;

  @ApiPropertyOptional({
    type: [CompletedUploadPartDto],
    description: 'Required for multipart uploads (files above 100MB); omit for single-part uploads.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10000) // S3 hard limit on parts per upload
  @ValidateNested({ each: true })
  @Type(() => CompletedUploadPartDto)
  parts?: CompletedUploadPartDto[];
}
