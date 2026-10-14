import { ChannelType, type Client } from 'discord.js';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GUILD,
  asUser,
  createRestApp,
  expectGuarded,
  expectInvalid,
  snowflake,
  type RestTestApp,
} from '../../common/rest/rest-test-app.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { CommandsCatalogService } from './commands-catalog.service.js';
import { DiscordLookupService } from './discord-lookup.service.js';
import { SystemController } from './system.controller.js';
import { SystemService } from './system.service.js';

const system = { getStatus: vi.fn() };
const audit = { list: vi.fn() };
const catalog = { list: vi.fn() };
const lookup = { channels: vi.fn(), roles: vi.fn(), members: vi.fn() };
const base = `/api/guilds/${GUILD}`;
let test: RestTestApp;

beforeAll(async () => {
  test = await createRestApp(
    [SystemController],
    [
      { provide: SystemService, useValue: system },
      { provide: AuditService, useValue: audit },
      { provide: CommandsCatalogService, useValue: catalog },
      { provide: DiscordLookupService, useValue: lookup },
    ],
  );
});
afterAll(async () => {
  await test.app.close();
});
beforeEach(() => {
  vi.clearAllMocks();
});

const get = (path: string) => ({ method: 'GET' as const, url: `${base}/${path}` });
const send = (path: string) => test.app.inject({ ...get(path), headers: asUser() });

describe('every route of the controller', () => {
  it.each([
    'overview',
    'audit-logs',
    'commands',
    'discord/channels',
    'discord/roles',
    'discord/members?q=a',
  ])('is closed to strangers and to people who may not manage the server: %s', async (path) => {
    await expectGuarded(test, get(path));
  });
});

describe('GET overview', () => {
  it('answers the bot health and not the number of servers', async () => {
    system.getStatus.mockReturnValue({ uptimeMs: 5, wsPing: 40, guildCount: 9 });
    expect((await send('overview')).json()).toEqual({ uptimeMs: 5, wsPing: 40 });
  });
});

describe('GET audit-logs', () => {
  it('lists the path server with the cursor and filters parsed, and strips columns outside the view', async () => {
    const id = '0198a2c4-6f5e-7a31-8c1d-2f3a4b5c6d7e';
    audit.list.mockResolvedValue({
      items: [
        {
          id,
          source: 'HTTP',
          actorDiscordId: snowflake(5),
          apiKeyId: null,
          action: 'note.upsert',
          params: { topic: 'rules' },
          ok: true,
          error: null,
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
          guildId: 'internal',
        },
      ],
      nextCursor: id,
    });
    const response = await send(
      `audit-logs?limit=10&cursor=${id}&action=note.upsert&source=MCP&since=2026-01-01T00:00:00Z`,
    );
    expect(response.statusCode).toBe(200);
    const body = response.json<{ items: Array<Record<string, unknown>>; nextCursor: string }>();
    expect(body.nextCursor).toBe(id);
    expect(body.items[0]).not.toHaveProperty('guildId');
    expect(audit.list).toHaveBeenCalledWith({
      guildId: GUILD,
      limit: 10,
      cursor: id,
      action: 'note.upsert',
      source: 'MCP',
      since: new Date('2026-01-01T00:00:00Z'),
    });
  });

  it('rejects a limit over the maximum, an action that does not exist and a bad cursor', async () => {
    await expectInvalid(test, get('audit-logs?limit=1000'), 'limit');
    await expectInvalid(test, get('audit-logs?action=drop.table'), 'action');
    await expectInvalid(test, get('audit-logs?cursor=1'), 'cursor');
    await expectInvalid(test, get('audit-logs?source=ROOT'), 'source');
  });
});

describe('GET commands', () => {
  it('lists the catalog in the language asked for, Vietnamese by default', async () => {
    catalog.list.mockReturnValue([]);
    await send('commands');
    await send('commands?locale=en');
    expect(catalog.list.mock.calls).toEqual([['vi'], ['en']]);
    await expectInvalid(test, get('commands?locale=fr'), 'locale');
  });

  it('answers only the fields of the catalog schema', async () => {
    catalog.list.mockReturnValue([
      {
        name: 'poll',
        description: 'Make a poll',
        defaultMemberPermissions: null,
        guildOnly: true,
        subcommands: [{ name: 'poll add', description: 'Add', handlerId: 'x' }],
        applicationId: 'internal',
      },
    ]);
    const response = await send('commands');
    expect(response.json()).toEqual([
      {
        name: 'poll',
        description: 'Make a poll',
        defaultMemberPermissions: null,
        guildOnly: true,
        subcommands: [{ name: 'poll add', description: 'Add' }],
      },
    ]);
  });
});

describe('Discord lookups', () => {
  it('passes the path server and the search text to the service', async () => {
    lookup.channels.mockReturnValue([]);
    lookup.roles.mockReturnValue([]);
    lookup.members.mockResolvedValue([]);
    await send('discord/channels');
    await send('discord/roles');
    await send('discord/members?q=%20an%20');
    expect(lookup.channels).toHaveBeenCalledWith(GUILD);
    expect(lookup.roles).toHaveBeenCalledWith(GUILD);
    expect(lookup.members).toHaveBeenCalledWith(GUILD, 'an');
  });

  it('wants a search text of 1 to 100 characters', async () => {
    await expectInvalid(test, get('discord/members'), 'q');
    await expectInvalid(test, get('discord/members?q=%20'), 'q');
    await expectInvalid(test, get(`discord/members?q=${'a'.repeat(101)}`), 'q');
  });
});

describe('DiscordLookupService', () => {
  const textChannel = {
    id: snowflake(70),
    name: 'general',
    type: ChannelType.GuildText,
    parentId: snowflake(71),
    position: 2,
    isThread: () => false,
  };
  const thread = { ...textChannel, id: snowflake(72), isThread: () => true };
  const role = {
    id: snowflake(80),
    name: 'mod',
    colors: { primaryColor: 3, secondaryColor: null, tertiaryColor: null },
    position: 4,
    managed: false,
    permissions: 'secret',
  };

  function build() {
    const guild = {
      channels: {
        cache: new Map([
          [textChannel.id, textChannel],
          [thread.id, thread],
        ]),
      },
      roles: { cache: new Map([[role.id, role]]) },
      members: { search: vi.fn() },
    };
    const client = { guilds: { cache: new Map([[GUILD, guild]]) } };
    return { guild, service: new DiscordLookupService(client as unknown as Client) };
  }

  it('returns channels without threads and roles without anything but the picker fields', () => {
    const { service } = build();
    expect(service.channels(GUILD)).toEqual([
      {
        id: textChannel.id,
        name: 'general',
        type: ChannelType.GuildText,
        parentId: textChannel.parentId,
        position: 2,
      },
    ]);
    expect(service.roles(GUILD)).toEqual([
      { id: role.id, name: 'mod', color: 3, position: 4, managed: false },
    ]);
  });

  it('searches members with the fixed limit and returns four fields', async () => {
    const { service, guild } = build();
    guild.members.search.mockResolvedValue(
      new Map([
        [
          snowflake(90),
          {
            id: snowflake(90),
            displayName: 'An',
            user: { username: 'an', bot: false, email: 'x' },
          },
        ],
      ]),
    );
    expect(await service.members(GUILD, 'an')).toEqual([
      { id: snowflake(90), username: 'an', displayName: 'An', bot: false },
    ]);
    expect(guild.members.search).toHaveBeenCalledWith({ query: 'an', limit: 25 });
  });

  it('treats a server the bot is not in, or an id that is not one, as missing', () => {
    const { service } = build();
    expect(() => service.roles(snowflake(999))).toThrow(
      expect.objectContaining({ code: 'GUILD_BOT_MISSING' }) as Error,
    );
    expect(() => service.channels('x')).toThrow(
      expect.objectContaining({ code: 'GUILD_BOT_MISSING' }) as Error,
    );
  });
});
