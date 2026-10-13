import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { copyErrorCode, type CopyProblem } from '../../discord/helpers/message-copy.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';

/** Unknown Channel. */
const UNKNOWN_CHANNEL = 10003;
/** Unknown Message. */
const UNKNOWN_MESSAGE = 10008;
/** Missing Access, Missing Permissions. */
const PERMISSION_CODES: ReadonlySet<number> = new Set([50001, 50013]);

/** What Discord said, kept as a parameter so a command can show it the way the old bot did. */
const REASON_PARAM = 'reason';
const REASON_MAX_LENGTH = 300;

export type PermissionKind = 'view' | 'send' | 'other';

/**
 * Turns a Discord API failure into the `ServiceError` the callers translate.
 * Anything that is not a Discord API error (a network fault, a bug) comes back
 * unchanged, to be reported rather than shown. `reason` is Discord's own short
 * text ("Missing Permissions", "Unknown Emoji"), never a stack.
 */
export function discordFailure(error: unknown, permission: PermissionKind): unknown {
  const code = discordErrorCode(error);
  if (code === undefined) return error;
  if (code === UNKNOWN_CHANNEL) return new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
  if (code === UNKNOWN_MESSAGE) return new ServiceError(ErrorCode.DISCORD_MESSAGE_NOT_FOUND);

  const reason = (error instanceof Error ? error.message : `Discord error ${code}`).slice(
    0,
    REASON_MAX_LENGTH,
  );
  if (PERMISSION_CODES.has(code)) {
    return new ServiceError(ErrorCode.DISCORD_MISSING_PERMISSIONS, {
      permission,
      [REASON_PARAM]: reason,
    });
  }
  return new ServiceError(ErrorCode.DISCORD_API_ERROR, { [REASON_PARAM]: reason });
}

/** Discord's text behind a failed write, or undefined for any other error. */
export function discordReasonOf(error: unknown): string | undefined {
  if (!(error instanceof ServiceError)) return undefined;
  const reason = error.params?.[REASON_PARAM];
  return typeof reason === 'string' ? reason : undefined;
}

/** A copy that Discord would refuse (too long, files too large), refused before it is tried. */
export function copyRefusal(problem: CopyProblem): ServiceError {
  return new ServiceError(copyErrorCode(problem));
}

export function copyProblemOf(error: unknown): CopyProblem | undefined {
  if (!(error instanceof ServiceError)) return undefined;
  if (error.code === ErrorCode.MESSAGE_TOO_LONG) return 'TOO_LONG';
  return error.code === ErrorCode.ATTACHMENTS_TOO_LARGE ? 'FILES_TOO_LARGE' : undefined;
}
