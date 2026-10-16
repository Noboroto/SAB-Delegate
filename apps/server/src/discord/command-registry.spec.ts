import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { PermissionFlagsBits } from 'discord.js';
import { SlashCommand } from 'necord';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import type { CommandPayload } from './command-hash.js';
import { toRestBody } from './command-registrar.js';
import { CommandGroup, ROOT_COMMAND_NAMES, rootCommandMeta } from './command-groups.js';
import { validateCommandMetadata } from './validate-command-metadata.js';

const payloadOf = () =>
  ROOT_COMMAND_NAMES.map((name) => toRestBody({ ...rootCommandMeta(name), type: 1 }));

// What the previous bot registered, read from each root/src/commands/*.ts
// (`setDefaultMemberPermissions`, `setContexts`). Kept as a second, independent
// copy on purpose: it is the oracle for the declarations in command-groups.ts.
const LEGACY_PERMISSIONS: Record<string, bigint | undefined> = {
  'bot-message': PermissionFlagsBits.Administrator,
  scheduler: PermissionFlagsBits.ManageMessages,
  birthday: PermissionFlagsBits.Administrator,
  set: PermissionFlagsBits.Administrator,
  word: PermissionFlagsBits.ManageMessages,
  note: undefined,
  get: undefined,
  mention: PermissionFlagsBits.UseApplicationCommands,
  'bulk-assign': PermissionFlagsBits.ManageRoles,
  thread: PermissionFlagsBits.ManageRoles,
  'private-thread': PermissionFlagsBits.ManageRoles,
  purge: PermissionFlagsBits.Administrator,
  ping: undefined,
  'add-poll': undefined,
  'attendance-by-role': undefined,
  'create-activity': PermissionFlagsBits.ManageChannels,
  // Added after the previous bot: the channel games, their scores, help and the chatbot.
  game: PermissionFlagsBits.ManageMessages,
  leaderboard: undefined,
  help: undefined,
  chatbot: PermissionFlagsBits.ManageGuild,
  chat: undefined,
};
const LEGACY_GUILD_ONLY = ['add-poll', 'attendance-by-role', 'create-activity'];

describe('the 21 top-level commands', () => {
  it('are exactly the commands in the shared catalog', () => {
    expect([...ROOT_COMMAND_NAMES].sort()).toEqual(Object.keys(MESSAGES.en.commands).sort());
    expect(ROOT_COMMAND_NAMES).toHaveLength(21);
  });

  it('pass the Discord metadata limits', () => {
    expect(validateCommandMetadata(payloadOf())).toEqual([]);
  });

  it('keep the default permissions and guild-only contexts of the previous bot', () => {
    for (const command of payloadOf()) {
      const expected = LEGACY_PERMISSIONS[command.name];
      expect(command.default_member_permissions ?? undefined, command.name).toBe(
        expected?.toString(),
      );
      const contexts = 'contexts' in command ? command.contexts : undefined;
      expect(contexts, command.name).toEqual(
        LEGACY_GUILD_ONLY.includes(command.name) ? [0] : undefined,
      );
    }
  });

  it('carry the English text and the Vietnamese and English localisations', () => {
    const ping = payloadOf().find((command) => command.name === 'ping');
    expect(ping).toMatchObject({
      description: MESSAGES.en.commands.ping.description,
      description_localizations: {
        vi: MESSAGES.vi.commands.ping.description,
        'en-US': MESSAGES.en.commands.ping.description,
        'en-GB': MESSAGES.en.commands.ping.description,
      },
    });
  });

  it('does not add a shutdown command', () => {
    expect(ROOT_COMMAND_NAMES).not.toContain('shutdown' as never);
  });
});

describe('command group decorators', () => {
  it('declare each of the 15 groups once, with the registered metadata', () => {
    const groups = Object.keys(CommandGroup);
    expect(groups).toHaveLength(15);
    const reflector = new Reflector();
    for (const name of groups) {
      @(CommandGroup[name as keyof typeof CommandGroup]())
      class Probe {}
      const discovery = reflector.get<{ toJSON(): unknown }>(SlashCommand.KEY, Probe);
      const meta = discovery.toJSON() as { name: string; defaultMemberPermissions?: bigint };
      expect(meta.name).toBe(name);
      expect(meta.defaultMemberPermissions).toBe(LEGACY_PERMISSIONS[name]);
    }
  });
});

describe('validateCommandMetadata', () => {
  const valid = (): CommandPayload => ({ name: 'ping', description: 'Check the bot', type: 1 });

  it('accepts a valid command', () => {
    expect(validateCommandMetadata([valid()])).toEqual([]);
  });

  it.each([
    ['an upper-case name', { ...valid(), name: 'Ping' }],
    ['a name with a space', { ...valid(), name: 'my ping' }],
    ['a name over 32 characters', { ...valid(), name: 'a'.repeat(33) }],
    ['an empty description', { ...valid(), description: '   ' }],
    ['a description over 100 characters', { ...valid(), description: 'x'.repeat(101) }],
    [
      'a description localisation over 100 characters',
      { ...valid(), description_localizations: { vi: 'x'.repeat(101) } },
    ],
    [
      'an option without a description',
      { ...valid(), options: [{ type: 3, name: 'text', description: '' }] },
    ],
  ])('rejects %s', (_label, command) => {
    expect(validateCommandMetadata([command]).length).toBeGreaterThan(0);
  });

  it('names the offending subcommand by its path', () => {
    const problems = validateCommandMetadata([
      {
        ...valid(),
        name: 'birthday',
        options: [{ type: 1, name: 'list', description: '' }],
      } as CommandPayload,
    ]);
    expect(problems.join('\n')).toContain('/birthday list');
  });

  it('rejects more than 25 subcommands under one command', () => {
    const options = Array.from({ length: 26 }, (_, index) => ({
      type: 1,
      name: `sub-${index}`,
      description: 'A subcommand',
    }));
    expect(
      validateCommandMetadata([{ ...valid(), name: 'many', options } as CommandPayload]).join('\n'),
    ).toContain('26');
  });

  it('rejects more than 100 root commands and duplicated names', () => {
    const many = Array.from({ length: 101 }, (_, index) => ({
      ...valid(),
      name: `cmd-${index}`,
    }));
    expect(validateCommandMetadata(many).join('\n')).toContain('101 root commands');
    expect(validateCommandMetadata([valid(), valid()]).join('\n')).toContain('more than once');
  });

  it('does not ask a context-menu command for a description', () => {
    expect(validateCommandMetadata([{ name: 'quote', type: 3 }])).toEqual([]);
  });

  it.each([2, 3])('lets a type %i context menu use capitals and spaces in its name', (type) => {
    const entry = {
      name: 'Purge up to here',
      type,
      name_localizations: { vi: 'Xoá đến đây' },
    } as CommandPayload;
    expect(validateCommandMetadata([entry])).toEqual([]);
  });

  it('still limits a context menu name to 1..32 characters, and forbids a description', () => {
    const tooLong = { name: 'x'.repeat(33), type: 3 } as CommandPayload;
    expect(validateCommandMetadata([tooLong]).join('\n')).toContain('1..32');
    const localisedTooLong = {
      name: 'Short',
      type: 3,
      name_localizations: { vi: 'y'.repeat(33) },
    } as CommandPayload;
    expect(validateCommandMetadata([localisedTooLong]).join('\n')).toContain('localisation vi');
    const described = { name: 'Short', type: 2, description: 'No such thing' } as CommandPayload;
    expect(validateCommandMetadata([described]).join('\n')).toContain('no description');
  });

  it('keeps the strict name pattern for chat commands next to a context menu', () => {
    const problems = validateCommandMetadata([
      { name: 'Ping Pong', description: 'x', type: 1 },
      { name: 'Ping Pong', type: 3 },
    ] as CommandPayload[]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain('/Ping Pong: name must match');
  });

  it('allows a chat command and a context menu to share a name', () => {
    expect(
      validateCommandMetadata([
        { name: 'purge', description: 'x', type: 1 },
        { name: 'purge', type: 3 },
      ] as CommandPayload[]),
    ).toEqual([]);
  });
});
