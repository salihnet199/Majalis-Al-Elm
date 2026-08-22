import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { NotificationService } from '../application/notification.service';

@ApiTags('Notifications — In-App Center')
@Controller('notifications')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class NotificationsController {
  constructor(private readonly notificationService: NotificationService) {}

  @Get()
  @ApiOperation({ summary: 'List notifications with cursor pagination and total unreadCount' })
  @ApiResponse({ status: 200, description: 'Paginated user notifications' })
  async listNotifications(
    @Req() req: { user: JwtPayload },
    @Query('limit') limitStr?: string,
    @Query('cursor') cursor?: string,
    @Query('unreadOnly') unreadOnlyStr?: string,
  ) {
    const limit = Math.min(Math.max(parseInt(limitStr || '20', 10), 1), 100);
    const unreadOnly = unreadOnlyStr === 'true';
    return this.notificationService.list(req.user.sub, limit, cursor, unreadOnly);
  }

  @Patch(':id/read')
  @ApiOperation({ summary: 'Mark specific notification as read' })
  @ApiResponse({ status: 200, description: 'Notification marked as read' })
  async markAsRead(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    return this.notificationService.markAsRead(id, req.user);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Mark all unread notifications as read for current user' })
  @ApiResponse({ status: 200, description: 'All notifications marked as read' })
  async markAllAsRead(@Req() req: { user: JwtPayload }) {
    return this.notificationService.markAllAsRead(req.user.sub);
  }
}
