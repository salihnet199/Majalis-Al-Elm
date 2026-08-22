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

  // ── get one ───────────────────────────────────────────────────────────────
  async findOne(questionId: string) {
    const question = await this.questionRepo.findOne({
      where: { id: questionId, deletedAt: IsNull() },
    });
    if (!question) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Question not found' });
    }

    const answers = await this.answerRepo.find({
      where: { questionId, deletedAt: IsNull() },
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
    const question = await this.questionRepo.findOne({
      where: { id: questionId, deletedAt: IsNull() },
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
    _moderatorId: string,
  ): Promise<object> {
    const question = await this.questionRepo.findOne({
      where: { id: questionId, deletedAt: IsNull() },
    });
    if (!question) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Question not found' });
    }

    await this.questionRepo.update(questionId, {
      status: newStatus,
      updatedAt: new Date(),
    });

    const updated = await this.questionRepo.findOne({ where: { id: questionId } });
    return this.toQuestionResponse(updated!);
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
