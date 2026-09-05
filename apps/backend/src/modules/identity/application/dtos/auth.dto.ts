import { IsEmail, IsString, MinLength, MaxLength, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LoginEmailDto {
  @ApiProperty({ example: 'ahmed@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123!' })
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  password!: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  refreshToken!: string;
}

export class LogoutDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  @MaxLength(4096)
  refreshToken?: string;
}


export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(128)
  currentPassword!: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  newPassword!: string;
}

export class SocialLoginDto {
  @ApiProperty({ description: 'OAuth ID Token from Google or Apple' })
  @IsString()
  @MinLength(1)
  idToken!: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  authorizationCode?: string;
}
