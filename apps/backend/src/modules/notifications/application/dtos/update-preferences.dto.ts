import { IsArray, ValidateNested, IsEnum, IsString, IsNotEmpty, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationChannel } from '../../domain/models/notification-enums';

export class PreferenceItemDto {
  @ApiProperty({ enum: NotificationChannel })
  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @ApiProperty({ example: 'new_content' })
  @IsString()
  @IsNotEmpty()
  category!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  isEnabled!: boolean;
}

export class UpdatePreferencesDto {
  @ApiProperty({ type: [PreferenceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PreferenceItemDto)
  preferences!: PreferenceItemDto[];
}
