/** Sections of a server's dashboard besides the overview; each page arrives with its feature. */
export const GUILD_SECTIONS = ['modules', 'commands', 'logs', 'settings'] as const;

export type GuildSection = (typeof GUILD_SECTIONS)[number];

export function isGuildSection(value: string): value is GuildSection {
  return (GUILD_SECTIONS as readonly string[]).includes(value);
}
