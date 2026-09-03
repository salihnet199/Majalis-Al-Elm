import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { MediaAssetOrmEntity } from './entities/media-asset.orm-entity';
import { IMediaAssetRepository } from '../../domain/ports/media-asset.repository';
import { MediaAsset } from '../../domain/media-asset.entity';

@Injectable()
export class TypeOrmMediaAssetRepository implements IMediaAssetRepository {
  constructor(
    @InjectRepository(MediaAssetOrmEntity)
    private readonly mediaRepo: Repository<MediaAssetOrmEntity>,
  ) {}

  async findById(id: string): Promise<MediaAsset | null> {
    const record = await this.mediaRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    return record ? this.toDomain(record) : null;
  }

  async save(asset: MediaAsset): Promise<MediaAsset> {
    const entity = this.mediaRepo.create({
      id: asset.id.value,
      originalName: asset.originalName,
      storageKey: asset.storageKey,
      cdnUrl: asset.cdnUrl,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs,
      pageCount: asset.pageCount,
      widthPx: asset.widthPx,
      heightPx: asset.heightPx,
      thumbnailKey: asset.thumbnailKey,
      transcodeStatus: asset.transcodeStatus,
      transcodeError: asset.transcodeError,
      uploadStatus: asset.uploadStatus,
      sha256: asset.sha256,
      verifiedBytes: asset.verifiedBytes,
      uploadedAt: asset.uploadedAt,
      multipartUploadId: asset.multipartUploadId,
      uploadError: asset.uploadError,
      uploadedBy: asset.uploadedBy,
      deletedAt: asset.deletedAt,
      createdAt: asset.createdAt,
      updatedAt: asset.updatedAt,
    });
    const saved = await this.mediaRepo.save(entity);
    return this.toDomain(saved);
  }

  async update(asset: MediaAsset): Promise<MediaAsset> {
    await this.mediaRepo.update(asset.id.value, {
      cdnUrl: asset.cdnUrl,
      transcodeStatus: asset.transcodeStatus,
      transcodeError: asset.transcodeError,
      thumbnailKey: asset.thumbnailKey,
      // Upload lifecycle (migration 015). These MUST be in the update set: the
      // whole point of `complete` is to persist the verification result, and an
      // omitted column here would leave an upload permanently PENDING_UPLOAD
      // while the API reported success.
      uploadStatus: asset.uploadStatus,
      sha256: asset.sha256,
      verifiedBytes: asset.verifiedBytes,
      uploadedAt: asset.uploadedAt,
      multipartUploadId: asset.multipartUploadId,
      uploadError: asset.uploadError,
      deletedAt: asset.deletedAt,
      updatedAt: asset.updatedAt,
    });
    const updated = await this.findById(asset.id.value);
    if (!updated) {
      throw new Error(`MediaAsset ${asset.id.value} vanished immediately after update() succeeded`);
    }
    return updated;
  }

  private toDomain(orm: MediaAssetOrmEntity): MediaAsset {
    return MediaAsset.reconstitute({
      id: orm.id,
      originalName: orm.originalName,
      storageKey: orm.storageKey,
      cdnUrl: orm.cdnUrl,
      mimeType: orm.mimeType,
      sizeBytes: Number(orm.sizeBytes),
      durationMs: orm.durationMs,
      pageCount: orm.pageCount,
      widthPx: orm.widthPx,
      heightPx: orm.heightPx,
      thumbnailKey: orm.thumbnailKey,
      transcodeStatus: orm.transcodeStatus as any,
      transcodeError: orm.transcodeError,
      uploadStatus: orm.uploadStatus as any,
      sha256: orm.sha256,
      // pg returns BIGINT as a string to avoid precision loss; a raw string here
      // would make the domain's `verifiedBytes !== sizeBytes` check compare a
      // string to a number and always fail.
      verifiedBytes: orm.verifiedBytes === null ? null : Number(orm.verifiedBytes),
      uploadedAt: orm.uploadedAt,
      multipartUploadId: orm.multipartUploadId,
      uploadError: orm.uploadError,
      uploadedBy: orm.uploadedBy,
      deletedAt: orm.deletedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
}
