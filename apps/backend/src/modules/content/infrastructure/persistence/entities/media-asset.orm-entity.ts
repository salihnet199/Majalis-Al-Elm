import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/** ct_media_assets — DB-SCHEMA.md §BC02
 *  cdn_url: public assets only (thumbnails). AUDIO/PDF protected via Presigned URL (API-002).
 */
@Entity({ name: 'ct_media_assets' })
export class MediaAssetOrmEntity {
  @PrimaryColumn({ type: 'uuid' })
  id!: string;

  @Column({ name: 'original_name', length: 500 })
  originalName!: string;

  @Column({ name: 'storage_key', type: 'text', unique: true })
  storageKey!: string;

  @Column({ name: 'cdn_url', type: 'text', nullable: true })
  cdnUrl!: string | null;

  @Column({ name: 'mime_type', length: 100 })
  mimeType!: string;

  @Column({ name: 'size_bytes', type: 'bigint' })
  sizeBytes!: number;

  @Column({ name: 'duration_ms', type: 'int', nullable: true })
  durationMs!: number | null;

  @Column({ name: 'page_count', type: 'int', nullable: true })
  pageCount!: number | null;

  @Column({ name: 'width_px', type: 'int', nullable: true })
  widthPx!: number | null;

  @Column({ name: 'height_px', type: 'int', nullable: true })
  heightPx!: number | null;

  @Column({ name: 'thumbnail_key', type: 'text', nullable: true })
  thumbnailKey!: string | null;

  @Column({ name: 'transcode_status', type: 'enum', enum: ['PENDING', 'PROCESSING', 'DONE', 'FAILED'], default: 'PENDING' })
  transcodeStatus!: string;

  @Column({ name: 'transcode_error', type: 'text', nullable: true })
  transcodeError!: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
