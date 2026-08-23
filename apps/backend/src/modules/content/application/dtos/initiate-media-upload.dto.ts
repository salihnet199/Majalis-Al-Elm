import { IsIn, IsInt, IsString, Matches, MaxLength, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import {
  ABSOLUTE_MAX_UPLOAD_BYTES,
  ALLOWED_MIME_TYPES,
} from '../../domain/media-upload.policy';

/**
 * Body of POST /admin/media/upload/initiate.
 *
 * Every field here is a CLAIM by the client, and each one is checked again
 * later against something the client does not control:
 *   • `mimeType` is pinned into the presigned signature, so the stored object
 *     cannot have a different content type than the one approved here.
 *   • `sizeBytes` is signed as Content-Length and re-read from storage with
 *     headObject at `complete`.
 *   • `sha256` is sent to storage as x-amz-checksum-sha256, which storage
 *     recomputes over the body it receives.
 *
 * The previous DTO validated `mimeType` as a bare `@IsString()` and `sizeBytes`
 * with no upper bound — the media bucket would have accepted `text/html` and a
 * file of any size.
 */
export class InitiateMediaUploadDto {
  @ApiProperty({ example: 'lecture-01.mp3', maxLength: 500 })
  @IsString()
  @MaxLength(500)
  fileName!: string;

  @ApiProperty({
    example: 'audio/mpeg',
    enum: ALLOWED_MIME_TYPES,
    description:
      'Closed whitelist (Charter §3.2 — no video). Per-type size caps: audio 300MB, PDF 100MB, image 10MB.',
  })
  @IsIn(ALLOWED_MIME_TYPES, {
    message: `mimeType must be one of: ${ALLOWED_MIME_TYPES.join(', ')}`,
  })
  mimeType!: string;

  @ApiProperty({
    example: 52428800,
    description: 'Exact byte length. Signed into the upload URL, then verified against storage.',
    maximum: ABSOLUTE_MAX_UPLOAD_BYTES,
  })
  @IsInt()
  @Min(1)
  @Max(ABSOLUTE_MAX_UPLOAD_BYTES)
  sizeBytes!: number;

  @ApiProperty({
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description:
      'Lowercase hex SHA-256 of the file. Becomes the object key and is enforced by storage.',
  })
  @Matches(/^[0-9a-f]{64}$/, {
    message: 'sha256 must be a 64-character lowercase hexadecimal SHA-256 digest',
  })
  sha256!: string;
}
