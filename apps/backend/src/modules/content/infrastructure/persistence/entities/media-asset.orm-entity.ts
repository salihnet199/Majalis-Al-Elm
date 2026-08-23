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

  // ── Upload lifecycle (migration 015, ADR-013 Stage A) ──────────────────────
  // Independent of transcode_status. The DB additionally enforces
  // `upload_status <> 'UPLOADED' OR (verified_bytes, uploaded_at, sha256 all
  // present)` via ct_media_uploaded_requires_verification, so a fabricated
  // UPLOADED fails at the database even if it slipped past the application.

  @Column({
    name: 'upload_status',
    type: 'enum',
    enum: ['PENDING_UPLOAD', 'UPLOADED', 'ABORTED'],
    enumName: 'ct_upload_status',
    default: 'PENDING_UPLOAD',
  })
  uploadStatus!: string;

  /** Hex SHA-256 declared by the client; also the object key's filename. */
  @Column({ name: 'sha256', type: 'char', length: 64, nullable: true })
  sha256!: string | null;

  /** Size read back from storage via headObject. size_bytes is the claim. */
  @Column({ name: 'verified_bytes', type: 'bigint', nullable: true })
  verifiedBytes!: string | number | null;

  @Column({ name: 'uploaded_at', type: 'timestamptz', nullable: true })
  uploadedAt!: Date | null;

  @Column({ name: 'multipart_upload_id', type: 'text', nullable: true })
  multipartUploadId!: string | null;

  @Column({ name: 'upload_error', type: 'text', nullable: true })
  uploadError!: string | null;

  @Column({ name: 'uploaded_by', type: 'uuid' })
  uploadedBy!: string;

  @Column({ name: 'deleted_at', type: 'timestamptz', nullable: true })
  deletedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
