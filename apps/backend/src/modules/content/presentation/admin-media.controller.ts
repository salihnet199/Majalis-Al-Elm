import {
  Controller, Get, Post, Param, Body,
  UseGuards, Req, NotFoundException, Inject,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import {
  IMediaAssetRepository,
  MEDIA_ASSET_REPOSITORY,
} from '../domain/ports/media-asset.repository';
import { MediaAsset } from '../domain/media-asset.entity';
import { UUIDv7 } from '../../../shared/domain/uuid.vo';
import { InitiateMediaUploadDto } from '../application/dtos/initiate-media-upload.dto';
import { CompleteMediaUploadDto } from '../application/dtos/complete-media-upload.dto';

@ApiTags('Admin Media')
@Controller('admin/media')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Editor', 'Admin', 'SuperAdmin')
@ApiBearerAuth()
export class AdminMediaController {
  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY)
    private readonly mediaRepo: IMediaAssetRepository,
  ) {}

  @Post('upload/initiate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Initiate media upload (Stub — returns upload ID)' })
  @ApiResponse({ status: 200, description: 'Upload initiated' })
  async initiateUpload(@Body() dto: InitiateMediaUploadDto, @Req() req: any) {
    const userId = req.user?.sub || '00000000-0000-7000-8000-000000000000';
    const id = UUIDv7.generate();
    const storageKey = `media/${id.value}-${dto.fileName}`;

    const asset = MediaAsset.create({
      id,
      originalName: dto.fileName,
      storageKey,
      mimeType: dto.mimeType,
      sizeBytes: dto.sizeBytes,
      uploadedBy: userId,
    });

    const saved = await this.mediaRepo.save(asset);

    return {
      data: {
        uploadId: saved.id.value,
        storageKey: saved.storageKey,
        presignedUrl: null,
        _note: 'Upload stub — set media_asset_id manually in create/patch content',
      },
    };
  }

  @Post('upload/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Complete media upload (Stub — marks status DONE)' })
  @ApiResponse({ status: 200, description: 'Upload completed' })
  async completeUpload(@Body() dto: CompleteMediaUploadDto) {
    const asset = await this.mediaRepo.findById(dto.uploadId);
    if (!asset) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Media asset '${dto.uploadId}' not found`,
      });
    }

    asset.markDone();
    const updated = await this.mediaRepo.update(asset);

    return {
      data: {
        mediaAssetId: updated.id.value,
        transcodeStatus: updated.transcodeStatus,
      },
    };
  }

  @Get(':id/status')
  @ApiOperation({ summary: 'Get media asset transcode status' })
  @ApiResponse({ status: 200, description: 'Media asset status' })
  async getStatus(@Param('id') id: string) {
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
        sizeBytes: asset.sizeBytes,
        transcodeStatus: asset.transcodeStatus,
        thumbnailUrl: asset.cdnUrl,
        storageKey: asset.storageKey,
      },
    };
  }
}
