import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { UUIDv7 } from '../../../../shared/domain/uuid.vo';
import { MediaAsset } from '../../domain/media-asset.entity';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_SINGLE_PUT_BYTES,
  MULTIPART_URL_TTL_SECONDS,
  UPLOAD_URL_TTL_SECONDS,
  buildOriginalKey,
  formatBytesAr,
  resolveUploadRule,
  sha256HexToBase64,
} from '../../domain/media-upload.policy';
import {
  IMediaAssetRepository,
  MEDIA_ASSET_REPOSITORY,
} from '../../domain/ports/media-asset.repository';
import { IStorageService, STORAGE_SERVICE } from '../../domain/ports/storage.service';
import { CompleteMediaUploadDto } from '../dtos/complete-media-upload.dto';
import { InitiateMediaUploadDto } from '../dtos/initiate-media-upload.dto';
import { MediaTranscodeService } from './media-transcode.service';

/**
 * MediaUploadService — the presigned direct-upload flow of ADR-013 Stage A.
 *
 * The contract this service exists to keep: **an asset becomes UPLOADED only
 * after storage has been asked and has confirmed the object.** The endpoint it
 * replaces called `markDone()` on the strength of the client's say-so
 * (TECH-DEBT-014, POLICY-SEC-001 categories 3 and 4).
 *
 * Where verification happens, and why in that order:
 *   1. `initiate` validates the claim and signs a URL that BINDS the claim —
 *      content type, exact length and SHA-256 all go into the signature, so a
 *      client that uploads something else gets a 403 from storage, not from us.
 *   2. `complete` calls headObject. Object absent → the asset is ABORTED and the
 *      caller gets 409. Size different → ABORTED, 409. Only a match confirms.
 *   3. The domain entity refuses mismatched evidence, and the DB CHECK
 *      constraint refuses an UPLOADED row without it. Four independent layers
 *      guard one transition, because that transition is where the last bug was.
 *
 * No failure path here produces a success response, a partial success, or a
 * "probably fine" state. Every one of them either throws or records ABORTED with
 * a stored reason.
 */
@Injectable()
export class MediaUploadService {
  private readonly logger = new Logger(MediaUploadService.name);

  constructor(
    @Inject(MEDIA_ASSET_REPOSITORY) private readonly mediaRepo: IMediaAssetRepository,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
    // Optional: BullMQ not available when REDIS_URL is absent (e.g. unit tests).
    // When present, complete() enqueues a transcode job after confirming upload.
    @Inject(MediaTranscodeService)
    private readonly transcodeService: MediaTranscodeService | null,
  ) {}

  /**
   * Creates the asset row and issues the credential the client uploads with.
   *
   * The row is written BEFORE any byte exists, as PENDING_UPLOAD. That is
   * intentional: it means an abandoned upload leaves a visible, truthful record
   * that the Stage C collector can clean up, rather than an orphaned object in
   * the bucket that nothing in the database knows about.
   */
  async initiate(dto: InitiateMediaUploadDto, uploaderId: string) {
    const rule = resolveUploadRule(dto.mimeType);
    if (!rule) {
      // Unreachable through the DTO's @IsIn, kept as a second gate so a future
      // caller that bypasses validation cannot widen the whitelist by accident.
      throw new UnprocessableEntityException({
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: `Media type '${dto.mimeType}' is not allowed`,
      });
    }

    if (dto.sizeBytes > rule.maxBytes) {
      throw new UnprocessableEntityException({
        code: 'FILE_TOO_LARGE',
        message:
          `${rule.labelAr}: the file is ${formatBytesAr(dto.sizeBytes)} but the maximum for ` +
          `this type is ${formatBytesAr(rule.maxBytes)}`,
        details: {
          declaredBytes: dto.sizeBytes,
          maxBytes: rule.maxBytes,
          category: rule.category,
        },
      });
    }

    const id = UUIDv7.generate();
    // ADR-013 §2. Note what is NOT here: the client's filename. The stub built
    // `media/${id}-${dto.fileName}`, letting an editor-supplied name steer the
    // object's location in the bucket.
    const storageKey = buildOriginalKey({
      mediaId: id.value,
      sha256: dto.sha256,
      extension: rule.extension,
    });

    const isMultipart = dto.sizeBytes > MAX_SINGLE_PUT_BYTES;

    if (isMultipart) {
      const ticket = await this.storage.initiateMultipart({
        key: storageKey,
        contentType: rule.mimeType,
        totalBytes: dto.sizeBytes,
        ttlSeconds: MULTIPART_URL_TTL_SECONDS,
      });

      const asset = MediaAsset.create({
        id,
        originalName: dto.fileName,
        storageKey,
        mimeType: rule.mimeType,
        sizeBytes: dto.sizeBytes,
        sha256: dto.sha256,
        uploadedBy: uploaderId,
        multipartUploadId: ticket.uploadId,
      });

      try {
        await this.mediaRepo.save(asset);
      } catch (error) {
        // The multipart session already exists in storage. Leaving it would
        // accrue billable parts that no database row references, so clean it up
        // and let the real error surface.
        await this.storage
          .abortMultipart({ key: storageKey, uploadId: ticket.uploadId })
          .catch((abortError) =>
            this.logger.error(
              `Failed to abort orphaned multipart upload ${ticket.uploadId} for ${storageKey}`,
              abortError as Error,
            ),
          );
        throw error;
      }

      return {
        uploadId: id.value,
        mode: 'MULTIPART' as const,
        storageKey,
        partSizeBytes: ticket.partSizeBytes,
        parts: ticket.parts,
        expiresAt: ticket.expiresAt.toISOString(),
      };
    }

    const asset = MediaAsset.create({
      id,
      originalName: dto.fileName,
      storageKey,
      mimeType: rule.mimeType,
      sizeBytes: dto.sizeBytes,
      sha256: dto.sha256,
      uploadedBy: uploaderId,
    });
    await this.mediaRepo.save(asset);

    const presigned = await this.storage.presignUpload({
      key: storageKey,
      contentType: rule.mimeType,
      contentLength: dto.sizeBytes,
      sha256Hex: dto.sha256,
      ttlSeconds: UPLOAD_URL_TTL_SECONDS,
    });

    return {
      uploadId: id.value,
      mode: 'SINGLE' as const,
      storageKey,
      uploadUrl: presigned.url,
      // The client must send these exactly; they are inside the signature.
      requiredHeaders: presigned.requiredHeaders,
      expiresAt: presigned.expiresAt.toISOString(),
    };
  }

  /**
   * Verifies the upload against storage and records the result.
   *
   * @throws ConflictException when storage does not hold the expected object.
   *         The asset is persisted as ABORTED with the reason, so the editor sees
   *         why, and a later `/status` call keeps telling the truth.
   */
  async complete(dto: CompleteMediaUploadDto) {
    const asset = await this.mediaRepo.findById(dto.uploadId);
    if (!asset) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Media asset '${dto.uploadId}' not found`,
      });
    }

    // Idempotent retry (flaky network, double click): report the state that was
    // already verified rather than verifying again or erroring.
    if (asset.uploadStatus === 'UPLOADED') {
      return this.presentCompletion(asset, { alreadyComplete: true });
    }

    if (asset.uploadStatus === 'ABORTED') {
      throw new ConflictException({
        code: 'UPLOAD_ABORTED',
        message:
          `Upload '${dto.uploadId}' was aborted and cannot be completed: ` +
          `${asset.uploadError ?? 'reason not recorded'}. Start a new upload.`,
      });
    }

    // ── Multipart: storage has to assemble the object first ──────────────────
    if (asset.multipartUploadId) {
      if (!dto.parts || dto.parts.length === 0) {
        throw new BadRequestException({
          code: 'MULTIPART_PARTS_REQUIRED',
          message:
            `Upload '${dto.uploadId}' is a multipart upload; 'parts' (partNumber + etag for ` +
            'every uploaded part) is required to assemble the object',
        });
      }

      try {
        await this.storage.completeMultipart({
          key: asset.storageKey,
          uploadId: asset.multipartUploadId,
          parts: dto.parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })),
        });
      } catch (error) {
        const reason = `Storage rejected multipart completion: ${(error as Error).message}`;
        await this.abortAndPersist(asset, reason);
        throw new ConflictException({ code: 'UPLOAD_INCOMPLETE', message: reason });
      }
    }

    // ── The authoritative check ─────────────────────────────────────────────
    // A throw from head() (network, 403) propagates as a 5xx: an inconclusive
    // check must never be read as either success or absence.
    const head = await this.storage.head(asset.storageKey);

    if (head === null) {
      const reason =
        'Storage holds no object at the expected key — the file was never uploaded, or the ' +
        'presigned URL expired before the upload finished';
      await this.abortAndPersist(asset, reason);
      throw new ConflictException({
        code: 'UPLOAD_NOT_FOUND_IN_STORAGE',
        message: reason,
        details: { storageKey: asset.storageKey },
      });
    }

    if (head.sizeBytes !== asset.sizeBytes) {
      const reason =
        `Storage holds ${head.sizeBytes} bytes but ${asset.sizeBytes} were declared — ` +
        'the upload is truncated or was replaced';
      await this.abortAndPersist(asset, reason);
      throw new ConflictException({
        code: 'UPLOAD_SIZE_MISMATCH',
        message: reason,
        details: { verifiedBytes: head.sizeBytes, declaredBytes: asset.sizeBytes },
      });
    }

    // Storage only reports a checksum when it recorded one (single-part uploads
    // here). When present it is authoritative and cheap to check, so check it.
    if (head.checksumSha256 && asset.sha256) {
      const expected = sha256HexToBase64(asset.sha256);
      if (head.checksumSha256 !== expected) {
        const reason =
          'The SHA-256 recorded by storage does not match the digest declared at initiate — ' +
          'the stored bytes are not the file that was announced';
        await this.abortAndPersist(asset, reason);
        throw new ConflictException({ code: 'UPLOAD_CHECKSUM_MISMATCH', message: reason });
      }
    }

    asset.confirmUpload({ verifiedBytes: head.sizeBytes, verifiedAt: new Date() });
    const updated = await this.mediaRepo.update(asset);

    this.logger.log(
      `Media upload verified: ${updated.id.value} (${updated.verifiedBytes} bytes at ${updated.storageKey})`,
    );

    // ── ADR-013 Stage B seam ────────────────────────────────────────────────
    // Enqueue the transcode job immediately after confirming the upload.
    // Fire-and-forget: the HTTP response does not wait for transcoding.
    // transcodeStatus in the response is still PENDING (set by the DB row);
    // the worker will transition it to QUEUED → TRANSCODING → TRANSCODED.
    if (this.transcodeService) {
      this.transcodeService.enqueue(updated.id.value, updated.storageKey).catch((err) =>
        this.logger.error(
          `[Stage B] Failed to enqueue transcode job for ${updated.id.value}: ${(err as Error).message}`,
        ),
      );
    } else {
      this.logger.warn(
        `[Stage B] MediaTranscodeService not available — skipping transcode job for ${updated.id.value}. ` +
          'Set REDIS_URL to enable processing.',
      );
    }

    return this.presentCompletion(updated, { alreadyComplete: false });
  }

  /**
   * Issues a time-limited download URL for a verified asset (API-002, 60 min).
   *
   * Refuses unless the asset is UPLOADED. Signing a URL for an unverified asset
   * would hand the client a link that 404s at the CDN — a failure surfaced late,
   * to an end user, instead of early, to the caller.
   */
  async issueDownloadUrl(assetId: string) {
    const asset = await this.mediaRepo.findById(assetId);
    if (!asset) {
      throw new NotFoundException({
        code: 'NOT_FOUND',
        message: `Media asset '${assetId}' not found`,
      });
    }

    if (!asset.isUploaded) {
      throw new ConflictException({
        code: 'MEDIA_NOT_AVAILABLE',
        message:
          `Media asset '${assetId}' has no verified file in storage (upload status: ` +
          `${asset.uploadStatus})`,
        details: { uploadStatus: asset.uploadStatus, uploadError: asset.uploadError },
      });
    }

    const presigned = await this.storage.presignDownload({
      key: asset.storageKey,
      ttlSeconds: DOWNLOAD_URL_TTL_SECONDS,
      downloadFilename: asset.originalName,
    });

    return {
      url: presigned.url,
      expiresAt: presigned.expiresAt.toISOString(),
      expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
      mimeType: asset.mimeType,
      sizeBytes: asset.sizeBytes,
      durationMs: asset.durationMs,
    };
  }

  /** Records the failure and its reason. Never swallows the persistence error. */
  private async abortAndPersist(asset: MediaAsset, reason: string): Promise<void> {
    asset.abortUpload(reason);
    await this.mediaRepo.update(asset);
    this.logger.warn(`Media upload aborted: ${asset.id.value} — ${reason}`);
  }

  private presentCompletion(asset: MediaAsset, meta: { alreadyComplete: boolean }) {
    return {
      mediaAssetId: asset.id.value,
      uploadStatus: asset.uploadStatus,
      verifiedBytes: asset.verifiedBytes,
      sha256: asset.sha256,
      uploadedAt: asset.uploadedAt?.toISOString() ?? null,
      alreadyComplete: meta.alreadyComplete,
      // Reported, not inferred. ADR-013 Stage B is not implemented, so this is
      // PENDING and will stay PENDING — the file is stored, not processed.
      transcodeStatus: asset.transcodeStatus,
      transcodeNote:
        'The file is stored and verified. Media processing (ADR-013 Stage B) is not yet ' +
        'implemented, so transcodeStatus remains PENDING.',
    };
  }
}
