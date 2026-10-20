import { createHmac, randomInt, scryptSync, timingSafeEqual } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { EMAIL_CODE_LENGTH, ErrorCode } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { decryptSecret, encryptSecret } from '../llm/secret-box.js';
import type { EmailVerifyEnv } from './email-verify.env.js';

/**
 * What this module reads from the environment (see `EmailVerifyModule`): the
 * key secret and the admin guild.
 */
export const EMAIL_VERIFY_ENV = Symbol('EMAIL_VERIFY_ENV');

const HASH_SALT = 'sab-delegate-email-hash-v1';

const hashKeys = new Map<string, Buffer>();

/** scrypt is slow on purpose; the key is derived once per secret. */
function hashKeyOf(secret: string): Buffer {
  let key = hashKeys.get(secret);
  if (key === undefined) {
    key = scryptSync(secret, HASH_SALT, 32);
    hashKeys.set(secret, key);
  }
  return key;
}

/** Keyed hash (HMAC-SHA256, hex) of an already normalised address. */
export function hashEmail(email: string, secret: string): string {
  return createHmac('sha256', hashKeyOf(secret)).update(email).digest('hex');
}

/**
 * Keyed hash of a code. The pending row's id is part of the message so a code
 * cannot be replayed against another member's (or a later) verification.
 */
export function hashCode(pendingId: string, code: string, secret: string): string {
  return createHmac('sha256', hashKeyOf(secret)).update(`${pendingId}:${code}`).digest('hex');
}

/** Whether two hex hashes are equal, in time that does not depend on where they differ. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
}

/** A uniformly random code of `EMAIL_CODE_LENGTH` digits, zero-padded. */
export function newCode(): string {
  return randomInt(0, 10 ** EMAIL_CODE_LENGTH)
    .toString()
    .padStart(EMAIL_CODE_LENGTH, '0');
}

/**
 * Everything that needs `LLM_KEY_SECRET`: address hashes, code hashes and the
 * encrypted address of a pending or verified member. Without the secret none
 * of it can be done, and `requireSecret` says so as `EMAIL_VERIFY_UNAVAILABLE`.
 */
@Injectable()
export class EmailCryptoService {
  constructor(@Inject(EMAIL_VERIFY_ENV) private readonly env: EmailVerifyEnv) {}

  get available(): boolean {
    return this.env.secret !== undefined;
  }

  requireSecret(): string {
    if (this.env.secret === undefined) throw new ServiceError(ErrorCode.EMAIL_VERIFY_UNAVAILABLE);
    return this.env.secret;
  }

  hashEmail(email: string): string {
    return hashEmail(email, this.requireSecret());
  }

  hashCode(pendingId: string, code: string): string {
    return hashCode(pendingId, code, this.requireSecret());
  }

  encrypt(plain: string): string {
    return encryptSecret(plain, this.requireSecret());
  }

  /** The plain text, `null` when the secret changed since it was stored or the value is damaged. */
  decrypt(stored: string): string | null {
    return this.env.secret === undefined ? null : decryptSecret(stored, this.env.secret);
  }
}
