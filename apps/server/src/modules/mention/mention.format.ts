import { splitMessage } from '@sab/shared';
import type { Message, MessageMentionOptions } from 'discord.js';

type ListText = {
  header: string;
  userIds: readonly string[];
  /** The person who asked; their line says so. */
  requesterId: string;
  authorLabel: string;
  content: string | undefined;
};

/** `header`, one `<@id>,` line per member, then the free text: the layout the lists always had. */
export function renderMentionList({
  header,
  userIds,
  requesterId,
  authorLabel,
  content,
}: ListText): string[] {
  const lines = userIds.map((id) => `<@${id}>${id === requesterId ? ` ${authorLabel}` : ''},`);
  const footer = content === undefined || content === '' ? '' : `\n\n${content}`;
  return splitMessage(`${header}\n${lines.join('\n')}${footer}`);
}

/** How a list is posted: whom each piece may notify, and whether the reply notifies the target's author. */
type PostPolicy = {
  readonly mentions: MessageMentionOptions;
  readonly pingAuthor: boolean;
};

/**
 * What went out before `error` stopped the post: pieces already sent stay
 * sent, so the caller reports how far it got rather than "not delivered".
 */
type PostOutcome = { readonly posted: number; readonly error?: unknown };

/**
 * Posts `chunks` as a reply to `target` (the first) followed by plain messages
 * in the same channel, stopping at the first piece Discord refuses.
 */
export async function postAsReply(
  target: Message,
  chunks: readonly string[],
  policy: PostPolicy,
): Promise<PostOutcome> {
  const [first, ...rest] = chunks;
  if (first === undefined) return { posted: 0 };
  let posted = 0;
  try {
    await target.reply({
      content: first,
      allowedMentions: { ...policy.mentions, repliedUser: policy.pingAuthor },
    });
    posted = 1;
    if (rest.length === 0) return { posted };
    const { channel } = target;
    // A channel that took the reply takes plain messages too; this is a guard for the type.
    if (!channel.isSendable()) throw new RangeError('The channel does not accept messages');
    for (const chunk of rest) {
      await channel.send({ content: chunk, allowedMentions: policy.mentions });
      posted += 1;
    }
  } catch (error) {
    return { posted, error };
  }
  return { posted };
}
