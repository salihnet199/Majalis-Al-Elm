import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { CompleteMediaUploadDto } from '../application/dtos/complete-media-upload.dto';
import { InitiateMediaUploadDto } from '../application/dtos/initiate-media-upload.dto';
import { MediaUploadService } from '../application/services/media-upload.service';
import {
  IMediaAssetRepository,
  MEDIA_ASSET_REPOSITORY,
} from '../domain/ports/media-asset.repository';
import { Roles } from './decorators/roles.decorator';
import { RolesGuard } from './guards/roles.guard';

/**
 * Admin media upload — ADR-013 Stage A, real presigned direct upload.
 *
 * ADR-013 §3 is absolute: media bytes never pass through NestJS. No route on
 * this controller accepts a file body; all three exchange JSON only. The bytes
 * go from the editor's browser straight to the object store over a URL signed
 * here.
 *
 * What this controller replaced (TECH-DEBT-014, POLICY-SEC-001):
 *   • `initiate` returned `presignedUrl: null` — there was no upload at all.
 *   • `initiate` fell back to a hard-coded UUID when the request had no
 *     authenticated user, attributing an upload to a fabricated identity.
 *   • `initiate` built the storage key from the client's filename.
 *   • `complete` called `markDone()` — reporting success, and claiming a
 *     finished transcode, without one byte having been verified.
 */
@ApiTags('Admin Media')
@Controller('admin/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Editor', 'Admin', 'SuperAdmin')
@ApiBearerAuth()
export class AdminMediaController {
  constructor(
    private readonly uploadService: MediaUploadService,
    @Inject(MEDIA_ASSET_REPOSITORY)
    private readonly mediaRepo: IMediaAssetRepository,
  ) {}

  @Post('upload/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Initiate media upload — returns a presigned URL for direct upload to storage',
    description:
      'Creates the asset row as PENDING_UPLOAD and returns either a single presigned PUT ' +
      '(files ≤100MB) or a multipart ticket with one URL per part. The returned headers are ' +
      'part of the signature and must be sent verbatim.',
  })
  @ApiResponse({ status: 200, description: 'Upload initiated; presigned URL issued' })
  @ApiResponse({ status: 422, description: 'MIME type not allowed, or file exceeds its type cap' })
  async initiateUpload(
    @Body() dto: InitiateMediaUploadDto,
    @Req() req: { user?: JwtPayload },
  ) {
    // JwtAuthGuard has already run, so this cannot normally be empty. It throws
    // rather than substituting a placeholder id: the previous
    // `req.user?.sub || '00000000-…'` attributed uploads to a user that does not
    // exist, which is both an audit-trail forgery and a foreign-key hazard
    // (ct_media_assets.uploaded_by REFERENCES id_users).
    const uploaderId = req.user?.sub;
    if (!uploaderId) {
      throw new UnauthorizedException({
        code: 'UNAUTHENTICATED',
        message: 'An authenticated user is required to upload media',
      });
    }

    const data = await this.uploadService.initiate(dto, uploaderId);
    return { data };
  }

  @Post('upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Complete media upload — verifies the object against storage',
    description:
      'Calls headObject and marks the asset UPLOADED only if storage confirms an object of the ' +
      'declared size. If storage holds nothing, or the wrong number of bytes, the asset is ' +
      'recorded as ABORTED and this returns 409. transcodeStatus stays PENDING: ADR-013 Stage B ' +
      '(media processing) is not implemented.',
  })
  @ApiResponse({ status: 200, description: 'Upload verified against storage' })
  @ApiResponse({ status: 400, description: 'Multipart upload completed without part list' })
  @ApiResponse({
    status: 409,
    description: 'Storage holds no object, the wrong size, or the upload was already aborted',
  })
  async completeUpload(@Body() dto: CompleteMediaUploadDto) {
    const data = await this.uploadService.complete(dto);
    return { data };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get media asset upload and processing status' })
  @ApiResponse({ status: 200, description: 'Media asset status' })
  @ApiResponse({ status: 404, description: 'Media asset not found' })
  async getStatus(@Param('id', ParseUUIDPipe) id: string) {
    const asset = await this.mediaRepo.findById(id);
    if (!asset) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Media asset '${id}' not found`,
      });
    }

    return {
      data: {
        id: asset.id.value,
        originalName: asset.originalName,
        mimeType: asset.mimeType,
        // What the client declared vs. what storage was confirmed to hold. Both
        // are reported, separately, so the two can never be conflated.
        sizeBytes: asset.sizeBytes,
        verifiedBytes: asset.verifiedBytes,
        sha256: asset.sha256,
        uploadStatus: asset.uploadStatus,
        uploadedAt: asset.uploadedAt?.toISOString() ?? null,
        uploadError: asset.uploadError,
        transcodeStatus: asset.transcodeStatus,
        transcodeError: asset.transcodeError,
        thumbnailUrl: asset.cdnUrl,
        // storageKey is deliberately NOT returned. It is an internal bucket
        // path; clients get time-limited presigned URLs instead (API-002), and
        // exposing the key invites callers to build their own.
      },
    };
  }
}
