import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { QaFeatureGuard } from './guards/qa-feature.guard';
import { QuestionService } from '../application/question.service';
import { CreateQuestionDto } from '../application/dtos/create-question.dto';
import { CreateAnswerDto } from '../application/dtos/create-answer.dto';

@ApiTags('Engagement — Q&A')
@Controller('questions')
@UseGuards(JwtAuthGuard, QaFeatureGuard)
@ApiBearerAuth()
export class QuestionsController {
  constructor(private readonly questionService: QuestionService) {}

  @Get()
  @ApiOperation({ summary: 'List questions with cursor pagination and optional filtering' })
  @ApiResponse({ status: 200, description: 'Paginated questions list' })
  async listQuestions(
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('contentId') contentId?: string,
    @Query('answered') answeredStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10), 1), 100);
    const answered = answeredStr !== undefined ? answeredStr === 'true' : undefined;
    return this.questionService.list(limit, cursor, contentId, answered);
  }

  @Post()
  @ApiOperation({ summary: 'Submit a new question' })
  @ApiResponse({ status: 201, description: 'Question created in PENDING status' })
  async createQuestion(
    @Body() dto: CreateQuestionDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.questionService.create(dto, req.user);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get question details and its approved answers',
    description:
      'Public detail view: only ever returns an APPROVED question with its APPROVED ' +
      'answers. Questions pending/rejected/flagged review 404 exactly like a missing id — ' +
      'moderators inspect those through the separate /admin/moderation/questions routes.',
  })
  @ApiResponse({ status: 200, description: 'Question with answers' })
  @ApiResponse({ status: 404, description: 'Question not found, not approved, or deleted' })
  async getQuestion(@Param('id') id: string) {
    return this.questionService.findPublicQuestion(id);
  }

  @Post(':id/answers')
  @ApiOperation({ summary: 'Submit an answer to a question' })
  @ApiResponse({ status: 201, description: 'Answer submitted in PENDING status' })
  async createAnswer(
    @Param('id') id: string,
    @Body() dto: CreateAnswerDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.questionService.createAnswer(id, dto, req.user);
  }
}
