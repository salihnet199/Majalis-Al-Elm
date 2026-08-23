import { UnauthorizedException } from '@nestjs/common';
import { JwtPayload } from '../../identity/infrastructure/adapters/jwt-rs256.adapter';

/**
 * The authenticated user id to record as `created_by` / `edited_by`.
 *
 * POLICY-SEC-001 category 1 — fabricated identity. Every admin write handler in
 * this module used to read:
 *
 *     const userId = req.user?.sub || '00000000-0000-7000-8000-000000000000';
 *
 * so a request that reached a handler without an authenticated principal
 * attributed the write — the content item, the category, the author, and every
 * translation row underneath — to a user that does not exist. Two distinct
 * failures follow from that one line:
 *
 *   • The audit trail names an id no human owns, and it names it identically for
 *     every unattributed write, so the forgeries are indistinguishable from each
 *     other and from a real actor.
 *   • `created_by` REFERENCES id_users, so the write either violates the foreign
 *     key at runtime — a 500 in front of an editor, far from its cause — or
 *     succeeds because someone inserted a placeholder user to stop the errors.
 *
 * `JwtAuthGuard` runs before every one of these handlers, so an absent `sub` is
 * not a case to be handled with a default: it means the guard's contract broke.
 * That is a 401 worth investigating, and one shared implementation so the
 * fallback cannot quietly return to one handler out of seven.
 */
export function requireActorId(req: { user?: JwtPayload }): string {
  const actorId = req.user?.sub;
  if (!actorId) {
    throw new UnauthorizedException({
      code: 'UNAUTHENTICATED',
      message: 'An authenticated user is required for this operation',
    });
  }
  return actorId;
}
