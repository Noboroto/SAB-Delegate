import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GuildConfigService } from '../../modules/guild-config/guild-config.service.js';
import { HARNESS_GUILD, HARNESS_KEY, HARNESS_USER, startMcp } from '../mcp.test-harness.js';
import { checkToolRow } from '../tool-definition.js';
import { GUILD_CONFIG_TOOLS } from './guild-config.tools.js';

const CHANNEL = '444444444444444451';
const UNKNOWN_GUILD = '444444444444444443';

const SETTINGS = {
  introChannelId: null,
  logChannelId: null,
  birthdayChannelId: null,
  activityCategoryId: null,
  wordChannelId: null,
  wordMaxWords: 1500,
  locale: 'vi',
};

type Mcp = Awaited<ReturnType<typeof startMcp>>;

describe('guild config tools', () => {
  let service: { get: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn> };
  let mcp: Mcp;

  const start = async (mode: 'READ' | 'WRITE' = 'WRITE') => {
    mcp = await startMcp({
      rows: GUILD_CONFIG_TOOLS,
      mode,
      services: new Map<never, unknown>([[GuildConfigService as never, service]]),
    });
  };

  beforeEach(() => {
    service = {
      get: vi.fn(() => Promise.resolve(SETTINGS)),
      patch: vi.fn((_g: string, patch: object, _a: unknown, opts: { dryRun?: boolean }) =>
        Promise.resolve(
          opts.dryRun === true
            ? { before: SETTINGS, after: { ...SETTINGS, ...patch } }
            : { ...SETTINGS, ...patch },
        ),
      ),
    };
  });
  afterEach(async () => {
    await mcp.close();
  });

  it('show only the read tool to a READ key and both to a WRITE key', async () => {
    await start('READ');
    expect([...mcp.registeredTools]).toEqual(['guild_config_get']);
    await mcp.close();
    await start('WRITE');
    expect([...mcp.registeredTools].sort()).toEqual(['guild_config_get', 'guild_config_set']);
  });

  it('read the settings of the named server', async () => {
    await start();
    const reply = await mcp.call('guild_config_get', { guildId: HARNESS_GUILD });
    expect(reply.json()).toMatchObject({ data: SETTINGS });
    expect(service.get).toHaveBeenCalledWith(HARNESS_GUILD);
  });

  it('answer a server the person cannot manage without reaching the service', async () => {
    await start();
    const read = await mcp.call('guild_config_get', { guildId: UNKNOWN_GUILD });
    const write = await mcp.call('guild_config_set', {
      guildId: UNKNOWN_GUILD,
      logChannelId: CHANNEL,
      dryRun: true,
    });
    expect(read.failed).toBe(true);
    expect(write.failed).toBe(true);
    expect(read.text).toContain('GUILD_NOT_FOUND');
    expect(service.get).not.toHaveBeenCalled();
    expect(service.patch).not.toHaveBeenCalled();
  });

  it('preview with dryRun, then change only with the issued token, naming the MCP key as the actor', async () => {
    await start();
    const preview = await mcp.call('guild_config_set', {
      guildId: HARNESS_GUILD,
      logChannelId: CHANNEL,
      dryRun: true,
    });
    const body = preview.json() as {
      data: { confirmToken: string; preview: { before: object; after: object } };
    };
    expect(body.data.preview.after).toMatchObject({ logChannelId: CHANNEL });
    expect(service.patch).toHaveBeenCalledWith(
      HARNESS_GUILD,
      { logChannelId: CHANNEL },
      expect.objectContaining({ source: 'MCP', userId: HARNESS_USER, apiKeyId: HARNESS_KEY }),
      { dryRun: true },
    );

    const done = await mcp.call('guild_config_set', {
      guildId: HARNESS_GUILD,
      logChannelId: CHANNEL,
      confirmToken: body.data.confirmToken,
    });
    expect(done.failed).toBe(false);
    expect(service.patch).toHaveBeenLastCalledWith(
      HARNESS_GUILD,
      { logChannelId: CHANNEL },
      expect.objectContaining({ source: 'MCP' }),
      { dryRun: false },
    );
  });

  it('refuse a change without a token, and a token issued for other settings', async () => {
    await start();
    const bare = await mcp.call('guild_config_set', {
      guildId: HARNESS_GUILD,
      logChannelId: CHANNEL,
    });
    expect(bare.failed).toBe(true);
    const { token } = mcp.tokens.issue(HARNESS_KEY, 'guild_config_set', {
      guildId: HARNESS_GUILD,
      logChannelId: CHANNEL,
    });
    const other = await mcp.call('guild_config_set', {
      guildId: HARNESS_GUILD,
      introChannelId: CHANNEL,
      confirmToken: token,
    });
    expect(other.failed).toBe(true);
    expect(service.patch).not.toHaveBeenCalled();
  });

  it('pass null through so a channel can be cleared, and refuse a channel id that is not a snowflake', async () => {
    await start();
    await mcp.call('guild_config_set', {
      guildId: HARNESS_GUILD,
      logChannelId: null,
      dryRun: true,
    });
    expect(service.patch).toHaveBeenCalledWith(
      HARNESS_GUILD,
      { logChannelId: null },
      expect.anything(),
      { dryRun: true },
    );
    const bad = await mcp.call('guild_config_set', {
      guildId: HARNESS_GUILD,
      logChannelId: 'general',
      dryRun: true,
    });
    expect(bad.failed).toBe(true);
    expect(service.patch).toHaveBeenCalledTimes(1);
  });
});

describe('guild config tools registry rows', () => {
  it('pass the registry row checks', () => {
    const classes = new Map<string, { prototype: object }>([
      [GuildConfigService.name, GuildConfigService],
    ]);
    expect(GUILD_CONFIG_TOOLS.flatMap((row) => checkToolRow(row, classes))).toEqual([]);
  });
});
