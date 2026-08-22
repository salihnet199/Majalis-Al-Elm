import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * RolesGuard — BC05
 *
 * Must be applied AFTER JwtAuthGuard (which sets req.user).
 * Reads the @Roles(...roles) metadata set on the handler / class and
 * compares against the `role` claim from the verified JWT payload.
 *
 * If no @Roles() metadata is found, the guard passes (open to any authenticated user).
 *
 * Usage:
 *   @UseGuards(JwtAuthGuard, RolesGuard)
 *   @Roles('Admin', 'SuperAdmin')
 *   myProtectedEndpoint() { ... }
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // No @Roles() decorator — allow any authenticated user
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{
      user?: { sub: string; role: string };
    }>();
    const userRole = request.user?.role;

    if (!userRole || !requiredRoles.includes(userRole)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: `Access denied. Required role(s): ${requiredRoles.join(', ')}`,
      });
    }

    return true;
  }
}
