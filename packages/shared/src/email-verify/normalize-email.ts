import { z } from 'zod';
import { EMAIL_ADDRESS_MAX } from './constants.js';

const EmailAddressSchema = z.email().max(EMAIL_ADDRESS_MAX);

/**
 * The form an address is compared, hashed and stored in: trimmed and lower-case.
 * Null when it is not a valid address. Lower-casing the local part is what
 * every mail provider this bot is meant for does, and it keeps one person from
 * verifying twice as `A@x.com` and `a@x.com`.
 */
export function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return EmailAddressSchema.safeParse(email).success ? email : null;
}

/** The part of a normalised address after its last `@`. */
export function emailDomain(email: string): string {
  return email.slice(email.lastIndexOf('@') + 1);
}
