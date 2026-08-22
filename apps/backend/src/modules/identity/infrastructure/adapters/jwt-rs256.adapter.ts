import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { readFileSync } from 'fs';

export interface JwtPayload {
  sub: string;        // user UUID
  email: string | null;
  role: string;
  sessionId: string;  // id_refresh_tokens.id — API-DESIGN v1.1.0
  iat?: number;
  exp?: number;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;   // access token TTL in seconds
  tokenType: 'Bearer';
  sessionId: string;
}

export const JWT_ADAPTER = Symbol('IJwtAdapter');

/**
 * JwtRs256Adapter — Infrastructure Adapter
 *
 * ADR-008: JWT RS256 + Rotating Refresh Tokens
 * - Access tokens: RS256 signed, 15 min TTL (JWT_ACCESS_TOKEN_TTL)
 * - Refresh tokens: RS256 signed, 7 day TTL (JWT_REFRESH_TOKEN_TTL)
 *   token_family tracked in DB for reuse detection (ADR-008 §Reuse Detection)
 *
 * Key loading: supports both file path (Docker secrets) and inline env var (dev).
 */
@Injectable()
export class JwtRs256Adapter {
  private readonly privateKey: string;
  private readonly publicKey: string;
  private readonly accessTokenTtl: number;
  private readonly refreshTokenTtl: number;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.accessTokenTtl = this.configService.get<number>('jwt.accessTokenTtl', 900);
    this.refreshTokenTtl = this.configService.get<number>('jwt.refreshTokenTtl', 604800);
    this.privateKey = this.loadKey('private');
    this.publicKey = this.loadKey('public');
  }

  private loadKey(type: 'private' | 'public'): string {
    const pathKey = type === 'private' ? 'jwt.privateKeyPath' : 'jwt.publicKeyPath';
    const inlineKey = type === 'private' ? 'jwt.privateKey' : 'jwt.publicKey';

    const filePath = this.configService.get<string>(pathKey);
    if (filePath) {
      try {
        return readFileSync(filePath, 'utf-8').trim();
      } catch {
        throw new Error(`JWT ${type} key file not found: ${filePath}`);
      }
    }

    const inline = this.configService.get<string>(inlineKey);
    if (inline) {
      return inline.replace(/\\n/g, '\n');
    }

    if (process.env.NODE_ENV === 'test') {
      // Test environments use HS256 with a symmetric secret for simplicity
      return 'test-secret-not-for-production';
    }

    throw new Error(`JWT ${type} key is required. Set JWT_${type.toUpperCase()}_KEY_PATH or JWT_${type.toUpperCase()}_KEY.`);
  }

  async signAccessToken(payload: JwtPayload): Promise<string> {
    const isTest = process.env.NODE_ENV === 'test';
    return this.jwtService.signAsync(
      { sub: payload.sub, email: payload.email, role: payload.role, sessionId: payload.sessionId },
      {
        algorithm: isTest ? 'HS256' : 'RS256',
        ...(isTest ? { secret: this.privateKey } : { privateKey: this.privateKey }),
        expiresIn: this.accessTokenTtl,
      },
    );
  }

  async signRefreshToken(payload: Pick<JwtPayload, 'sub' | 'sessionId'>): Promise<string> {
    const isTest = process.env.NODE_ENV === 'test';
    return this.jwtService.signAsync(
      { sub: payload.sub, sessionId: payload.sessionId, type: 'refresh' },
      {
        algorithm: isTest ? 'HS256' : 'RS256',
        ...(isTest ? { secret: this.privateKey } : { privateKey: this.privateKey }),
        expiresIn: this.refreshTokenTtl,
      },
    );
  }

  async verifyAccessToken(token: string): Promise<JwtPayload> {
    const isTest = process.env.NODE_ENV === 'test';
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token, {
        algorithms: isTest ? ['HS256'] : ['RS256'],
        ...(isTest ? { secret: this.publicKey } : { publicKey: this.publicKey }),
      });
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'Access token is invalid or expired' });
    }
  }

  async verifyRefreshToken(token: string): Promise<{ sub: string; sessionId: string }> {
    const isTest = process.env.NODE_ENV === 'test';
    try {
      const payload = await this.jwtService.verifyAsync<{ sub: string; sessionId: string; type: string }>(token, {
        algorithms: isTest ? ['HS256'] : ['RS256'],
        ...(isTest ? { secret: this.publicKey } : { publicKey: this.publicKey }),
      });
      if (payload.type !== 'refresh') {
        throw new Error('Not a refresh token');
      }
      return { sub: payload.sub, sessionId: payload.sessionId };
    } catch {
      throw new UnauthorizedException({ code: 'AUTH_TOKEN_EXPIRED', message: 'Refresh token is invalid or expired' });
    }
  }

  getRefreshTokenTtl(): number {
    return this.refreshTokenTtl;
  }
}
