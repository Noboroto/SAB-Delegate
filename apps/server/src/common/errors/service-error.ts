import type { ErrorCode } from '@sab/shared';

/** Values a message placeholder may take; nothing here is ever a secret or an `Error`. */
export type ServiceErrorParams = Readonly<Record<string, string | number>>;

/**
 * A failure the caller is meant to read about (bad input, unknown server, not
 * allowed). It carries only an `ErrorCode` and placeholder values, so each
 * transport renders it in its own way (a localized reply on Discord, an HTTP
 * status on the API) and `message` never reaches a user. It is not a bug and
 * is not reported to `#bot-log`.
 */
export class ServiceError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly params?: ServiceErrorParams,
  ) {
    super(code);
    this.name = 'ServiceError';
  }
}
