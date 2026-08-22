import { randomUUID } from 'crypto';

/**
 * UUIDv7 Value Object — DB-001
 *
 * In the DB layer, uuid_generate_v7() from pg_uuidv7 extension generates
 * monotonic UUIDv7 values. In the application layer (domain / tests),
 * we use this VO as a typed wrapper around the UUID string.
 *
 * P-06: Persistence Ignorance — domain knows UUIDv7 as a VO, not as a DB concern.
 */
export class UUIDv7 {
  private constructor(private readonly _value: string) {}

  /** Use in tests or when creating domain objects before DB insert */
  static generate(): UUIDv7 {
    // Node.js crypto.randomUUID() generates v4. In production, the DB
    // generates v7. This is acceptable for domain/test use; entities
    // get their final UUIDv7 from the DB DEFAULT on INSERT.
    return new UUIDv7(randomUUID());
  }

  static fromString(value: string): UUIDv7 {
    if (!UUIDv7.isValid(value)) {
      throw new Error(`Invalid UUID: "${value}"`);
    }
    return new UUIDv7(value);
  }

  static isValid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  get value(): string {
    return this._value;
  }

  equals(other: UUIDv7): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
