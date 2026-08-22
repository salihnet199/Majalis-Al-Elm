import {
  Controller,
  Post,
  Delete,
  Param,
  Body,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../identity/presentation/guards/jwt-auth.guard';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';
import { DeviceService } from '../application/device.service';
import { RegisterDeviceDto } from '../application/dtos/register-device.dto';

@ApiTags('Notifications — Devices')
@Controller('notifications/devices')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class DevicesController {
  constructor(private readonly deviceService: DeviceService) {}

  @Post()
  @ApiOperation({ summary: 'Register or update device FCM token' })
  @ApiResponse({ status: 201, description: 'Device registered successfully' })
  async registerDevice(
    @Body() dto: RegisterDeviceDto,
    @Req() req: { user: JwtPayload },
  ) {
    const data = await this.deviceService.register(req.user.sub, dto);
    return { data };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Deregister / delete device on logout' })
  @ApiResponse({ status: 200, description: 'Device deregistered' })
  async deleteDevice(
    @Param('id') id: string,
    @Req() req: { user: JwtPayload },
  ) {
    await this.deviceService.deleteDevice(id, req.user);
    return { data: { message: 'Device deregistered successfully' } };
  }
}
