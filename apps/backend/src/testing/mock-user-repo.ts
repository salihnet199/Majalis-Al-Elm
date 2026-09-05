import { IUserRepository } from '../modules/identity/domain/ports/user.repository';
import { User } from '../modules/identity/domain/user.entity';

/**
 * Builds a minimal IUserRepository mock for integration tests that spin up
 * JwtStrategy directly (rather than the full IdentityModule).
 *
 * JwtStrategy#validate() now looks up the active user on every authenticated
 * request (suspension/soft-delete take effect immediately instead of waiting
 * for token expiry — see jwt.strategy.ts). Any test module that provides
 * JwtStrategy must therefore also provide USER_REPOSITORY, or Nest fails to
 * resolve the strategy's constructor dependency.
 *
 * @param roleById map of user id -> role name, for every actor the test signs
 *                 a token for. Unknown ids resolve to an active user with an
 *                 empty role rather than throwing, so a forgotten id fails
 *                 the specific assertion instead of blowing up test setup.
 * @param suspendedIds optional set of ids that should be treated as suspended
 *                 (for tests exercising the suspension-takes-effect-immediately
 *                 behavior).
 */
export function buildMockUserRepo(
  roleById: Record<string, string>,
  suspendedIds: string[] = [],
): Partial<IUserRepository> {
  const suspended = new Set(suspendedIds);

  return {
    async findById(id: string) {
      return User.reconstitute({
        id,
        fullName: 'Test User',
        email: null,
        phoneE164: '+10000000000',
        passwordHash: null,
        locale: 'ar',
        theme: 'system',
        audioSpeed: 1.0,
        isSuspended: suspended.has(id),
        suspendedAt: suspended.has(id) ? new Date() : null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    },
    async getPrimaryRole(userId: string) {
      return roleById[userId] ?? '';
    },
  };
}
