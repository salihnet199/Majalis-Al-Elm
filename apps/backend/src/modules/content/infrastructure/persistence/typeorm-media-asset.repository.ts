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
      deletedAt: asset.deletedAt,
      updatedAt: asset.updatedAt,
    });
    const updated = await this.findById(asset.id.value);
    return updated!;
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
      uploadedBy: orm.uploadedBy,
      deletedAt: orm.deletedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
}
