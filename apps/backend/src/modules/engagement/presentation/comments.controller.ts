import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { CommentService } from '../application/comment.service';
import { CreateCommentDto } from '../application/dtos/create-comment.dto';
import { UpdateCommentDto } from '../application/dtos/update-comment.dto';

@ApiTags('Engagement — Comments')
@Controller()
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class CommentsController {
  constructor(
    private readonly commentService: CommentService,
    private readonly configService: ConfigService,
  ) {}

  @Get('content/:contentId/comments')
  @ApiOperation({ summary: 'List comments for a content item with cursor pagination' })
  @ApiResponse({ status: 200, description: 'Paginated comments list' })
  async listComments(
    @Param('contentId') contentId: string,
    @Req() req: { user: JwtPayload },
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10), 1), 100);
    return this.commentService.list(contentId, req.user, limit, cursor);
  }

  @Post('content/:contentId/comments')
  @ApiOperation({ summary: 'Add a new comment to a content item' })
  @ApiResponse({ status: 201, description: 'Comment created in PENDING status' })
  async createComment(
    @Param('contentId') contentId: string,
    @Body() dto: CreateCommentDto,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.commentService.create(contentId, dto, req.user);
    return { data };
  }

  @Patch('comments/:id')
  @ApiOperation({ summary: 'Edit own comment within allowed time window' })
  @ApiResponse({ status: 200, description: 'Comment updated' })
  async updateComment(
    @Param('id') id: string,
    @Body() dto: UpdateCommentDto,
    @Req() req: { user: JwtPayload },
  ) {
    const editWindow = this.configService.get<number>('comment.edit_window_minutes', 15);
    const data = await this.commentService.update(id, dto, req.user, Number(editWindow));
    return { data };
  }

  @Delete('comments/:id')
  @ApiOperation({ summary: 'Delete comment (owner or Moderator+)' })
  @ApiResponse({ status: 200, description: 'Comment soft-deleted' })
  async deleteComment(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    await this.commentService.delete(id, req.user);
    return { data: { message: 'Comment deleted successfully' } };
  }

  @Post('comments/:id/vote')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Toggle upvote on a comment' })
  @ApiResponse({ status: 200, description: 'Vote toggled' })
  async voteComment(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    return this.commentService.toggleVote(id, req.user);
  }
}
