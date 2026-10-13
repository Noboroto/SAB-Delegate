import { MESSAGE_MAX_LENGTH, splitMessage } from '@sab/shared';
import { MessageFlags } from 'discord.js';

/**
 * The part of an interaction that answers it. Structural on purpose: the
 * interaction a Necord handler receives and the one discord.js types here are
 * the same object at runtime but separate declarations for the compiler, which
 * rejects a nominal parameter type across that boundary.
 */
type ReplyTarget = {
  readonly replied: boolean;
  readonly deferred: boolean;
  reply(options: { content: string; flags?: MessageFlags.Ephemeral }): Promise<unknown>;
  editReply(options: { content: string }): Promise<unknown>;
  followUp(options: { content: string; flags?: MessageFlags.Ephemeral }): Promise<unknown>;
};

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
 * boundaries into messages of at most 2000 characters. Works before a reply,
 * after `deferReply` (the first piece edits the placeholder) and after an
 * earlier reply (every piece is a follow-up). Every piece is awaited.
 */
export async function replyInChunks(
  interaction: ReplyTarget,
  text: string,
  { ephemeral = false }: { ephemeral?: boolean } = {},
): Promise<void> {
  const flags = ephemeral ? MessageFlags.Ephemeral : undefined;
  const followUp = (content: string) => interaction.followUp({ content, flags });

  let sendFirst: (content: string) => Promise<unknown> = followUp;
  if (!interaction.replied) {
    sendFirst = interaction.deferred
      ? (content) => interaction.editReply({ content })
      : (content) => interaction.reply({ content, flags });
  }

  const [first = '', ...rest] = splitMessage(text, MESSAGE_MAX_LENGTH);
  await sendFirst(first);
  for (const chunk of rest) await followUp(chunk);
}
