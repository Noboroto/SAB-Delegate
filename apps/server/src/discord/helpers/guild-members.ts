import type { Collection, Guild, GuildMember, Snowflake } from 'discord.js';

/** How long a fetched member list is reused; long enough for one command's several reads. */
export const GUILD_MEMBERS_TTL_MS = 30_000;

type Members = Collection<Snowflake, GuildMember>;

type Entry = {
  readonly members: Promise<Members>;
  /** Set when the fetch succeeded; an entry still in flight has none. */
  settledAt: number | undefined;
};

/**
 * Keyed by the guild object, which discord.js keeps for the life of the
 * client. A weak map needs no sweeping and cannot hand one server's members to
 * another.
 */
const entries = new WeakMap<object, Entry>();

/**
 * The whole member list of a server. `members.cache` only holds the members
 * seen so far, so a command that reasons about roles needs this fetch; a
 * command that reads it twice (or two commands at once) would otherwise page
 * through a large server repeatedly, which Discord rate limits. Callers that
 * ask while a fetch is in flight share it, and a finished list is reused for
 * `GUILD_MEMBERS_TTL_MS`. A failed fetch is not remembered.
 */
export function fetchGuildMembers(guild: Pick<Guild, 'members'>): Promise<Members> {
  const now = Date.now();
  const known = entries.get(guild);
  if (
    known !== undefined &&
    (known.settledAt === undefined || now - known.settledAt < GUILD_MEMBERS_TTL_MS)
  ) {
    return known.members;
  }

  const entry: Entry = {
    members: guild.members.fetch().then(
      (members) => {
        entry.settledAt = Date.now();
        return members;
      },
      (error: unknown) => {
        if (entries.get(guild) === entry) entries.delete(guild);
        throw error;
      },
    ),
    settledAt: undefined,
  };
  entries.set(guild, entry);
  return entry.members;
}
