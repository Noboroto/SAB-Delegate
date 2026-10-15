import { HttpException } from '@nestjs/common';
import { ErrorCode, type ApiErrorBody } from '@sab/shared';
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
  API_KEY_LIMIT_REACHED: 409,
  API_KEY_NOT_FOUND: 404,
  GUILD_NOT_FOUND: 404,
  GUILD_ACCESS_DENIED: 404,
  GUILD_BOT_MISSING: 404,
  DISCORD_API_ERROR: 502,
  DISCORD_MISSING_PERMISSIONS: 422,
  DISCORD_CHANNEL_NOT_FOUND: 404,
  DISCORD_MESSAGE_NOT_FOUND: 404,
  VALIDATION_FAILED: 400,
  SCHEDULE_LIMIT_REACHED: 409,
  CHANNEL_IN_USE: 409,
  LLM_NOT_AVAILABLE: 409,
  LLM_KEY_REQUIRED: 400,
  SCHEDULE_TOO_FAR: 400,
  MESSAGE_TOO_LONG: 400,
  ATTACHMENTS_TOO_LARGE: 413,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

/**
 * Whether the bot is in a server, or whether a person may manage it, must not
 * be learnable from the answer: both collapse into the one "not found" code
 * (and so the one status and message) on the way out.
 */
function publicCode(code: ErrorCode): ErrorCode {
  return code === ErrorCode.GUILD_ACCESS_DENIED || code === ErrorCode.GUILD_BOT_MISSING
    ? ErrorCode.GUILD_NOT_FOUND
    : code;
}

/** The HTTP status a code is answered with. */
export function statusOf(code: ErrorCode): number {
  return STATUS_BY_CODE[publicCode(code)];
}

/**
 * The body of an error response: the code and its English text. Built from
 * the catalog only, so nothing from a thrown error's own message (table names,
 * paths, upstream text) can reach a client.
 */
export function errorBody(
  code: ErrorCode,
  params?: ServiceErrorParams,
  details?: ApiErrorBody['details'],
): ApiErrorBody {
  const shown = publicCode(code);
  const message = translatorFor('en')(`errors.${shown}`, shown === code ? params : undefined);
  return details === undefined ? { code: shown, message } : { code: shown, message, details };
}

/** An `HttpException` whose body is already the `{ code, message }` contract. */
export class ApiError extends HttpException {
  constructor(
    readonly code: ErrorCode,
    params?: ServiceErrorParams,
    details?: ApiErrorBody['details'],
  ) {
    super(errorBody(code, params, details), statusOf(code));
  }
}

type ValidationIssue = {
  message: string;
  path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
};

/**
 * The `exceptionFactory` of the global validation pipe: a 400 with the
 * offending field paths and the schema's own wording. The messages come from
 * our schemas (never an echo of the submitted value), so the client can point
 * at the field.
 */
export function validationFailed(issues: readonly ValidationIssue[]): ApiError {
  return new ApiError(ErrorCode.VALIDATION_FAILED, undefined, {
    issues: issues.map((issue) => ({
      path: (issue.path ?? [])
        .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.'),
      message: issue.message,
    })),
  });
}
