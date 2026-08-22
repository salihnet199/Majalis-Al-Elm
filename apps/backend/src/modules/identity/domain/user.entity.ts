import { EmailAddress } from '../../../shared/domain/email.vo';
import { UUIDv7 } from '../../../shared/domain/uuid.vo';

/**
 * User Aggregate Root — BC01: Identity & Access
 *
 * This is the domain object. It has ZERO dependency on TypeORM, NestJS, or any
 * infrastructure concern. (P-06: Persistence Ignorance)
 *
 * The TypeORM entity in infrastructure/persistence/entities/ maps DB columns
 * to/from this domain object — NOT the other way around.
 */
export class User {
  private constructor(
    public readonly id: UUIDv7,
    private _fullName: string,
    private _email: EmailAddress | null,
    private _phoneE164: string | null,
    private _passwordHash: string | null,
    private _locale: string,
    private _theme: string,
    private _audioSpeed: number,
    private _isSuspended: boolean,
    private _suspendedAt: Date | null,
    private _deletedAt: Date | null,
    public readonly createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // ── Factory Methods ─────────────────────────────────────────────────────────

  static create(params: {
    id: UUIDv7;
    fullName: string;
    email: EmailAddress | null;
    phoneE164: string | null;
    passwordHash: string | null;
    locale?: string;
    theme?: string;
    audioSpeed?: number;
    createdAt?: Date;
    updatedAt?: Date;
  }): User {
    if (!params.email && !params.phoneE164) {
      throw new Error('User must have at least one contact method (email or phone)');
    }
    const now = new Date();
    return new User(
      params.id,
      params.fullName,
      params.email ?? null,
      params.phoneE164 ?? null,
      params.passwordHash ?? null,
      params.locale ?? 'ar',
      params.theme ?? 'system',
      params.audioSpeed ?? 1.0,
      false,
      null,
      null,
      params.createdAt ?? now,
      params.updatedAt ?? now,
    );
  }

  static reconstitute(params: {
    id: string;
    fullName: string;
    email: string | null;
    phoneE164: string | null;
    passwordHash: string | null;
    locale: string;
    theme: string;
    audioSpeed: number;
    isSuspended: boolean;
    suspendedAt: Date | null;
    deletedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): User {
    return new User(
      UUIDv7.fromString(params.id),
      params.fullName,
      params.email ? EmailAddress.create(params.email) : null,
      params.phoneE164,
      params.passwordHash,
      params.locale,
      params.theme,
      params.audioSpeed,
      params.isSuspended,
      params.suspendedAt,
      params.deletedAt,
      params.createdAt,
      params.updatedAt,
    );
  }

  // ── Getters ─────────────────────────────────────────────────────────────────

  get fullName(): string { return this._fullName; }
  get email(): EmailAddress | null { return this._email; }
  get phoneE164(): string | null { return this._phoneE164; }
  get passwordHash(): string | null { return this._passwordHash; }
  get locale(): string { return this._locale; }
  get theme(): string { return this._theme; }
  get audioSpeed(): number { return this._audioSpeed; }
  get isSuspended(): boolean { return this._isSuspended; }
  get suspendedAt(): Date | null { return this._suspendedAt; }
  get deletedAt(): Date | null { return this._deletedAt; }
  get updatedAt(): Date { return this._updatedAt; }
  get isDeleted(): boolean { return this._deletedAt !== null; }

  // ── Domain Behavior ─────────────────────────────────────────────────────────

  updateProfile(params: {
    fullName?: string;
    bio?: string;
    locale?: string;
    theme?: string;
    audioSpeed?: number;
  }): void {
    if (params.fullName !== undefined) this._fullName = params.fullName;
    if (params.locale !== undefined) this._locale = params.locale;
    if (params.theme !== undefined) this._theme = params.theme;
    if (params.audioSpeed !== undefined) {
      if (params.audioSpeed < 0.5 || params.audioSpeed > 2.0) {
        throw new Error('audioSpeed must be between 0.5 and 2.0');
      }
      this._audioSpeed = params.audioSpeed;
    }
    this._updatedAt = new Date();
  }

  updatePasswordHash(newHash: string): void {
    this._passwordHash = newHash;
    this._updatedAt = new Date();
  }

  suspend(suspendedAt: Date): void {
    this._isSuspended = true;
    this._suspendedAt = suspendedAt;
    this._updatedAt = new Date();
  }

  unsuspend(): void {
    this._isSuspended = false;
    this._suspendedAt = null;
    this._updatedAt = new Date();
  }

  softDelete(): void {
    this._deletedAt = new Date();
    this._updatedAt = new Date();
  }
}
