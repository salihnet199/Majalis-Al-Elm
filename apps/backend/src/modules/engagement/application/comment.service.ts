import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { CommentOrmEntity } from '../infrastructure/persistence/entities/comment.orm-entity';
import { CommentVoteOrmEntity } from '../infrastructure/persistence/entities/comment-vote.orm-entity';
import { CreateCommentDto } from './dtos/create-comment.dto';
import { UpdateCommentDto } from './dtos/update-comment.dto';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';

/** edit_window_minutes default — mirrors ad_system_config seed value */
const DEFAULT_EDIT_WINDOW_MINUTES = 15;

const MODERATOR_ROLES = ['Moderator', 'Admin', 'SuperAdmin'];

@Injectable()
export class CommentService {
  constructor(
    @InjectRepository(CommentOrmEntity)
    private readonly commentRepo: Repository<CommentOrmEntity>,
    @InjectRepository(CommentVoteOrmEntity)
    private readonly voteRepo: Repository<CommentVoteOrmEntity>,
  ) {}

  // ── list ──────────────────────────────────────────────────────────────────
  async list(
    contentId: string,
    user: JwtPayload,
    limit = 20,
    cursor?: string,
  ) {
    const isModerator = MODERATOR_ROLES.includes(user.role);
    const qb = this.commentRepo
      .createQueryBuilder('c')
      .where('c.content_id = :contentId', { contentId })
      .andWhere('c.deleted_at IS NULL')
      .andWhere('c.parent_id IS NULL'); // top-level only

    if (!isModerator) {
      // Regular users see APPROVED comments + their own (any status)
      qb.andWhere(
        '(c.status = :approved OR c.user_id = :userId)',
        { approved: 'APPROVED', userId: user.sub },
      );
    }

    if (cursor) {
      try {
        const decoded = Buffer.from(cursor, 'base64').toString('utf-8');
        const { createdAt, id } = JSON.parse(decoded);
        qb.andWhere(
          '(c.created_at < :cursorDate OR (c.created_at = :cursorDate AND c.id < :cursorId))',
          { cursorDate: createdAt, cursorId: id },
        );
      } catch {
        // invalid cursor — ignore, return first page
      }
    }

    qb.orderBy('c.created_at', 'DESC').addOrderBy('c.id', 'DESC');
    qb.take(limit + 1);

    const records = await qb.getMany();
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(
        JSON.stringify({ createdAt: last.createdAt, id: last.id }),
      ).toString('base64');
    }

    return {
      data: items.map(this.toResponse),
      meta: { nextCursor, prevCursor: null, limit },
    };
  }

  // ── create ────────────────────────────────────────────────────────────────
  async create(
    contentId: string,
    dto: CreateCommentDto,
    user: JwtPayload,
  ): Promise<object> {
    // Cross-BC content_id validation handled at controller level
    // (existence check via raw query — no repository import from ContentModule)
    const entity = this.commentRepo.create({
      id: randomUUID(),
      contentId,
      userId: user.sub,
      parentId: dto.parentId ?? null,
      body: dto.body,
      upvotesCount: 0,
      status: 'PENDING',
    });

    const saved = await this.commentRepo.save(entity);
    return this.toResponse(saved);
  }

  // ── update ────────────────────────────────────────────────────────────────
  /**
   * Only the comment owner may update, within the edit window.
   * Edit window: read from ad_system_config 'comment.edit_window_minutes' (default 15).
   * editWindowMinutes injected from controller to avoid tight coupling to ConfigService here.
   */
  async update(
    commentId: string,
    dto: UpdateCommentDto,
    user: JwtPayload,
    editWindowMinutes = DEFAULT_EDIT_WINDOW_MINUTES,
  ): Promise<object> {
    const comment = await this.findActiveOrThrow(commentId);

    // Ownership check
    if (comment.userId !== user.sub) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You can only edit your own comments' });
    }

    // Edit window check
    const windowMs = editWindowMinutes * 60 * 1000;
    const editableUntil = comment.createdAt.getTime() + windowMs;
    if (Date.now() > editableUntil) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Comment edit window of ${editWindowMinutes} minutes has expired`,
      });
    }

    await this.commentRepo.update(commentId, {
      body: dto.body,
      updatedAt: new Date(),
    });

    const updated = await this.findActiveOrThrow(commentId);
    return this.toResponse(updated);
  }

  // ── delete ────────────────────────────────────────────────────────────────
  /**
   * DELETE ownership logic — critical (BC03 RBAC):
   *
   *   1. Fetch comment — 404 if not found / already deleted
   *   2. isOwner  = comment.userId === requestingUser.sub
   *   3. isMod    = requestingUser.role IN ['Moderator', 'Admin', 'SuperAdmin']
   *   4. if (!isOwner && !isMod) → 403 FORBIDDEN
   *   5. else → soft delete (deleted_at = NOW())
   *
   * The endpoint Guard is JwtAuthGuard ONLY — any authenticated user reaches
   * this method. The owner/moderator distinction lives here, NOT in RolesGuard,
   * because RolesGuard cannot distinguish "own resource" from "any resource".
   */
  async delete(commentId: string, user: JwtPayload): Promise<void> {
    const comment = await this.findActiveOrThrow(commentId);

    const isOwner = comment.userId === user.sub;
    const isModerator = MODERATOR_ROLES.includes(user.role);

    if (!isOwner && !isModerator) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have permission to delete this comment',
      });
    }

    await this.commentRepo.update(commentId, {
      deletedAt: new Date(),
      updatedAt: new Date(),
    });
  }

  // ── vote (toggle) ─────────────────────────────────────────────────────────
  /**
   * Vote toggle:
   *   - If (userId, commentId) EXISTS in eg_comment_votes → DELETE + upvotes_count--
   *   - If NOT exists → INSERT + upvotes_count++
   * The PK constraint on eg_comment_votes prevents race-condition duplicates at DB level.
   */
  async toggleVote(commentId: string, user: JwtPayload): Promise<object> {
    const comment = await this.findActiveOrThrow(commentId);

    const existing = await this.voteRepo.findOne({
      where: { userId: user.sub, commentId },
    });

    if (existing) {
      // Unvote
      await this.voteRepo.delete({ userId: user.sub, commentId });
      const newCount = Math.max(0, comment.upvotesCount - 1);
      await this.commentRepo.update(commentId, { upvotesCount: newCount, updatedAt: new Date() });
      return { data: { voted: false, upvotesCount: newCount } };
    } else {
      // Upvote
      const vote = this.voteRepo.create({ userId: user.sub, commentId });
      await this.voteRepo.save(vote);
      const newCount = comment.upvotesCount + 1;
      await this.commentRepo.update(commentId, { upvotesCount: newCount, updatedAt: new Date() });
      return { data: { voted: true, upvotesCount: newCount } };
    }
  }

  // ── moderation ────────────────────────────────────────────────────────────
  async listPending(status?: string, page = 1, limit = 25) {
    const skip = (page - 1) * limit;
    const validStatus = ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED'];
    const filterStatus = status && validStatus.includes(status) ? status : 'PENDING';

    const [items, total] = await this.commentRepo.findAndCount({
      where: { status: filterStatus, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });

    return {
      data: items.map(this.toResponse),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async moderate(
    commentId: string,
    newStatus: 'APPROVED' | 'REJECTED' | 'FLAGGED',
    moderatorId: string,
  ): Promise<object> {
    const comment = await this.findActiveOrThrow(commentId);

    if (comment.status === 'APPROVED' && newStatus === 'APPROVED') {
      throw new BadRequestException({ code: 'VALIDATION_ERROR', message: 'Comment is already approved' });
    }

    await this.commentRepo.update(commentId, {
      status: newStatus,
      moderatedBy: moderatorId,
      moderatedAt: new Date(),
      updatedAt: new Date(),
    });

    const updated = await this.findActiveOrThrow(commentId);
    return this.toResponse(updated);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private async findActiveOrThrow(id: string): Promise<CommentOrmEntity> {
    const comment = await this.commentRepo.findOne({
      where: { id, deletedAt: IsNull() },
    });
    if (!comment) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Comment not found' });
    }
    return comment;
  }

  private toResponse(c: CommentOrmEntity) {
    return {
      id: c.id,
      body: c.body,
      contentId: c.contentId,
      parentId: c.parentId,
      upvotesCount: c.upvotesCount,
      status: c.status,
      userId: c.userId,
      moderatedBy: c.moderatedBy,
      moderatedAt: c.moderatedAt,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
    };
  }
}
