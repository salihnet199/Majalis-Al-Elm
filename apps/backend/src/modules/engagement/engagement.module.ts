import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommentOrmEntity } from './infrastructure/persistence/entities/comment.orm-entity';
import { CommentVoteOrmEntity } from './infrastructure/persistence/entities/comment-vote.orm-entity';
import { QuestionOrmEntity } from './infrastructure/persistence/entities/question.orm-entity';
import { AnswerOrmEntity } from './infrastructure/persistence/entities/answer.orm-entity';
import { CommentService } from './application/comment.service';
import { QuestionService } from './application/question.service';
import { CommentsController } from './presentation/comments.controller';
import { QuestionsController } from './presentation/questions.controller';
import { AdminModerationController } from './presentation/admin-moderation.controller';
import { QaFeatureGuard } from './presentation/guards/qa-feature.guard';
import { RolesGuard } from './presentation/guards/roles.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommentOrmEntity,
      CommentVoteOrmEntity,
      QuestionOrmEntity,
      AnswerOrmEntity,
    ]),
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
  ],
  exports: [
    CommentService,
    QuestionService,
  ],
})
export class EngagementModule {}
