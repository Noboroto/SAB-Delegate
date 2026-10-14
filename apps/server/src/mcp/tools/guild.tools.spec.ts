import 'reflect-metadata';
import { Client } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GuildAccessService } from '../../common/guild-access/guild-access.service.js';
import { HARNESS_USER, startMcp } from '../mcp.test-harness.js';
import { checkToolRow } from '../tool-definition.js';
import { GUILD_TOOLS } from './guild.tools.js';

const MINE = '444444444444444441';
const NOT_MINE = '444444444444444442';

type Mcp = Awaited<ReturnType<typeof startMcp>>;

describe('guild tools', () => {
  let mcp: Mcp | undefined;
  afterEach(async () => {
    await mcp?.close();
    mcp = undefined;
  });

  const start = async (mode: 'READ' | 'WRITE' = 'READ') => {
    const canManage = vi.fn((_user: string, guildId: string) => Promise.resolve(guildId === MINE));
    const client = {
      guilds: {
        cache: new Map([
          [MINE, { id: MINE, name: 'Study Group', icon: 'abc' }],
          [NOT_MINE, { id: NOT_MINE, name: 'Elsewhere', icon: null }],
        ]),
      },
    };
    mcp = await startMcp({
      rows: GUILD_TOOLS,
      mode,
      services: new Map<never, unknown>([
        [GuildAccessService as never, { canManage }],
        [Client as never, client],
      ]),
    });
    return canManage;
  };

  it('passes the registry row checks', () => {
    const classes = new Map<string, { prototype: object }>([
      [GuildAccessService.name, GuildAccessService],
    ]);
    expect(GUILD_TOOLS.flatMap((row) => checkToolRow(row, classes))).toEqual([]);
  });

  it('shows guild_list to a READ key', async () => {
    await start('READ');
    expect(mcp?.registeredTools.has('guild_list')).toBe(true);
  });

  it("lists only the bot's servers the key's owner may manage, with no guildId and no access gate", async () => {
    const canManage = await start();
    const reply = await mcp?.call('guild_list');
    expect(reply?.failed).toBe(false);
    expect(reply?.json()).toMatchObject({
      data: [{ id: MINE, name: 'Study Group', icon: 'abc' }],
    });
    expect(canManage).toHaveBeenCalledWith(HARNESS_USER, MINE);
    expect(canManage).toHaveBeenCalledWith(HARNESS_USER, NOT_MINE);
    expect(mcp?.assertManageGuild).not.toHaveBeenCalled();
  });
});
