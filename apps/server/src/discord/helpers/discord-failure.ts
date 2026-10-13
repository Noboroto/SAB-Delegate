import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordErrorCode } from './reply.js';
import { errorLabel } from '../../prisma/pool-factory.js';

/** Unknown Channel. */
const UNKNOWN_CHANNEL = 10003;
/** Unknown Message. */
const UNKNOWN_MESSAGE = 10008;
/** Missing Access, Missing Permissions. */
const MISSING_PERMISSION_CODES: ReadonlySet<number> = new Set([50001, 50013]);

const MAX_REASON_LENGTH = 200;

/** A message another person already deleted is gone, which is what was asked for. */
export const isUnknownMessage = (error: unknown): boolean =>
  discordErrorCode(error) === UNKNOWN_MESSAGE;

/** The bot may not do this in that channel; retrying the next item would fail the same way. */
export const isMissingPermission = (error: unknown): boolean => {
  const code = discordErrorCode(error);
  return code !== undefined && MISSING_PERMISSION_CODES.has(code);
};

/**
 * What a transport shows for a Discord API failure: a `ServiceError` with a
 * code to translate. Anything that is not a Discord answer is a bug and goes
 * on unchanged, so it is reported rather than hidden behind a Discord code.
 */
export function toServiceError(error: unknown): Error {
  if (error instanceof ServiceError) return error;
  const code = discordErrorCode(error);
  if (code === undefined) {
    return error instanceof Error ? error : new Error('Unexpected failure');
  }
  if (MISSING_PERMISSION_CODES.has(code)) {
    return new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, { permission: 'other' });
  }
  if (code === UNKNOWN_CHANNEL) return new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
  if (code === UNKNOWN_MESSAGE) return new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);
  return new ServiceError(ErrorCode.DISCORD_API_ERROR);
}

/**
 * The short sentence to show beside one failed item. Discord's own answer
 * ("Missing Permissions") is safe to show; any other error carries internals
 * and is replaced by a fixed text (the log has the details).
 */
export function failureReason(error: unknown): string {
  if (error instanceof Error && discordErrorCode(error) !== undefined) {
    return (
      (error.message.split('\n')[0] ?? '').trim().slice(0, MAX_REASON_LENGTH) || 'Discord error'
    );
  }
  return 'Unexpected error';
}

/** Name and Discord code of a failure, never its message: for logs. */
export function failureLabel(error: unknown): string {
  const code = discordErrorCode(error);
  return code === undefined ? errorLabel(error) : `${errorLabel(error)} (Discord ${code})`;
}

/**
 * What a person may read about a failed send: Discord's own explanation when
 * Discord refused ("Missing Permissions"), nothing else. Anything that is not
 * an API refusal is a bug and goes to the error handler instead, so this
 * returns `undefined` for it.
 */
export function discordRefusal(error: unknown): string | undefined {
  if (discordErrorCode(error) === undefined || !(error instanceof Error)) return undefined;
  return error.message.slice(0, 200);
}
