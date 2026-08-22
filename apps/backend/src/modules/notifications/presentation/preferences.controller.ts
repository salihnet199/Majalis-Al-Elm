import {
  Controller,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { PreferenceService } from '../application/preference.service';
import { UpdatePreferencesDto } from '../application/dtos/update-preferences.dto';

@ApiTags('Notifications — Preferences')
@Controller('notifications/preferences')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class PreferencesController {
  constructor(private readonly preferenceService: PreferenceService) {}

  @Get()
  @ApiOperation({ summary: 'Get notification preferences for current user' })
  @ApiResponse({ status: 200, description: 'User notification preferences' })
  async getPreferences(@Req() req: { user: JwtPayload }) {
    const data = await this.preferenceService.getPreferences(req.user.sub);
    return { data };
  }

  @Patch()
  @ApiOperation({ summary: 'Update notification preferences for current user' })
  @ApiResponse({ status: 200, description: 'Updated notification preferences' })
  async updatePreferences(
    @Body() dto: UpdatePreferencesDto,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.preferenceService.updatePreferences(req.user.sub, dto);
    return { data };
  }
}
