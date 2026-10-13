import { MESSAGE_MAX_LENGTH, splitMessage } from '@sab/shared';
import { MessageFlags, type MessageMentionOptions } from 'discord.js';

/**
 * The part of an interaction that answers it. Structural on purpose: the
 * interaction a Necord handler receives and the one discord.js types here are
 * the same object at runtime but separate declarations for the compiler, which
 * rejects a nominal parameter type across that boundary.
 */
type ReplyTarget = {
  readonly replied: boolean;
  readonly deferred: boolean;
  reply(options: {
    content: string;
    flags?: MessageFlags.Ephemeral;
    allowedMentions?: MessageMentionOptions;
  }): Promise<unknown>;
  editReply(options: {
    content: string;
    allowedMentions?: MessageMentionOptions;
  }): Promise<unknown>;
  followUp(options: {
    content: string;
    flags?: MessageFlags.Ephemeral;
    allowedMentions?: MessageMentionOptions;
  }): Promise<unknown>;
};

/**
 * Whom a reply may ping. A function is asked once per message, for lists whose
 * mentions must be allowed piece by piece (Discord caps one message's list).
 */
type AllowedMentionsFor = MessageMentionOptions | ((chunk: string) => MessageMentionOptions);

/**
 * 10062: the interaction token expired or never existed (answered too late).
 * 40060: the interaction was already acknowledged. Neither can be fixed by
 * answering again.
 */
const DEAD_INTERACTION_CODES: ReadonlySet<number> = new Set([10062, 40060]);

/** The numeric Discord API error code of a failed request, if the error carries one. */
export function discordErrorCode(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null || !('code' in error)) return undefined;
  const { code } = error;
  return typeof code === 'number' ? code : undefined;
}

export function isDeadInteractionError(error: unknown): boolean {
  const code = discordErrorCode(error);
  return code !== undefined && DEAD_INTERACTION_CODES.has(code);
}

/**
 * Answers the interaction with `text`, whatever its length: split on line
 * boundaries into messages of at most 2000 characters. A list of pieces is
 * sent as given, one message each, for a caller that split the text itself
 * (each piece must fit already). Works before a reply,
 * after `deferReply` (the first piece edits the placeholder) and after an
 * earlier reply (every piece is a follow-up). Every piece is awaited.
 * `allowedMentions` is passed through unchanged when given; left out, the
 * client's default applies.
 */
export async function replyInChunks(
  interaction: ReplyTarget,
  text: string | readonly string[],
  {
    ephemeral = false,
    allowedMentions,
  }: { ephemeral?: boolean; allowedMentions?: AllowedMentionsFor } = {},
): Promise<void> {
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  const mentionsOf = (content: string): { allowedMentions?: MessageMentionOptions } => {
    const resolved =
      typeof allowedMentions === 'function' ? allowedMentions(content) : allowedMentions;
    return resolved === undefined ? {} : { allowedMentions: resolved };
  };
  const followUp = (content: string) =>
    interaction.followUp({ content, flags, ...mentionsOf(content) });

  let sendFirst: (content: string) => Promise<unknown> = followUp;
  if (!interaction.replied) {
    sendFirst = interaction.deferred
      ? (content) => interaction.editReply({ content, ...mentionsOf(content) })
      : (content) => interaction.reply({ content, flags, ...mentionsOf(content) });
  }

  const [first = '', ...rest] =
    typeof text === 'string' ? splitMessage(text, MESSAGE_MAX_LENGTH) : text;
  await sendFirst(first);
  for (const chunk of rest) await followUp(chunk);
}
