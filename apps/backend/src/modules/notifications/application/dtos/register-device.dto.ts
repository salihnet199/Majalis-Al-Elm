import { IsString, IsNotEmpty, IsOptional, IsIn } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterDeviceDto {
  @ApiProperty({ description: 'FCM push registration token' })
  @IsString()
  @IsNotEmpty()
  fcmToken!: string;

  @ApiPropertyOptional({ description: 'Human-readable device name', example: 'iPhone 15 Pro' })
  @IsString()
  @IsOptional()
  deviceName?: string;

  @ApiProperty({ description: 'Device operating system platform', enum: ['android', 'ios'] })
  @IsString()
  @IsIn(['android', 'ios'])
  platform!: 'android' | 'ios';
}
