import { z } from 'zod';
import { ApiKeyModeSchema } from '../generated/zod/schemas/enums/ApiKeyMode.schema.js';
import { ApiKeySchema } from '../generated/zod/schemas/models/ApiKey.schema.js';

export { ApiKeyModeSchema };

/** Keys a person may hold at once; a revoked or expired key does not count. */
export const API_KEY_MAX_ACTIVE = 5;

/** A key is a label on a list, so it stays short enough for a table cell. */
export const API_KEY_NAME_MAX_LENGTH = 60;

/**
 * Lifetimes in days. A key that can change things lives at most a month (the
 * database refuses a longer one too); a read-only key may live a year, and
 * expires after 90 days unless asked otherwise.
 */
export const API_KEY_READ_DEFAULT_DAYS = 90;
export const API_KEY_READ_MAX_DAYS = 365;
export const API_KEY_WRITE_DEFAULT_DAYS = 30;
export const API_KEY_WRITE_MAX_DAYS = 30;

const MAX_DAYS = { READ: API_KEY_READ_MAX_DAYS, WRITE: API_KEY_WRITE_MAX_DAYS } as const;
const DEFAULT_DAYS = {
  READ: API_KEY_READ_DEFAULT_DAYS,
  WRITE: API_KEY_WRITE_DEFAULT_DAYS,
} as const;

/**
 * Asks for a new key. `expiresInDays` defaults by mode and may not exceed the
 * mode's maximum; the parsed value always carries the final number of days.
 */
export const ApiKeyMintSchema = z
  .object({
    name: z.string().trim().min(1).max(API_KEY_NAME_MAX_LENGTH),
    mode: ApiKeyModeSchema.default('READ'),
    expiresInDays: z.number().int().min(1).optional(),
  })
  .superRefine((value, context) => {
    const max = MAX_DAYS[value.mode];
    if (value.expiresInDays !== undefined && value.expiresInDays > max) {
      context.addIssue({
        code: 'custom',
        path: ['expiresInDays'],
        message: `A ${value.mode} key can last at most ${max} days`,
      });
    }
  })
  .transform((value) => ({
    ...value,
    expiresInDays: value.expiresInDays ?? DEFAULT_DAYS[value.mode],
  }));

export type ApiKeyMint = z.output<typeof ApiKeyMintSchema>;
export type ApiKeyMintInput = z.input<typeof ApiKeyMintSchema>;

/**
 * What the key list shows. The hash is never part of it, and the column list is
 * explicit so a column added to the table later does not leak by itself.
 * `lastUsedIp` is shown so a leaked key is noticed; it decides no access.
 */
export const ApiKeyViewSchema = ApiKeySchema.pick({
  id: true,
  name: true,
  prefix: true,
  mode: true,
}).extend({
  id: z.uuid(),
  lastUsedIp: z.string().nullable(),
  lastUsedAt: z.coerce.date().nullable(),
  expiresAt: z.coerce.date().nullable(),
  revokedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type ApiKeyView = z.infer<typeof ApiKeyViewSchema>;

/** The answer to minting: the key as listed, plus its secret, which is shown this once and never again. */
export const ApiKeyMintResultSchema = ApiKeyViewSchema.extend({ plaintext: z.string() });

export type ApiKeyMintResult = z.infer<typeof ApiKeyMintResultSchema>;
