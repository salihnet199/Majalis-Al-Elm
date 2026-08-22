import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

/**
 * BcryptAdapter — Infrastructure Adapter
 *
 * Implements password hashing using bcrypt.
 * Cost factor 12 — balances security and performance at ~150ms/hash on modern hardware.
 * OWASP A02: Cryptographic Failures mitigation.
 *
 * P-06: The domain interface (IPasswordHasher) lives in domain/ports/.
 * This implementation lives in infrastructure/ and is wired via DI.
 */
export interface IPasswordHasher {
  hash(plaintext: string): Promise<string>;
  verify(plaintext: string, hash: string): Promise<boolean>;
}

export const PASSWORD_HASHER = Symbol('IPasswordHasher');

@Injectable()
export class BcryptAdapter implements IPasswordHasher {
  private readonly COST_FACTOR = 12;

  async hash(plaintext: string): Promise<string> {
    return bcrypt.hash(plaintext, this.COST_FACTOR);
  }

  async verify(plaintext: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plaintext, hash);
  }
}
