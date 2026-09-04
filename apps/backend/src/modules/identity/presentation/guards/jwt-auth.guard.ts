import { Injectable, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Shape Passport attaches to req.user after JwtStrategy#validate() succeeds
 * (see jwt.strategy.ts). Kept here rather than imported to avoid a
 * presentation -> infrastructure dependency for a 4-field type.
 */
export interface AuthenticatedUser {
  sub: string;
  email: string | null;
  role: string;
  sessionId: string;
}

/**
 * JwtAuthGuard — protects all routes by default.
 *
 * Mark a route as public using @Public() decorator.
 * /health and /ready bypass this guard via AppModule controller ordering.
 *
 * ADR-008: JWT RS256 access token verification
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = AuthenticatedUser>(err: Error | null, user: TUser): TUser {
    if (err || !user) {
      throw new UnauthorizedException({
        code: 'AUTH_MISSING_TOKEN',
        message: 'Authentication required',
      });
    }
    return user;
  }
}
