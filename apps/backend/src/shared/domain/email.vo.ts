/**
 * EmailAddress Value Object
 *
 * Encapsulates email validation logic in the domain layer.
 * Uses CITEXT semantics: stored lowercase, compared case-insensitively.
 * Matches id_users.email column type (CITEXT) from DB-SCHEMA.md v1.1.0.
 */
export class EmailAddress {
  private readonly _value: string;

  private constructor(value: string) {
    this._value = value.toLowerCase().trim();
  }

  static create(raw: string): EmailAddress {
    if (!raw || typeof raw !== 'string') {
      throw new Error('Email address is required');
    }
    const trimmed = raw.trim().toLowerCase();
    if (!EmailAddress.isValid(trimmed)) {
      throw new Error(`Invalid email address: "${raw}"`);
    }
    return new EmailAddress(trimmed);
  }

  static isValid(email: string): boolean {
    // RFC 5322 simplified — rejects clearly invalid addresses
    const regex = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i;
    return regex.test(email) && email.length <= 254;
  }

  get value(): string {
    return this._value;
  }

  equals(other: EmailAddress): boolean {
    return this._value === other._value;
  }

  toString(): string {
    return this._value;
  }
}
