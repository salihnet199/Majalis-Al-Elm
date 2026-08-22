import { User } from '../user.entity';

/**
 * IUserRepository — Domain Port (Interface)
 *
 * P-06: Repository interfaces live in the Domain layer.
 * The TypeORM implementation lives in infrastructure/persistence/.
 *
 * The Domain layer NEVER imports from infrastructure. DI container
 * wires the concrete implementation at runtime.
 */
export interface IUserRepository {
  /** Find a user by their UUID — returns null if not found or soft-deleted */
  findById(id: string): Promise<User | null>;

  /** Find an active (non-deleted) user by email (case-insensitive — CITEXT) */
  findByEmail(email: string): Promise<User | null>;

  /** Find an active (non-deleted) user by phone E.164 */
  findByPhone(phoneE164: string): Promise<User | null>;

  /** Check if an email is already registered (active user) */
  existsByEmail(email: string): Promise<boolean>;

  /** Check if a phone is already registered (active user) */
  existsByPhone(phoneE164: string): Promise<boolean>;

  /** Persist a new user. Returns the saved user with DB-generated id. */
  save(user: User): Promise<User>;

  /** Find an active user by ID, explicitly selecting passwordHash (normally excluded) */
  findByIdWithPassword(id: string): Promise<User | null>;

  /** Update an existing user */
  update(user: User): Promise<User>;

  /** Assign role to user */
  assignRole(userId: string, roleName: string): Promise<void>;

  /** Get the primary role name for a user */
  getPrimaryRole(userId: string): Promise<string>;

  /**
   * Admin: paginated listing of ALL non-deleted users, ordered by created_at DESC.
   * Used by BC05 AdminUsersController — no direct TypeORM import allowed (ADR-002).
   *
   * @param page  1-based page number
   * @param limit Max rows per page (capped at 100 by controller)
   */
  findAllPaginated(
    page: number,
    limit: number,
  ): Promise<{
    data: {
      id: string;
      fullName: string;
      email: string | null;
      phoneE164: string | null;
      isSuspended: boolean;
      createdAt: Date;
      role: string;
    }[];
    meta: { total: number; page: number; limit: number; totalPages: number };
  }>;
}

/** DI token for the repository interface */
export const USER_REPOSITORY = Symbol('IUserRepository');
