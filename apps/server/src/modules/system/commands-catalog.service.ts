import { Inject, Injectable } from '@nestjs/common';
import { z, type Locale } from '@sab/shared';
import { CommandsService } from 'necord';
import { DISCORD_ENV, type DiscordEnv } from '../../discord/boot-guard.js';
import { toRestBody } from '../../discord/command-registrar.js';

/** A subcommand reached through its full path, e.g. `birthday remove`. */
const CommandCatalogSubcommandSchema = z.object({
  name: z.string(),
  description: z.string(),
});

const CommandCatalogEntrySchema = z.object({
  name: z.string(),
  description: z.string(),
  /** Discord's default-permission bit set as a decimal string; null when everyone may use it. */
  defaultMemberPermissions: z.string().nullable(),
  guildOnly: z.boolean(),
  subcommands: z.array(CommandCatalogSubcommandSchema),
});

export type CommandCatalogEntry = z.infer<typeof CommandCatalogEntrySchema>;

type Discovered = { toJSON(): unknown };
type CommandSource = {
  getGlobalCommands(): Discovered[];
  getGuildCommands(guildId: string): Discovered[];
};

type Json = Record<string, unknown>;

const CHAT_INPUT = 1;
const SUB_COMMAND = 1;
const SUB_COMMAND_GROUP = 2;
const GUILD_CONTEXT = 0;

const isRecord = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The localisation tag Discord uses for a catalog language. */
const DISCORD_TAG: Record<Locale, string> = { vi: 'vi', en: 'en-US' };

function textFor(node: Json, locale: Locale): string {
  const localized = node['description_localizations'];
  if (isRecord(localized)) {
    const text = localized[DISCORD_TAG[locale]];
    if (typeof text === 'string' && text !== '') return text;
  }
  return typeof node['description'] === 'string' ? node['description'] : '';
}

function collectSubcommands(
  path: string,
  options: unknown,
  locale: Locale,
): Array<z.infer<typeof CommandCatalogSubcommandSchema>> {
  if (!Array.isArray(options)) return [];
  return options.filter(isRecord).flatMap((option) => {
    const name = typeof option['name'] === 'string' ? option['name'] : '';
    const childPath = `${path} ${name}`;
    if (option['type'] === SUB_COMMAND) {
      return [{ name: childPath, description: textFor(option, locale) }];
    }
    if (option['type'] === SUB_COMMAND_GROUP) {
      return collectSubcommands(childPath, option['options'], locale);
    }
    return [];
  });
}

/**
 * The slash commands the bot offers, read from the same registry that feeds
 * Discord, so a command added to a module appears here without a second list.
 * Only what a person needs to choose a command is exposed: name, text in their
 * language, who Discord offers it to by default, subcommand paths. Options,
 * handlers and ids stay inside.
 */
@Injectable()
export class CommandsCatalogService {
  constructor(
    @Inject(CommandsService) private readonly commands: CommandSource,
    @Inject(DISCORD_ENV) private readonly env: Pick<DiscordEnv, 'DISCORD_DEV_GUILD_ID'>,
  ) {}

  list(locale: Locale): CommandCatalogEntry[] {
    // A development build registers into one guild only (see CommandRegistrar).
    const devGuild = this.env.DISCORD_DEV_GUILD_ID;
    const discovered =
      devGuild === undefined || devGuild === ''
        ? this.commands.getGlobalCommands()
        : this.commands.getGuildCommands(devGuild);

    return discovered
      .map((command): Json => ({ ...toRestBody(command.toJSON()) }))
      .filter((payload) => payload['type'] === undefined || payload['type'] === CHAT_INPUT)
      .map((payload) => this.toEntry(payload, locale))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private toEntry(payload: Json, locale: Locale): CommandCatalogEntry {
    const name = typeof payload['name'] === 'string' ? payload['name'] : '';
    const permissions = payload['default_member_permissions'];
    const contexts = payload['contexts'];
    return CommandCatalogEntrySchema.parse({
      name,
      description: textFor(payload, locale),
      defaultMemberPermissions: typeof permissions === 'string' ? permissions : null,
      guildOnly: Array.isArray(contexts) && contexts.length === 1 && contexts[0] === GUILD_CONTEXT,
      subcommands: collectSubcommands(name, payload['options'], locale),
    });
  }
}
