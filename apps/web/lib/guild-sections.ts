/** Sections of a server's dashboard besides the overview; the overview page links one card to each. */
export const GUILD_SECTIONS = ['modules', 'commands', 'auditLog', 'settings'] as const;

export type GuildSection = (typeof GUILD_SECTIONS)[number];

export function isGuildSection(value: string): value is GuildSection {
  return (GUILD_SECTIONS as readonly string[]).includes(value);
}

/** `servers.nav.*` keys of the pages that sit under a menu entry. */
export type GuildNavChildKey =
  | 'birthday'
  | 'note'
  | 'wordGame'
  | 'games'
  | 'chatbot'
  | 'schedule'
  | 'messaging'
  | 'mention'
  | 'roleAssign'
  | 'threads'
  | 'purge'
  | 'activity'
  | 'attendance'
  | 'info';

export type GuildNavKey = 'overview' | 'tools' | GuildSection;

export interface GuildNavChild {
  key: GuildNavChildKey;
  /** Path below the server's own, e.g. `modules/word-game`. */
  path: string;
}

export interface GuildNavEntry {
  key: GuildNavKey;
  /** Path below the server's own; `''` is the overview. `undefined`: a menu that only groups its children. */
  path: string | undefined;
  children?: readonly GuildNavChild[];
}

/** The pages of the modules index, in the order the menu and the index show them. */
export const MODULE_PAGES = [
  { key: 'birthday', path: 'modules/birthday' },
  { key: 'note', path: 'modules/note' },
  { key: 'wordGame', path: 'modules/word-game' },
  { key: 'games', path: 'modules/games' },
  { key: 'chatbot', path: 'modules/chatbot' },
  { key: 'schedule', path: 'modules/schedule' },
  { key: 'messaging', path: 'modules/messaging' },
] as const satisfies readonly GuildNavChild[];

export const TOOL_PAGES = [
  { key: 'mention', path: 'tools/mention' },
  { key: 'roleAssign', path: 'tools/role-assign' },
  { key: 'threads', path: 'tools/threads' },
  { key: 'purge', path: 'tools/purge' },
  { key: 'activity', path: 'tools/activity' },
  { key: 'attendance', path: 'tools/attendance' },
  { key: 'info', path: 'tools/info' },
] as const satisfies readonly GuildNavChild[];

/** The one list the menu is built from. */
export const GUILD_NAV: readonly GuildNavEntry[] = [
  { key: 'overview', path: '' },
  { key: 'modules', path: 'modules', children: MODULE_PAGES },
  { key: 'tools', path: 'tools', children: TOOL_PAGES },
  { key: 'commands', path: 'commands' },
  { key: 'auditLog', path: 'audit-log' },
  { key: 'settings', path: 'settings' },
];

/** URL path (below the server's own) of a section; the menu key and the path differ for `auditLog`. */
export function guildSectionPath(section: GuildSection): string {
  const entry = GUILD_NAV.find((item) => item.key === section);
  if (entry?.path === undefined) throw new Error(`Section ${section} has no page`);
  return entry.path;
}

/**
 * The menu key that owns `pathname` inside the server `guildId`: the deepest
 * entry whose path is the pathname or a parent of it, so a sub-page selects
 * itself (and, in the menu, its parent). Unknown paths select nothing.
 */
export function activeNavKey(pathname: string, guildId: string): string | undefined {
  const base = `/servers/${guildId}`;
  if (pathname === base || pathname === `${base}/`) return 'overview';
  if (!pathname.startsWith(`${base}/`)) return undefined;
  const rest = pathname.slice(base.length + 1).replace(/\/+$/, '');
  let best: { key: string; length: number } | undefined;
  for (const entry of GUILD_NAV) {
    const candidates: { key: string; path: string | undefined }[] = [
      entry,
      ...(entry.children ?? []),
    ];
    for (const { key, path } of candidates) {
      if (path === undefined || path === '') continue;
      if ((rest === path || rest.startsWith(`${path}/`)) && path.length > (best?.length ?? 0)) {
        best = { key, length: path.length };
      }
    }
  }
  return best?.key;
}
