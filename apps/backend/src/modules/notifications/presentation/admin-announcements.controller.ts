import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { RolesGuard } from './guards/roles.guard';
import { Roles } from './decorators/roles.decorator';
import { AnnouncementService } from '../application/announcement.service';
import { CreateAnnouncementDto } from '../application/dtos/create-announcement.dto';

@ApiTags('Admin — Announcements')
@Controller('admin/announcements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('Admin', 'SuperAdmin')
@ApiBearerAuth()
export class AdminAnnouncementsController {
  constructor(private readonly announcementService: AnnouncementService) {}

  @Post()
  @ApiOperation({ summary: 'Create and broadcast system announcement' })
  @ApiResponse({ status: 201, description: 'Announcement created and queued for delivery' })
  async createAnnouncement(
    @Body() dto: CreateAnnouncementDto,
    @Req() req: { user: JwtPayload },
  ) {
    return this.announcementService.create(dto, req.user);
  }

  @Get()
  @ApiOperation({ summary: 'List past announcements with offset pagination' })
  @ApiResponse({ status: 200, description: 'Paginated announcements list' })
  async listAnnouncements(
    @Query('page') pageStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    const page = Math.max(parseInt(pageStr || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(limitStr || '25', 10), 1), 100);
    return this.announcementService.list(page, limit);
  }
}
