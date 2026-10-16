import { z } from 'zod';

/**
 * Machine-readable failure reasons. The server answers with a code, never with
 * prose, and each client translates it; a message in the response would be
 * written in one language and leak internals.
 */
export const ErrorCodeSchema = z.enum([
  'AUTH_UNAUTHENTICATED',
  'AUTH_ORIGIN_REJECTED',
  'AUTH_REAUTH_REQUIRED',
  'AUTH_FORBIDDEN',
  'AUTH_INVALID_API_KEY',
  'AUTH_API_KEY_EXPIRED',
  'AUTH_API_KEY_READ_ONLY',
  'API_KEY_LIMIT_REACHED',
  'API_KEY_NOT_FOUND',
  'GUILD_NOT_FOUND',
  'GUILD_ACCESS_DENIED',
  'GUILD_BOT_MISSING',
  'DISCORD_API_ERROR',
  'DISCORD_MISSING_PERMISSIONS',
  'DISCORD_CHANNEL_NOT_FOUND',
  'DISCORD_MESSAGE_NOT_FOUND',
  'CHANNEL_IN_USE',
  'CHATBOT_CHANNEL_LIMIT_REACHED',
  'CHATBOT_TURN_NOT_FOUND',
  'LLM_NOT_AVAILABLE',
  'LLM_KEY_REQUIRED',
  'VALIDATION_FAILED',
  'SCHEDULE_LIMIT_REACHED',
  'SCHEDULE_TOO_FAR',
  'MESSAGE_TOO_LONG',
  'ATTACHMENTS_TOO_LARGE',
  'RATE_LIMITED',
  'INTERNAL',
]);

export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

/** `ErrorCode.GUILD_NOT_FOUND` style access without repeating string literals. */
export const ErrorCode = ErrorCodeSchema.enum;

/**
 * The JSON body of every failed REST response. `message` is English text for a
 * log or a curl user; clients show their own translation of `code`.
 */
export const ApiErrorBodySchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.record(z.string(), z.unknown()).optional(),
});

export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;
