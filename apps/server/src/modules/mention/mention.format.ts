import { splitMessage } from '@sab/shared';
import type { Message, MessageMentionOptions } from 'discord.js';

const USER_MENTION = /<@!?(\d{17,20})>/g;
const ROLE_MENTION = /<@&(\d{17,20})>/g;

/** Discord rejects an `allowedMentions` list longer than this. */
const ALLOWED_MENTIONS_MAX = 100;

/**
 * The client pings nobody by default, so a message that is meant to ping says
 * whom. A mention list pings exactly the users and roles it names: the members
 * listed, the person who asked, and whoever they typed into the free text.
 * `@everyone` and `@here` stay text; `/thread everyone` is the way to use them.
 * A chunk never names more than 100 (a 2000-character message cannot hold more
 * mentions), but the cap keeps Discord from rejecting the request regardless.
 */
export function allowedMentionsFor(text: string): MessageMentionOptions {
  const users = new Set<string>();
  for (const [, id] of text.matchAll(USER_MENTION)) if (id !== undefined) users.add(id);
  const roles = new Set<string>();
  for (const [, id] of text.matchAll(ROLE_MENTION)) if (id !== undefined) roles.add(id);
  return {
    users: [...users].slice(0, ALLOWED_MENTIONS_MAX),
    roles: [...roles].slice(0, ALLOWED_MENTIONS_MAX),
  };
}

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

/**
 * Posts `chunks` as a reply to `target` (the first) followed by plain messages
 * in the same channel. Each piece pings only whom it names, and the reply
 * pings the author of `target` as a reply always has.
 */
export async function postAsReply(target: Message, chunks: readonly string[]): Promise<void> {
  const [first, ...rest] = chunks;
  if (first === undefined) return;
  await target.reply({
    content: first,
    allowedMentions: { ...allowedMentionsFor(first), repliedUser: true },
  });
  if (rest.length === 0) return;
  const { channel } = target;
  // A channel that took the reply takes plain messages too; this is a guard for the type.
  if (!channel.isSendable()) throw new RangeError('The channel does not accept messages');
  for (const chunk of rest) {
    await channel.send({ content: chunk, allowedMentions: allowedMentionsFor(chunk) });
  }
}
