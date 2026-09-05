import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { JwtPayload } from '../adapters/jwt-rs256.adapter';
import { TEST_ONLY_JWT_SECRET } from '../../../../shared/infrastructure/config/jwt-key-integrity';
import { IUserRepository, USER_REPOSITORY } from '../../domain/ports/user.repository';

/**
 * JwtStrategy — Passport Strategy for JWT RS256 verification
 *
 * ADR-008: Access tokens are RS256 signed.
 * - Extracts the Bearer token from the Authorization header.
 * - Verifies the signature using the RS256 public key.
 * - The validated payload is attached to req.user by Passport.
 *
 * Key loading mirrors JwtRs256Adapter logic: file path > inline > test fallback.
 * Test environments fall back to HS256 with a symmetric secret.
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    configService: ConfigService,
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
  ) {
    const isTest = process.env.NODE_ENV === 'test';
    const publicKey = JwtStrategy.resolvePublicKey(configService, isTest);

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: publicKey,
      algorithms: isTest ? ['HS256'] : ['RS256'],
    });
  }

  /**
   * Resolves the public key used for token verification.
   * Mirrors the same loading logic as JwtRs256Adapter to stay consistent.
   */
  private static resolvePublicKey(
    config: ConfigService,
    isTest: boolean,
  ): string {
    const filePath = config.get<string>('jwt.publicKeyPath');
    if (filePath) {
      try {
        return readFileSync(filePath, 'utf-8').trim();
      } catch {
        throw new Error(`JWT public key file not found: ${filePath}`);
      }
    }

    const inline = config.get<string>('jwt.publicKey');
    if (inline) {
      return inline.replace(/\\n/g, '\n');
    }

    if (isTest) {
      // Shares the symmetric secret with JwtRs256Adapter. Reachable ONLY under
      // NODE_ENV=test — outside it the boot aborts before Passport is
      // constructed (POLICY-SEC-001, TECH-DEBT-013).
      return TEST_ONLY_JWT_SECRET;
    }

    throw new Error(
      'JWT_PUBLIC_KEY_PATH or JWT_PUBLIC_KEY is required. ' +
        'Run scripts/gen-jwt-keys.sh to generate development keys.',
    );
  }

  /**
   * Called by Passport after successful signature verification.
   * The returned value is attached to req.user.
   *
   * The JWT signature remains the first trust boundary; the active-user lookup
   * is the second boundary so suspension/deletion/role changes take effect
   * immediately instead of waiting for token expiry.
   */
  async validate(payload: JwtPayload): Promise<{
    sub: string;
    email: string | null;
    role: string;
    sessionId: string;
  }> {
    // Access tokens are signed and short-lived, but account state can change
    // before token expiry (suspension, soft-delete, or role changes). A lightweight
    // active-user lookup makes revocation of account access effective immediately.
    const user = await this.userRepo.findById(payload.sub);
    if (!user || user.isSuspended || user.isDeleted) {
      throw new UnauthorizedException({
        code: user?.isSuspended ? 'AUTH_ACCOUNT_SUSPENDED' : 'AUTH_TOKEN_EXPIRED',
        message: user?.isSuspended ? 'Account is suspended' : 'Access token is no longer valid',
      });
    }

    const role = await this.userRepo.getPrimaryRole(payload.sub);
    return {
      sub: payload.sub,
      email: user.email?.value ?? null,
      role,
      sessionId: payload.sessionId,
    };
  }
}
