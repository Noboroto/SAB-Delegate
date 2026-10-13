import type { ActorContext } from '@sab/shared';
import type { MessageMentionOptions } from 'discord.js';

type Pingable = 'users' | 'roles' | 'everyone';

/** Discord rejects an `allowedMentions.users` list longer than this. */
const ALLOWED_USERS_MAX = 100;

const USER_MENTION = /<@!?(\d{17,20})>/g;

/**
 * What a post written for `actor` may notify. The client mutes every mention
 * by default. A person using a slash command gets what the old bot gave them
 * (the kinds in `allow`, so a typed `@role` or `<@id>` pings): the commands
 * exist to ping on that person's behalf. Any other door (REST, MCP, background
 * work) pings nobody: its text comes from a program that was never asked
 * whom it may wake.
 */
export function mentionsForActor(
  actor: Pick<ActorContext, 'source'>,
  allow: readonly Pingable[],
): MessageMentionOptions {
  return actor.source === 'DISCORD' ? { parse: [...allow] } : { parse: [] };
}

/**
 * Pings exactly the users in `only` whose mention appears in `text`. For a
 * list whose members must be notified piece by piece while whatever else the
 * text contains stays text.
 */
export function userMentionsIn(text: string, only: ReadonlySet<string>): MessageMentionOptions {
  const users = new Set<string>();
  for (const [, id] of text.matchAll(USER_MENTION)) {
    if (id !== undefined && only.has(id)) users.add(id);
  }
  return { users: [...users].slice(0, ALLOWED_USERS_MAX) };
}
