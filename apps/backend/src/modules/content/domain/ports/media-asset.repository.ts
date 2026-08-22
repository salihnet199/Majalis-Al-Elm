import { MediaAsset } from '../media-asset.entity';

export interface IMediaAssetRepository {
  findById(id: string): Promise<MediaAsset | null>;
  save(asset: MediaAsset): Promise<MediaAsset>;
  update(asset: MediaAsset): Promise<MediaAsset>;
}

export const MEDIA_ASSET_REPOSITORY = Symbol('IMediaAssetRepository');
