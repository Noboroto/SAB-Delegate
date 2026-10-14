import { HttpException } from '@nestjs/common';
import type { ApiErrorBody, ErrorCode } from '@sab/shared';
import { translatorFor } from '../../i18n/translator.js';
import type { ServiceErrorParams } from './service-error.js';

// Every code has a status, so a code added to the shared enum without one fails
// to compile instead of answering 500 by accident. 403 is kept for reasons that
// are not about a particular server (origin, re-authentication, key kind): a
// server the caller may not manage is a 404, the same as one that does not exist.
const STATUS_BY_CODE: Readonly<Record<ErrorCode, number>> = {
  AUTH_UNAUTHENTICATED: 401,
  AUTH_ORIGIN_REJECTED: 403,
  AUTH_REAUTH_REQUIRED: 403,
  AUTH_FORBIDDEN: 403,
  AUTH_INVALID_API_KEY: 401,
  AUTH_API_KEY_EXPIRED: 401,
  AUTH_API_KEY_READ_ONLY: 403,
  GUILD_NOT_FOUND: 404,
  GUILD_ACCESS_DENIED: 404,
  GUILD_BOT_MISSING: 404,
  DISCORD_API_ERROR: 502,
  DISCORD_MISSING_PERMISSIONS: 422,
  DISCORD_CHANNEL_NOT_FOUND: 404,
  DISCORD_MESSAGE_NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  SCHEDULE_LIMIT_REACHED: 409,
  SCHEDULE_TOO_FAR: 400,
  MESSAGE_TOO_LONG: 400,
  ATTACHMENTS_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * The body of an error response: the code and its English text. Built from
 * the catalog only, so nothing from a thrown error's own message (table names,
 * paths, upstream text) can reach a client.
 */
export function errorBody(code: ErrorCode, params?: ServiceErrorParams): ApiErrorBody {
  return { code, message: translatorFor('en')(`errors.${code}`, params) };
}

/** An `HttpException` whose body is already the `{ code, message }` contract. */
export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    params?: ServiceErrorParams,
  ) {
    super(errorBody(code, params), STATUS_BY_CODE[code]);
  }
}
