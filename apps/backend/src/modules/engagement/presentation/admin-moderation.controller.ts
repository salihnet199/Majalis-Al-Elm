import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { CommentService } from '../application/comment.service';
import { QuestionService } from '../application/question.service';
import { RejectCommentDto } from '../application/dtos/reject-comment.dto';

@ApiTags('Admin — Engagement Moderation')
@Controller('admin/moderation')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Moderator', 'Admin', 'SuperAdmin')
@ApiBearerAuth()
export class AdminModerationController {
  constructor(
    private readonly commentService: CommentService,
    private readonly questionService: QuestionService,
  ) {}

  // ── Comments Moderation ───────────────────────────────────────────────────
  @Get('comments')
  @ApiOperation({ summary: 'List comments pending moderation (offset pagination)' })
  @ApiResponse({ status: 200, description: 'Paginated comments list for moderation' })
  async listComments(
    @Query('status') status?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(parseInt(pageStr || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr || '25', 10), 1), 100);
    return this.commentService.listPending(status, page, limit);
  }

  @Post('comments/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a comment' })
  @ApiResponse({ status: 200, description: 'Comment approved' })
  async approveComment(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.commentService.moderate(id, 'APPROVED', req.user.sub);
    return { data };
  }

  @Post('comments/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a comment' })
  @ApiResponse({ status: 200, description: 'Comment rejected' })
  async rejectComment(
    @Param('id') id: string,
    @Body() _dto: RejectCommentDto,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.commentService.moderate(id, 'REJECTED', req.user.sub);
    return { data };
  }

  @Post('comments/:id/flag')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Flag a comment for further review' })
  @ApiResponse({ status: 200, description: 'Comment flagged' })
  async flagComment(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.commentService.moderate(id, 'FLAGGED', req.user.sub);
    return { data };
  }

  // ── Questions Moderation ──────────────────────────────────────────────────
  @Get('questions')
  @ApiOperation({ summary: 'List questions pending moderation (offset pagination)' })
  @ApiResponse({ status: 200, description: 'Paginated questions list for moderation' })
  async listQuestions(
    @Query('status') status?: string,
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(parseInt(pageStr || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr || '25', 10), 1), 100);
    return this.questionService.listPending(status, page, limit);
  }

  @Post('questions/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Approve a question' })
  @ApiResponse({ status: 200, description: 'Question approved' })
  async approveQuestion(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.questionService.moderate(id, 'APPROVED', req.user.sub);
    return { data };
  }

  @Post('questions/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reject a question' })
  @ApiResponse({ status: 200, description: 'Question rejected' })
  async rejectQuestion(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.questionService.moderate(id, 'REJECTED', req.user.sub);
    return { data };
  }
}
