import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull } from 'typeorm';
import { randomUUID } from 'crypto';
import { QuestionOrmEntity } from '../infrastructure/persistence/entities/question.orm-entity';
import { AnswerOrmEntity } from '../infrastructure/persistence/entities/answer.orm-entity';
import { CreateQuestionDto } from './dtos/create-question.dto';
import { CreateAnswerDto } from './dtos/create-answer.dto';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';

@Injectable()
export class QuestionService {
  constructor(
    @InjectRepository(QuestionOrmEntity)
    private readonly questionRepo: Repository<QuestionOrmEntity>,
    @InjectRepository(AnswerOrmEntity)
    private readonly answerRepo: Repository<AnswerOrmEntity>,
  ) {}

  // ── list questions ────────────────────────────────────────────────────────
  async list(
    limit = 20,
    cursor?: string,
    contentId?: string,
    answered?: boolean,
  ) {
    const qb = this.questionRepo
      .createQueryBuilder('q')
      .where('q.deleted_at IS NULL')
      .andWhere('q.status = :approved', { approved: 'APPROVED' });

    if (contentId) {
      qb.andWhere('q.content_id = :contentId', { contentId });
    }

    if (answered !== undefined) {
      qb.andWhere('q.is_answered = :isAnswered', { isAnswered: answered });
    }

    if (cursor) {
      try {
        const { createdAt, id } = JSON.parse(Buffer.from(cursor, 'base64').toString('utf-8'));
        qb.andWhere(
          '(q.created_at < :cursorDate OR (q.created_at = :cursorDate AND q.id < :cursorId))',
          { cursorDate: createdAt, cursorId: id },
        );
      } catch {
        // invalid cursor — ignore
      }
    }

    qb.orderBy('q.created_at', 'DESC').addOrderBy('q.id', 'DESC').take(limit + 1);

    const records = await qb.getMany();
    const hasMore = records.length > limit;
    const items = hasMore ? records.slice(0, limit) : records;

    let nextCursor: string | null = null;
    if (hasMore && items.length > 0) {
      const last = items[items.length - 1];
      nextCursor = Buffer.from(JSON.stringify({ createdAt: last.createdAt, id: last.id })).toString('base64');
    }

    return {
      data: items.map(this.toQuestionResponse),
      meta: { nextCursor, prevCursor: null, limit },
    };
  }

  // ── get one (public) ─────────────────────────────────────────────────────
  /**
   * Public detail view — GET /questions/:id.
   *
   * Deliberately separate from moderation access: this method must only ever
   * return APPROVED content, the same rule list() already applies. A question
   * awaiting review, rejected, or flagged is treated exactly like a missing
   * one (404) — it must never be reachable just by knowing/guessing its id.
   * Moderators/Admins inspect non-approved questions through
   * QuestionService#listPending() (used by AdminModerationController), which
   * carries its own RolesGuard — never through this endpoint.
   *
   * Answers are filtered the same way: an approved question must not leak
   * PENDING/REJECTED/FLAGGED answers to it.
   */
  async findPublicQuestion(questionId: string) {
    const question = await this.questionRepo.findOne({
      where: { id: questionId, deletedAt: IsNull(), status: 'APPROVED' },
    });
    if (!question) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Question not found' });
    }

    const answers = await this.answerRepo.find({
      where: { questionId, deletedAt: IsNull(), status: 'APPROVED' },
      order: { createdAt: 'ASC' },
    });

    return {
      data: {
        ...this.toQuestionResponse(question),
        answers: answers.map(this.toAnswerResponse),
      },
    };
  }

  // ── create question ───────────────────────────────────────────────────────
  async create(dto: CreateQuestionDto, user: JwtPayload): Promise<object> {
    const entity = this.questionRepo.create({
      id: randomUUID(),
      contentId: dto.contentId ?? null,
      userId: user.sub,
      title: dto.title,
      body: dto.body ?? null,
      status: 'PENDING',
      isAnswered: false,
    });
    const saved = await this.questionRepo.save(entity);
    return { data: this.toQuestionResponse(saved) };
  }

  // ── create answer ─────────────────────────────────────────────────────────
  /**
   * answered_by_role is captured from the JWT payload at answer creation time
   * and stored immutably. It reflects the user's role at the moment of answering.
   */
  async createAnswer(
    questionId: string,
    dto: CreateAnswerDto,
    user: JwtPayload,
  ): Promise<object> {
    // Same 404-for-non-approved contract as findPublicQuestion(): answering
    // a question the asker/public can't even see yet doesn't make sense, and
    // this endpoint must not leak PENDING/REJECTED/FLAGGED question ids to
    // authenticated users any more than the GET endpoint does.
    const question = await this.questionRepo.findOne({
      where: { id: questionId, deletedAt: IsNull(), status: 'APPROVED' },
    });
    if (!question) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Question not found' });
    }

    const entity = this.answerRepo.create({
      id: randomUUID(),
      questionId,
      userId: user.sub,
      body: dto.body,
      isAccepted: false,
      answeredByRole: user.role,  // captured from JWT — immutable after creation
      status: 'PENDING',
    });

    const saved = await this.answerRepo.save(entity);
    return { data: this.toAnswerResponse(saved) };
  }

  // ── moderation ────────────────────────────────────────────────────────────
  async listPending(status?: string, page = 1, limit = 25) {
    const skip = (page - 1) * limit;
    const validStatus = ['PENDING', 'APPROVED', 'REJECTED', 'FLAGGED'];
    const filterStatus = status && validStatus.includes(status) ? status : 'PENDING';

    const [items, total] = await this.questionRepo.findAndCount({
      where: { status: filterStatus, deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
      skip,
      take: limit,
    });

    return {
      data: items.map(this.toQuestionResponse),
      meta: { total, page, limit, totalPages: Math.ceil(total / limit) },
    };
  }

  async moderate(
    questionId: string,
    newStatus: 'APPROVED' | 'REJECTED',
    moderatorId: string,
  ): Promise<object> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId, deletedAt: IsNull() },
    });
    if (!question) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Question not found' });
    }

    await this.questionRepo.update(questionId, {
      status: newStatus,
      moderatedBy: moderatorId,
      moderatedAt: new Date(),
      updatedAt: new Date(),
    });

    const updated = await this.questionRepo.findOne({ where: { id: questionId } });
    if (!updated) {
      throw new Error(`Question ${questionId} vanished immediately after moderate() update succeeded`);
    }
    return this.toQuestionResponse(updated);
  }

  // ── helpers ───────────────────────────────────────────────────────────────
  private toQuestionResponse(q: QuestionOrmEntity) {
    return {
      id: q.id,
      title: q.title,
      body: q.body,
      contentId: q.contentId,
      userId: q.userId,
      isAnswered: q.isAnswered,
      status: q.status,
      moderatedBy: q.moderatedBy,
      moderatedAt: q.moderatedAt,
      createdAt: q.createdAt,
      updatedAt: q.updatedAt,
    };
  }

  private toAnswerResponse(a: AnswerOrmEntity) {
    return {
      id: a.id,
      questionId: a.questionId,
      body: a.body,
      isAccepted: a.isAccepted,
      answeredByRole: a.answeredByRole,
      userId: a.userId,
      status: a.status,
      createdAt: a.createdAt,
      updatedAt: a.updatedAt,
    };
  }
}
