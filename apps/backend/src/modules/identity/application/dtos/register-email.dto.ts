import { IsEmail, IsString, MinLength, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * RegisterWithEmailDto
 *
 * Input validation at the API boundary (Presentation layer).
 * Zod schema in handler provides additional domain-level validation.
 * class-validator provides fast DTO-level checks via ValidationPipe (whitelist:true).
 */
export class RegisterWithEmailDto {
  @ApiProperty({ example: 'أحمد محمد' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  fullName!: string;

  @ApiProperty({ example: 'ahmed@example.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePass123!', minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password!: string;
}
