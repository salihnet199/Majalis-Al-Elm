import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { readFileSync } from 'fs';
import { JwtPayload } from '../adapters/jwt-rs256.adapter';
import { TEST_ONLY_JWT_SECRET } from '../../../../shared/infrastructure/config/jwt-key-integrity';

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
  constructor(configService: ConfigService) {
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
   * No DB lookup — access tokens are self-contained (ADR-008).
   * DB lookup only on sensitive operations (e.g., change-password).
   */
  async validate(payload: JwtPayload): Promise<{
    sub: string;
    email: string | null;
    role: string;
    sessionId: string;
  }> {
    return {
      sub: payload.sub,
      email: payload.email ?? null,
      role: payload.role,
      sessionId: payload.sessionId,
    };
  }
}
