import { MESSAGES } from '@sab/shared';
import { InteractionContextType, PermissionFlagsBits } from 'discord.js';
import { createCommandGroupDecorator, type RootCommandMeta } from 'necord';
import { localizations } from '../i18n/localizations.js';

type CommandSpec = {
  /** Who Discord offers the command to by default; admins can change it per server. */
  permissions?: bigint;
  /** Usable only inside a server, never in a direct message. */
  guildOnly?: true;
};

/**
 * The top-level commands. Default permissions are the ones the previous bot
 * registered, so a server's command visibility does not change at cutover. They
 * only decide who Discord lists the command for; the bot itself checks nothing
 * when a command runs (see AGENTS.md). Names and order follow the catalog in
 * `@sab/shared` (`commands.<name>.description`).
 */
const SPECS = {
  // Command groups: subcommands are added by feature modules.
  'bot-message': { permissions: PermissionFlagsBits.Administrator },
  scheduler: { permissions: PermissionFlagsBits.ManageMessages },
  birthday: { permissions: PermissionFlagsBits.Administrator },
  set: { permissions: PermissionFlagsBits.Administrator },
  word: { permissions: PermissionFlagsBits.ManageMessages },
  note: {},
  get: {},
  mention: { permissions: PermissionFlagsBits.UseApplicationCommands },
  'bulk-assign': { permissions: PermissionFlagsBits.ManageRoles },
  thread: { permissions: PermissionFlagsBits.ManageRoles },
  'private-thread': { permissions: PermissionFlagsBits.ManageRoles },
  purge: { permissions: PermissionFlagsBits.Administrator },
  // Single commands with no subcommands.
  ping: {},
  'add-poll': { guildOnly: true },
  'attendance-by-role': { guildOnly: true },
  'create-activity': { permissions: PermissionFlagsBits.ManageChannels, guildOnly: true },
} as const satisfies Record<keyof (typeof MESSAGES)['en']['commands'], CommandSpec>;

type CommandName = keyof typeof SPECS;
type GroupName = Exclude<
  CommandName,
  'ping' | 'add-poll' | 'attendance-by-role' | 'create-activity'
>;

const GROUP_NAMES = [
  'bot-message',
  'scheduler',
  'birthday',
  'set',
  'word',
  'note',
  'get',
  'mention',
  'bulk-assign',
  'thread',
  'private-thread',
  'purge',
] as const satisfies readonly GroupName[];

/** Every top-level command name, groups and single commands alike. */
export const ROOT_COMMAND_NAMES = Object.keys(SPECS) as CommandName[];

/**
 * Registration data for one top-level command: English text as the base
 * description, Vietnamese and both English tags as localisations.
 */
export function rootCommandMeta(name: CommandName): Omit<RootCommandMeta, 'type'> {
  const spec: CommandSpec = SPECS[name];
  return {
    name,
    description: MESSAGES.en.commands[name].description,
    descriptionLocalizations: localizations(`commands.${name}.description`),
    ...(spec.permissions === undefined ? {} : { defaultMemberPermissions: spec.permissions }),
    ...(spec.guildOnly === undefined ? {} : { contexts: [InteractionContextType.Guild] }),
  };
}

type GroupDecorators = {
  [Name in (typeof GROUP_NAMES)[number]]: ReturnType<typeof createCommandGroupDecorator>;
};

/**
 * One decorator per command group, e.g. `@CommandGroup.birthday({ name: 'list', ... })`
 * on the classes that contribute subcommands. Several classes may share a group
 * but must declare it identically: Necord keeps the first one it meets.
 */
export const CommandGroup: GroupDecorators = Object.fromEntries(
  GROUP_NAMES.map((name) => [name, createCommandGroupDecorator(rootCommandMeta(name))]),
) as GroupDecorators;

// Decorator syntax takes a plain name, not an indexed access, and these groups
// have a dash in theirs. `BotMessageGroup` and `ThreadGroup` are the groups
// that several feature modules contribute to; the declaration is the same
// object for all of them, so they cannot drift apart.
export const BotMessageGroup = CommandGroup['bot-message'];
export const BulkAssignGroup = CommandGroup['bulk-assign'];
export const PrivateThreadGroup = CommandGroup['private-thread'];
export const ThreadGroup = CommandGroup.thread;
