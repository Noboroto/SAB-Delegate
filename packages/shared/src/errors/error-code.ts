import { z } from 'zod';

/**
 * Machine-readable failure reasons. The server answers with a code, never with
 * prose, and each client translates it; a message in the response would be
 * written in one language and leak internals.
 */
export const ErrorCodeSchema = z.enum([
  'AUTH_REQUIRED',
  'AUTH_FORBIDDEN',
  'AUTH_INVALID_API_KEY',
  'AUTH_API_KEY_EXPIRED',
  'AUTH_API_KEY_READ_ONLY',
  'GUILD_NOT_FOUND',
  'GUILD_ACCESS_DENIED',
  'GUILD_BOT_MISSING',
  'DISCORD_API_ERROR',
  'DISCORD_MISSING_PERMISSIONS',
  'DISCORD_CHANNEL_NOT_FOUND',
  'DISCORD_MESSAGE_NOT_FOUND',
  'VALIDATION_FAILED',
  'RATE_LIMITED',
  'INTERNAL',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** `ErrorCode.GUILD_NOT_FOUND` style access without repeating string literals. */
export const ErrorCode = ErrorCodeSchema.enum;
