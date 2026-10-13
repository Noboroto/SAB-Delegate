import { ErrorCode, MESSAGE_MAX_LENGTH } from '@sab/shared';

/** A message to copy from; structural so any discord.js `Message` fits. */
type CopySource<File> = {
  readonly content: string;
  readonly attachments: { values(): Iterable<File> };
};

type MessageCopy<File> = { content: string; files: File[] };

/**
 * Content and attachments of `source`, ready to send as a new message, or
 * `null` when there is nothing to copy (no text and no attachment: Discord
 * rejects an empty message).
 */
export function buildMessageCopy<File>(source: CopySource<File>): MessageCopy<File> | null {
  const copy: MessageCopy<File> = {
    content: source.content,
    files: [...source.attachments.values()],
  };
  if (copy.content === '' && copy.files.length === 0) return null;
  return copy;
}

const MIB = 1024 * 1024;

/**
 * What a server lets one message upload, by boost tier. A copy of a message
 * from a bigger server can exceed the destination's limit, which Discord
 * answers with an opaque form-body error.
 */
const UPLOAD_LIMIT_BY_TIER: Readonly<Record<number, number>> = {
  0: 10 * MIB,
  1: 10 * MIB,
  2: 50 * MIB,
  3: 100 * MIB,
};

/** Direct messages and unknown tiers get the smallest limit, so the check errs towards refusing. */
export function uploadLimitOf(premiumTier: number | undefined): number {
  return UPLOAD_LIMIT_BY_TIER[premiumTier ?? 0] ?? UPLOAD_LIMIT_BY_TIER[0] ?? 10 * MIB;
}

/** The upload limit of the server a channel belongs to. */
export function uploadLimitForChannel(channel: unknown): number {
  const tier = (channel as { guild?: { premiumTier?: unknown } } | null)?.guild?.premiumTier;
  return uploadLimitOf(typeof tier === 'number' ? tier : undefined);
}

/**
 * `TOO_LONG`: the text is over 2000 characters, which only a Nitro author can
 * post and a bot never can. `FILES_TOO_LARGE`: the files together are over the
 * destination's upload limit.
 */
export type CopyProblem = 'TOO_LONG' | 'FILES_TOO_LARGE';

/** Why `copy` cannot be sent as it is, or null when it can. */
export function copyProblem(
  copy: { readonly content: string; readonly files: readonly { readonly size: number }[] },
  uploadLimit: number,
): CopyProblem | null {
  if (copy.content.length > MESSAGE_MAX_LENGTH) return 'TOO_LONG';
  const total = copy.files.reduce((sum, file) => sum + file.size, 0);
  return total > uploadLimit ? 'FILES_TOO_LARGE' : null;
}

/** The refusal a service raises for `problem`. */
export function copyErrorCode(problem: CopyProblem): ErrorCode {
  return problem === 'TOO_LONG' ? ErrorCode.MESSAGE_TOO_LONG : ErrorCode.ATTACHMENTS_TOO_LARGE;
}
