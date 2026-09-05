/**
 * BC03 Engagement (Comments & Q&A) — Integration Tests
 *
 * Tests all endpoints and critical business logic:
 *  - Comments: creation, list (status filtering for user vs mod), update within window,
 *              DELETE (own vs any/moderator), vote toggling
 *  - Q&A: question creation, filtering, answering (answered_by_role from JWT),
 *         QaFeatureGuard enforcement
 *  - Moderation: RBAC enforcement (Moderator+ only, 403 for regular user),
 *                approve / reject / flag actions
 */

import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate } from '@nestjs/common';
import request = require('supertest');
import { getRepositoryToken } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';

import { CommentsController } from './presentation/comments.controller';
import { QuestionsController } from './presentation/questions.controller';
import { AdminModerationController } from './presentation/admin-moderation.controller';
import { CommentService } from './application/comment.service';
import { QuestionService } from './application/question.service';
import { QaFeatureGuard } from './presentation/guards/qa-feature.guard';
import { RolesGuard } from './presentation/guards/roles.guard';

import { JwtStrategy } from '../identity/infrastructure/adapters/jwt.strategy';
import { USER_REPOSITORY } from '../identity/domain/ports/user.repository';
import { buildMockUserRepo } from '../../testing/mock-user-repo';
import { JwtRs256Adapter } from '../identity/infrastructure/adapters/jwt-rs256.adapter';

import { CommentOrmEntity } from './infrastructure/persistence/entities/comment.orm-entity';
import { CommentVoteOrmEntity } from './infrastructure/persistence/entities/comment-vote.orm-entity';
import { QuestionOrmEntity } from './infrastructure/persistence/entities/question.orm-entity';
import { AnswerOrmEntity } from './infrastructure/persistence/entities/answer.orm-entity';

import { GlobalExceptionFilter } from '../../shared/presentation/filters/global-exception.filter';
import { TraceIdInterceptor } from '../../shared/presentation/interceptors/trace-id.interceptor';

class BypassThrottlerGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('BC03 Engagement Module — Integration Tests', () => {
  let app: INestApplication;
  let jwtAdapter: JwtRs256Adapter;

  // In-memory data stores
  let commentsStore: CommentOrmEntity[] = [];
  let votesStore: CommentVoteOrmEntity[] = [];
  let questionsStore: QuestionOrmEntity[] = [];
  let answersStore: AnswerOrmEntity[] = [];

  // Config mock store
  let qaFeatureEnabled = true;
  let editWindowMinutes = 15;

  // Test users & tokens
  const user1Id = randomUUID();
  const user2Id = randomUUID();
  const moderatorId = randomUUID();
  const adminId = randomUUID();

  let user1Token: string;
  let user2Token: string;
  let moderatorToken: string;
  let adminToken: string;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';

    const mockConfigService = {
      get: jest.fn((key: string, defaultValue?: any) => {
        if (key === 'feature_flag.qa') return qaFeatureEnabled;
        if (key === 'comment.edit_window_minutes') return editWindowMinutes;
        const config: Record<string, any> = {
          'jwt.accessTokenTtl': 900,
          'jwt.refreshTokenTtl': 604800,
        };
        return config[key] ?? defaultValue;
      }),
    };

    // In-memory Comment Repository
    const mockCommentRepo = {
      create: jest.fn((dto: any) => ({
        id: dto.id || randomUUID(),
        contentId: dto.contentId,
        userId: dto.userId,
        parentId: dto.parentId ?? null,
        body: dto.body,
        upvotesCount: dto.upvotesCount ?? 0,
        status: dto.status ?? 'PENDING',
        moderatedBy: null,
        moderatedAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn(async (entity: CommentOrmEntity) => {
        const idx = commentsStore.findIndex((c) => c.id === entity.id);
        if (idx !== -1) {
          commentsStore[idx] = entity;
        } else {
          commentsStore.push(entity);
        }
        return entity;
      }),
      findOne: jest.fn(async (opts?: any) => {
        const found = commentsStore.find((c) => {
          if (opts?.where?.id && c.id !== opts.where.id) return false;
          if (opts?.where?.deletedAt === null && c.deletedAt !== null) return false;
          return true;
        });
        return found ? { ...found } : null;
      }),
      update: jest.fn(async (id: string, partial: any) => {
        const idx = commentsStore.findIndex((c) => c.id === id);
        if (idx !== -1) {
          commentsStore[idx] = { ...commentsStore[idx], ...partial };
        }
      }),
      findAndCount: jest.fn(async (opts?: any) => {
        let items = commentsStore.filter((c) => c.deletedAt === null);
        if (opts?.where?.status) {
          items = items.filter((c) => c.status === opts.where.status);
        }
        items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const skip = opts?.skip || 0;
        const take = opts?.take || 25;
        return [items.slice(skip, skip + take), items.length];
      }),
      createQueryBuilder: jest.fn(() => {
        let contentIdFilter: string | null = null;
        let userIdFilter: string | null = null;
        let cursorDateFilter: Date | null = null;
        let cursorIdFilter: string | null = null;
        let limitVal = 21;

        const qb: any = {
          where: jest.fn((clause: string, params: any) => {
            if (params?.contentId) contentIdFilter = params.contentId;
            return qb;
          }),
          andWhere: jest.fn((clause: string, params?: any) => {
            if (params?.userId) userIdFilter = params.userId;
            if (params?.cursorDate) {
              cursorDateFilter = new Date(params.cursorDate);
              cursorIdFilter = params.cursorId;
            }
            return qb;
          }),
          orderBy: jest.fn(() => qb),
          addOrderBy: jest.fn(() => qb),
          take: jest.fn((limit: number) => {
            limitVal = limit;
            return qb;
          }),
          getMany: jest.fn(async () => {
            let res = commentsStore.filter(
              (c) => c.deletedAt === null && c.parentId === null,
            );
            if (contentIdFilter) {
              res = res.filter((c) => c.contentId === contentIdFilter);
            }
            if (userIdFilter) {
              res = res.filter(
                (c) => c.status === 'APPROVED' || c.userId === userIdFilter,
              );
            }
            if (cursorDateFilter && cursorIdFilter) {
              const dateFilter = cursorDateFilter;
              const idFilter = cursorIdFilter;
              res = res.filter(
                (c) =>
                  c.createdAt < dateFilter ||
                  (c.createdAt.getTime() === dateFilter.getTime() &&
                    c.id < idFilter),
              );
            }
            res.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return res.slice(0, limitVal);
          }),
        };
        return qb;
      }),
    };

    // In-memory Vote Repository
    const mockVoteRepo = {
      findOne: jest.fn(async (opts: any) => {
        return (
          votesStore.find(
            (v) =>
              v.userId === opts.where.userId &&
              v.commentId === opts.where.commentId,
          ) || null
        );
      }),
      create: jest.fn((dto: any) => ({
        userId: dto.userId,
        commentId: dto.commentId,
        createdAt: new Date(),
      })),
      save: jest.fn(async (entity: CommentVoteOrmEntity) => {
        votesStore.push(entity);
        return entity;
      }),
      delete: jest.fn(async (criteria: any) => {
        votesStore = votesStore.filter(
          (v) =>
            !(
              v.userId === criteria.userId &&
              v.commentId === criteria.commentId
            ),
        );
      }),
    };

    // In-memory Question Repository
    const mockQuestionRepo = {
      create: jest.fn((dto: any) => ({
        id: dto.id || randomUUID(),
        contentId: dto.contentId ?? null,
        userId: dto.userId,
        title: dto.title,
        body: dto.body ?? null,
        status: dto.status ?? 'PENDING',
        isAnswered: dto.isAnswered ?? false,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn(async (entity: QuestionOrmEntity) => {
        questionsStore.push(entity);
        return entity;
      }),
      findOne: jest.fn(async (opts?: any) => {
        const id = opts?.where?.id;
        return questionsStore.find((q) => q.id === id && q.deletedAt === null) || null;
      }),
      update: jest.fn(async (id: string, partial: any) => {
        const idx = questionsStore.findIndex((q) => q.id === id);
        if (idx !== -1) {
          questionsStore[idx] = { ...questionsStore[idx], ...partial };
        }
      }),
      findAndCount: jest.fn(async (opts?: any) => {
        let items = questionsStore.filter((q) => q.deletedAt === null);
        if (opts?.where?.status) {
          items = items.filter((q) => q.status === opts.where.status);
        }
        items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        const skip = opts?.skip || 0;
        const take = opts?.take || 25;
        return [items.slice(skip, skip + take), items.length];
      }),
      createQueryBuilder: jest.fn(() => {
        let contentIdFilter: string | null = null;
        let answeredFilter: boolean | undefined = undefined;
        let limitVal = 21;

        const qb: any = {
          where: jest.fn(() => qb),
          andWhere: jest.fn((clause: string, params?: any) => {
            if (params?.contentId) contentIdFilter = params.contentId;
            if (params?.isAnswered !== undefined)
              answeredFilter = params.isAnswered;
            return qb;
          }),
          orderBy: jest.fn(() => qb),
          addOrderBy: jest.fn(() => qb),
          take: jest.fn((limit: number) => {
            limitVal = limit;
            return qb;
          }),
          getMany: jest.fn(async () => {
            let res = questionsStore.filter(
              (q) => q.deletedAt === null && q.status === 'APPROVED',
            );
            if (contentIdFilter) {
              res = res.filter((q) => q.contentId === contentIdFilter);
            }
            if (answeredFilter !== undefined) {
              res = res.filter((q) => q.isAnswered === answeredFilter);
            }
            res.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
            return res.slice(0, limitVal);
          }),
        };
        return qb;
      }),
    };

    // In-memory Answer Repository
    const mockAnswerRepo = {
      create: jest.fn((dto: any) => ({
        id: dto.id || randomUUID(),
        questionId: dto.questionId,
        userId: dto.userId,
        body: dto.body,
        isAccepted: dto.isAccepted ?? false,
        answeredByRole: dto.answeredByRole ?? 'User',
        status: dto.status ?? 'PENDING',
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),
      save: jest.fn(async (entity: AnswerOrmEntity) => {
        answersStore.push(entity);
        return entity;
      }),
      find: jest.fn(async (opts?: any) => {
        return answersStore.filter(
          (a) => a.questionId === opts?.where?.questionId && a.deletedAt === null,
        );
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        PassportModule.register({ defaultStrategy: 'jwt' }),
        JwtModule.register({}),
      ],
      controllers: [
        CommentsController,
        QuestionsController,
        AdminModerationController,
      ],
      providers: [
        CommentService,
        QuestionService,
        QaFeatureGuard,
        RolesGuard,
        JwtStrategy,
        JwtRs256Adapter,
        { provide: ConfigService, useValue: mockConfigService },
        { provide: USER_REPOSITORY, useValue: buildMockUserRepo({
          [user1Id]: 'User',
          [user2Id]: 'User',
          [moderatorId]: 'Moderator',
          [adminId]: 'Admin',
        }) },
        {
          provide: getRepositoryToken(CommentOrmEntity),
          useValue: mockCommentRepo,
        },
        {
          provide: getRepositoryToken(CommentVoteOrmEntity),
          useValue: mockVoteRepo,
        },
        {
          provide: getRepositoryToken(QuestionOrmEntity),
          useValue: mockQuestionRepo,
        },
        {
          provide: getRepositoryToken(AnswerOrmEntity),
          useValue: mockAnswerRepo,
        },
        { provide: APP_GUARD, useClass: BypassThrottlerGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new GlobalExceptionFilter());
    app.useGlobalInterceptors(new TraceIdInterceptor());

    await app.init();

    jwtAdapter = moduleFixture.get<JwtRs256Adapter>(JwtRs256Adapter);

    user1Token = await jwtAdapter.signAccessToken({
      sub: user1Id,
      email: 'user1@example.com',
      role: 'User',
      sessionId: randomUUID(),
    });
    user2Token = await jwtAdapter.signAccessToken({
      sub: user2Id,
      email: 'user2@example.com',
      role: 'User',
      sessionId: randomUUID(),
    });
    moderatorToken = await jwtAdapter.signAccessToken({
      sub: moderatorId,
      email: 'moderator@example.com',
      role: 'Moderator',
      sessionId: randomUUID(),
    });
    adminToken = await jwtAdapter.signAccessToken({
      sub: adminId,
      email: 'admin@example.com',
      role: 'Admin',
      sessionId: randomUUID(),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    commentsStore = [];
    votesStore = [];
    questionsStore = [];
    answersStore = [];
    qaFeatureEnabled = true;
    editWindowMinutes = 15;
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 1: Comments Endpoints & Logic (8 Scenarios)
  // ═════════════════════════════════════════════════════════════════════════════

  it('Scenario 1: POST /content/:contentId/comments creates a comment in PENDING status', async () => {
    const contentId = randomUUID();
    const res = await request(app.getHttpServer())
      .post(`/content/${contentId}/comments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ body: 'جزاكم الله خيراً على هذا المحتوى' })
      .expect(201);

    expect(res.body.data).toBeDefined();
    expect(res.body.data.body).toBe('جزاكم الله خيراً على هذا المحتوى');
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.upvotesCount).toBe(0);
    expect(res.body.data.userId).toBe(user1Id);
    expect(res.body.data.contentId).toBe(contentId);
  });

  it('Scenario 2: POST /content/:contentId/comments returns 401 when token is missing', async () => {
    const contentId = randomUUID();
    await request(app.getHttpServer())
      .post(`/content/${contentId}/comments`)
      .send({ body: 'تعليق بلا توكن' })
      .expect(401);
  });

  it('Scenario 3: GET /content/:contentId/comments returns APPROVED comments + own PENDING comments for regular user', async () => {
    const contentId = randomUUID();

    // 1. Approved comment from user2
    commentsStore.push({
      id: randomUUID(),
      contentId,
      userId: user2Id,
      parentId: null,
      body: 'تعليق معتمد من مستخدم آخر',
      upvotesCount: 3,
      status: 'APPROVED',
      moderatedBy: moderatorId,
      moderatedAt: new Date(),
      deletedAt: null,
      createdAt: new Date(Date.now() - 10000),
      updatedAt: new Date(),
    });

    // 2. Pending comment from user1 (owner)
    commentsStore.push({
      id: randomUUID(),
      contentId,
      userId: user1Id,
      parentId: null,
      body: 'تعليقي قيد المراجعة',
      upvotesCount: 0,
      status: 'PENDING',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(Date.now() - 5000),
      updatedAt: new Date(),
    });

    // 3. Pending comment from user2 (should NOT be visible to user1)
    commentsStore.push({
      id: randomUUID(),
      contentId,
      userId: user2Id,
      parentId: null,
      body: 'تعليق مستخدم 2 قيد المراجعة',
      upvotesCount: 0,
      status: 'PENDING',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get(`/content/${contentId}/comments`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.length).toBe(2);
    const bodies = res.body.data.map((c: any) => c.body);
    expect(bodies).toContain('تعليق معتمد من مستخدم آخر');
    expect(bodies).toContain('تعليقي قيد المراجعة');
    expect(bodies).not.toContain('تعليق مستخدم 2 قيد المراجعة');
  });

  it('Scenario 4: PATCH /comments/:id allows comment owner to update within edit window', async () => {
    const commentId = randomUUID();
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user1Id,
      parentId: null,
      body: 'النص الأصلي',
      upvotesCount: 0,
      status: 'PENDING',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(), // Just created
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ body: 'النص المعدل بعد التصحيح' })
      .expect(200);

    expect(res.body.data.body).toBe('النص المعدل بعد التصحيح');
  });

  it('Scenario 5: PATCH /comments/:id returns 403 when another user attempts to edit', async () => {
    const commentId = randomUUID();
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user1Id,
      parentId: null,
      body: 'تعليق المستخدم الأول',
      upvotesCount: 0,
      status: 'APPROVED',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ body: 'محاولة تعديل غير مصرح بها' })
      .expect(403);

    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('Scenario 6: PATCH /comments/:id returns 403 when edit window has expired', async () => {
    const commentId = randomUUID();
    // Created 30 minutes ago (window is 15 minutes)
    const thirtyMinutesAgo = new Date(Date.now() - 30 * 60 * 1000);
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user1Id,
      parentId: null,
      body: 'تعليق قديم',
      upvotesCount: 0,
      status: 'APPROVED',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: thirtyMinutesAgo,
      updatedAt: thirtyMinutesAgo,
    });

    const res = await request(app.getHttpServer())
      .patch(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ body: 'محاولة تعديل بعد انتهاء النافذة' })
      .expect(403);

    expect(res.body.error.message).toContain('expired');
  });

  it('Scenario 7: DELETE /comments/:id allows owner to soft-delete own comment', async () => {
    const commentId = randomUUID();
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user1Id,
      parentId: null,
      body: 'تعليق سيحذفه صاحبه',
      upvotesCount: 0,
      status: 'APPROVED',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .delete(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.message).toContain('deleted');
    expect(commentsStore[0].deletedAt).not.toBeNull();
  });

  it('Scenario 8: DELETE /comments/:id returns 403 when non-moderator other user attempts deletion, but 200 for Moderator', async () => {
    const commentId = randomUUID();
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user1Id,
      parentId: null,
      body: 'تعليق يملكه مستخدم 1',
      upvotesCount: 0,
      status: 'APPROVED',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 1. User 2 (regular User) tries to delete -> 403 FORBIDDEN
    await request(app.getHttpServer())
      .delete(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${user2Token}`)
      .expect(403);

    expect(commentsStore[0].deletedAt).toBeNull();

    // 2. Moderator tries to delete -> 200 OK (allowed for any comment)
    await request(app.getHttpServer())
      .delete(`/comments/${commentId}`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(commentsStore[0].deletedAt).not.toBeNull();
  });

  it('Scenario 9: POST /comments/:id/vote toggles upvote / unvote and updates counter', async () => {
    const commentId = randomUUID();
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user2Id,
      parentId: null,
      body: 'تعليق للتصويت',
      upvotesCount: 0,
      status: 'APPROVED',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 1. First click: Upvote
    const voteRes = await request(app.getHttpServer())
      .post(`/comments/${commentId}/vote`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(voteRes.body.data.voted).toBe(true);
    expect(voteRes.body.data.upvotesCount).toBe(1);

    // 2. Second click: Unvote (toggle)
    const unvoteRes = await request(app.getHttpServer())
      .post(`/comments/${commentId}/vote`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(unvoteRes.body.data.voted).toBe(false);
    expect(unvoteRes.body.data.upvotesCount).toBe(0);
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 2: Q&A Endpoints & Logic (5 Scenarios)
  // ═════════════════════════════════════════════════════════════════════════════

  it('Scenario 10: POST /questions creates question in PENDING status (title only, body optional)', async () => {
    const res = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({
        title: 'ما هو حكم قراءة سورة الكهف يوم الجمعة؟',
      })
      .expect(201);

    expect(res.body.data.id).toBeDefined();
    expect(res.body.data.title).toBe('ما هو حكم قراءة سورة الكهف يوم الجمعة؟');
    expect(res.body.data.body).toBeNull();
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.isAnswered).toBe(false);
  });

  it('Scenario 11: GET /questions returns APPROVED questions with optional contentId filter', async () => {
    const contentId = randomUUID();
    questionsStore.push({
      id: randomUUID(),
      contentId,
      userId: user1Id,
      title: 'سؤال خاص بهذه المحاضرة',
      body: 'تفاصيل السؤال',
      status: 'APPROVED',
      isAnswered: false,
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    questionsStore.push({
      id: randomUUID(),
      contentId: null,
      userId: user2Id,
      title: 'سؤال عام غير مرتبط بمحتوى',
      body: null,
      status: 'APPROVED',
      isAnswered: true,
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get(`/questions?contentId=${contentId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.length).toBe(1);
    expect(res.body.data[0].title).toBe('سؤال خاص بهذه المحاضرة');
  });

  it('Scenario 12: POST /questions/:id/answers creates answer with answered_by_role captured from JWT', async () => {
    const questionId = randomUUID();
    questionsStore.push({
      id: questionId,
      contentId: null,
      userId: user1Id,
      title: 'سؤال ينتظر إجابة المشرف',
      body: null,
      status: 'APPROVED',
      isAnswered: false,
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .post(`/questions/${questionId}/answers`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ body: 'الجواب مفصل وموثق بالأدلة...' })
      .expect(201);

    expect(res.body.data.body).toBe('الجواب مفصل وموثق بالأدلة...');
    expect(res.body.data.answeredByRole).toBe('Moderator');
    expect(res.body.data.status).toBe('PENDING');
  });

  it('Scenario 13: GET /questions/:id returns question with its answers', async () => {
    const questionId = randomUUID();
    questionsStore.push({
      id: questionId,
      contentId: null,
      userId: user1Id,
      title: 'سؤال مع إجابته',
      body: 'شرح السؤال',
      status: 'APPROVED',
      isAnswered: true,
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    answersStore.push({
      id: randomUUID(),
      questionId,
      userId: moderatorId,
      body: 'الإجابة الأولى',
      isAccepted: true,
      answeredByRole: 'Moderator',
      status: 'APPROVED',
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app.getHttpServer())
      .get(`/questions/${questionId}`)
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(200);

    expect(res.body.data.title).toBe('سؤال مع إجابته');
    expect(res.body.data.answers.length).toBe(1);
    expect(res.body.data.answers[0].body).toBe('الإجابة الأولى');
  });

  it('Scenario 14: QaFeatureGuard returns 503 SERVICE_UNAVAILABLE when feature_flag.qa is disabled', async () => {
    qaFeatureEnabled = false; // Disable QA flag

    const res = await request(app.getHttpServer())
      .get('/questions')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(503);

    expect(res.body.error.code).toBe('QA_FEATURE_DISABLED');
  });

  // ═════════════════════════════════════════════════════════════════════════════
  // SECTION 3: Admin Moderation Endpoints & RBAC (3 Scenarios)
  // ═════════════════════════════════════════════════════════════════════════════

  it('Scenario 15: Moderation endpoints return 403 FORBIDDEN for regular User, but 200 for Moderator/Admin', async () => {
    // 1. Regular User tries to access moderation -> 403
    await request(app.getHttpServer())
      .get('/admin/moderation/comments?status=PENDING')
      .set('Authorization', `Bearer ${user1Token}`)
      .expect(403);

    // 2. Moderator accesses moderation -> 200 with offset pagination
    const modRes = await request(app.getHttpServer())
      .get('/admin/moderation/comments?status=PENDING&page=1&limit=25')
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(modRes.body.data).toBeDefined();
    expect(modRes.body.meta.page).toBe(1);
    expect(modRes.body.meta.limit).toBe(25);
  });

  it('Scenario 16: Moderator approves, rejects, and flags comments', async () => {
    const commentId = randomUUID();
    commentsStore.push({
      id: commentId,
      contentId: randomUUID(),
      userId: user1Id,
      parentId: null,
      body: 'تعليق للمراجعة الإدارية',
      upvotesCount: 0,
      status: 'PENDING',
      moderatedBy: null,
      moderatedAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 1. Approve
    const approveRes = await request(app.getHttpServer())
      .post(`/admin/moderation/comments/${commentId}/approve`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .expect(200);

    expect(approveRes.body.data.status).toBe('APPROVED');
    expect(approveRes.body.data.moderatedBy).toBe(moderatorId);

    // 2. Flag
    const flagRes = await request(app.getHttpServer())
      .post(`/admin/moderation/comments/${commentId}/flag`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(flagRes.body.data.status).toBe('FLAGGED');

    // 3. Reject (with optional reason in body)
    const rejectRes = await request(app.getHttpServer())
      .post(`/admin/moderation/comments/${commentId}/reject`)
      .set('Authorization', `Bearer ${moderatorToken}`)
      .send({ reason: 'مخالف للشروط' })
      .expect(200);

    expect(rejectRes.body.data.status).toBe('REJECTED');
  });
});
