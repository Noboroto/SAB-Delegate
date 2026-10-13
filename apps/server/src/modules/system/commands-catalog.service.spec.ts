import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { rootCommandMeta } from '../../discord/command-groups.js';
import { CommandsCatalogService } from './commands-catalog.service.js';

const DEV_GUILD = '333333333333333333';

const ping = () => ({ toJSON: () => ({ ...rootCommandMeta('ping'), type: 1 }) });
const birthday = () => ({
  toJSON: () =>
    new SlashCommandBuilder()
      .setName('birthday')
      .setDescription('Manage birthday wishes')
      .setDescriptionLocalizations({ vi: 'Quản lý lời chúc sinh nhật' })
      .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
      .setContexts([0])
      .addSubcommand((sub) =>
        sub
          .setName('remove')
          .setDescription('Remove a birthday')
          .setDescriptionLocalizations({ vi: 'Xoá một sinh nhật' })
          .addStringOption((option) =>
            option.setName('student-id').setDescription('Student id').setRequired(true),
          ),
      )
      .addSubcommandGroup((group) =>
        group
          .setName('wish')
          .setDescription('Wishes')
          .addSubcommand((sub) => sub.setName('list').setDescription('List wishes')),
      )
      .toJSON(),
});

function service(devGuild?: string) {
  const commands = {
    getGlobalCommands: () => [birthday(), ping()],
    getGuildCommands: (id: string) => (id === DEV_GUILD ? [ping()] : []),
  };
  return new CommandsCatalogService(commands, { DISCORD_DEV_GUILD_ID: devGuild });
}

describe('CommandsCatalogService.list', () => {
  it('takes name, text and default permissions from the registry, sorted by name', () => {
    const entries = service().list('en');
    expect(entries.map((entry) => entry.name)).toEqual(['birthday', 'ping']);
    expect(entries[0]).toMatchObject({
      name: 'birthday',
      description: 'Manage birthday wishes',
      defaultMemberPermissions: PermissionFlagsBits.Administrator.toString(),
      guildOnly: true,
    });
    expect(entries[1]).toMatchObject({
      name: 'ping',
      description: MESSAGES.en.commands.ping.description,
      defaultMemberPermissions: null,
      guildOnly: false,
    });
  });

  it('translates descriptions and falls back to the base text where no translation exists', () => {
    const [birthdayEntry, pingEntry] = service().list('vi');
    expect(birthdayEntry?.description).toBe('Quản lý lời chúc sinh nhật');
    expect(birthdayEntry?.subcommands).toEqual([
      { name: 'birthday remove', description: 'Xoá một sinh nhật' },
      { name: 'birthday wish list', description: 'List wishes' },
    ]);
    expect(pingEntry?.description).toBe(MESSAGES.vi.commands.ping.description);
  });

  it('exposes nothing but the catalog fields', () => {
    for (const entry of service().list('en')) {
      expect(Object.keys(entry).sort()).toEqual([
        'defaultMemberPermissions',
        'description',
        'guildOnly',
        'name',
        'subcommands',
      ]);
      for (const sub of entry.subcommands)
        expect(Object.keys(sub).sort()).toEqual(['description', 'name']);
    }
  });

  it('lists the development guild commands when one is configured', () => {
    expect(
      service(DEV_GUILD)
        .list('en')
        .map((entry) => entry.name),
    ).toEqual(['ping']);
  });
});
