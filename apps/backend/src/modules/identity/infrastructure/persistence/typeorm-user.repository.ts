import { Injectable, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../domain/user.entity';
import { IUserRepository } from '../../domain/ports/user.repository';
import { UserOrmEntity } from './entities/user.orm-entity';
import { EmailAddress } from '../../../../shared/domain/email.vo';
import { UUIDv7 } from '../../../../shared/domain/uuid.vo';

/**
 * TypeOrmUserRepository — Infrastructure implementation of IUserRepository
 *
 * Maps between User domain aggregate and UserOrmEntity (DB row).
 * Domain layer never sees TypeORM — this is the anti-corruption layer.
 *
 * ADR-006: TypeORM 0.3.x repository pattern
 */
@Injectable()
export class TypeOrmUserRepository implements IUserRepository {
  constructor(
    @InjectRepository(UserOrmEntity)
    private readonly repo: Repository<UserOrmEntity>,
  ) {}

  async findById(id: string): Promise<User | null> {
    const orm = await this.repo.findOne({
      where: { id, deletedAt: undefined },
      relations: ['roles'],
    });
    return orm ? this.toDomain(orm) : null;
  }

  async findByEmail(email: string): Promise<User | null> {
    const orm = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.roles', 'r')
      .where('u.email = :email', { email: email.toLowerCase() })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
    return orm ? this.toDomain(orm) : null;
  }

  async findByPhone(phoneE164: string): Promise<User | null> {
    const orm = await this.repo.findOne({
      where: { phoneE164, deletedAt: undefined },
      relations: ['roles'],
    });
    return orm ? this.toDomain(orm) : null;
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.repo.exists({
      where: { email: email.toLowerCase() },
    });
  }

  async existsByPhone(phoneE164: string): Promise<boolean> {
    return this.repo.exists({ where: { phoneE164 } });
  }

  async save(user: User): Promise<User> {
    // INSERT — id is set by DB DEFAULT (uuid_generate_v7())
    // We use raw INSERT to get the DB-generated UUID back
    const result = await this.repo
      .createQueryBuilder()
      .insert()
      .into(UserOrmEntity)
      .values({
        fullName: user.fullName,
        email: user.email?.value ?? null,
        phoneE164: user.phoneE164,
        passwordHash: user.passwordHash,
        locale: user.locale,
        theme: user.theme,
        audioSpeed: user.audioSpeed,
        isSuspended: user.isSuspended,
      })
      .returning(['id', 'created_at', 'updated_at'])
      .execute();

    const raw = result.raw[0] as { id: string; created_at: Date; updated_at: Date };

    return User.reconstitute({
      id: raw.id,
      fullName: user.fullName,
      email: user.email?.value ?? null,
      phoneE164: user.phoneE164,
      passwordHash: user.passwordHash,
      locale: user.locale,
      theme: user.theme,
      audioSpeed: user.audioSpeed,
      isSuspended: false,
      suspendedAt: null,
      deletedAt: null,
      createdAt: raw.created_at,
      updatedAt: raw.updated_at,
    });
  }

  async findByIdWithPassword(id: string): Promise<User | null> {
    // addSelect explicitly loads password_hash (excluded by default via select: false)
    const orm = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.passwordHash')
      .leftJoinAndSelect('u.roles', 'r')
      .where('u.id = :id', { id })
      .andWhere('u.deleted_at IS NULL')
      .getOne();
    return orm ? this.toDomain(orm) : null;
  }

  async update(user: User): Promise<User> {
    await this.repo.update(user.id.value, {
      fullName: user.fullName,
      locale: user.locale,
      theme: user.theme,
      audioSpeed: user.audioSpeed,
      isSuspended: user.isSuspended,
      suspendedAt: user.suspendedAt ?? undefined,
      passwordHash: user.passwordHash ?? undefined,
      deletedAt: user.deletedAt ?? undefined,
    });
    return user;
  }

  async assignRole(userId: string, roleName: string): Promise<void> {
    await this.repo.manager.query(
      `INSERT INTO id_user_roles (user_id, role_id)
       SELECT $1, r.id FROM id_roles r WHERE r.name = $2
       ON CONFLICT DO NOTHING`,
      [userId, roleName],
    );
  }

  async getPrimaryRole(userId: string): Promise<string> {
    const result = await this.repo.manager.query<Array<{ name: string }>>(
      `SELECT r.name FROM id_roles r
       INNER JOIN id_user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = $1
       ORDER BY CASE r.name
         WHEN 'SuperAdmin' THEN 1
         WHEN 'Admin' THEN 2
         WHEN 'Editor' THEN 3
         WHEN 'Moderator' THEN 4
         ELSE 5
       END LIMIT 1`,
      [userId],
    );
    return result[0]?.name ?? 'User';
  }

  /**
   * Admin: paginated listing of ALL non-deleted users, ordered by created_at DESC.
   * Uses raw SQL with a single LEFT JOIN to include primary role — avoids N+1
   * and keeps BC01→BC05 boundary clean (no TypeORM repo exported to BC05).
   */
  async findAllPaginated(
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
  }> {
    const offset = (page - 1) * limit;

    const [rows, countResult] = await Promise.all([
      this.repo.manager.query<
        {
          id: string;
          full_name: string;
          email: string | null;
          phone_e164: string | null;
          is_suspended: boolean;
          created_at: Date;
          role_name: string | null;
        }[]
      >(
        `SELECT
           u.id,
           u.full_name,
           u.email,
           u.phone_e164,
           u.is_suspended,
           u.created_at,
           (
             SELECT r.name FROM id_roles r
             INNER JOIN id_user_roles ur ON ur.role_id = r.id
             WHERE ur.user_id = u.id
             ORDER BY CASE r.name
               WHEN 'SuperAdmin' THEN 1
               WHEN 'Admin'      THEN 2
               WHEN 'Editor'     THEN 3
               WHEN 'Moderator'  THEN 4
               ELSE 5
             END LIMIT 1
           ) AS role_name
         FROM id_users u
         WHERE u.deleted_at IS NULL
         ORDER BY u.created_at DESC
         LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
      this.repo.manager.query<[{ count: string }]>(
        `SELECT COUNT(*)::text AS count FROM id_users WHERE deleted_at IS NULL`,
      ),
    ]);

    const total = parseInt(countResult[0].count, 10);

    return {
      data: rows.map((r) => ({
        id: r.id,
        fullName: r.full_name,
        email: r.email,
        phoneE164: r.phone_e164,
        isSuspended: r.is_suspended,
        createdAt: r.created_at,
        role: r.role_name ?? 'User',
      })),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  // ── Domain ↔ ORM Mapping ────────────────────────────────────────────────────

  private toDomain(orm: UserOrmEntity): User {
    return User.reconstitute({
      id: orm.id,
      fullName: orm.fullName,
      email: orm.email,
      phoneE164: orm.phoneE164,
      passwordHash: orm.passwordHash,
      locale: orm.locale,
      theme: orm.theme,
      audioSpeed: Number(orm.audioSpeed),
      isSuspended: orm.isSuspended,
      suspendedAt: orm.suspendedAt,
      deletedAt: orm.deletedAt,
      createdAt: orm.createdAt,
      updatedAt: orm.updatedAt,
    });
  }
}

