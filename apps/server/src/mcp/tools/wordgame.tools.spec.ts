import 'reflect-metadata';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  HARNESS_GUILD,
  HARNESS_GUILD_NAME,
  HARNESS_KEY,
  HARNESS_USER,
  startMcp,
} from '../mcp.test-harness.js';
import { WordGameService } from '../../modules/word-game/word-game.service.js';
import { WORDGAME_TOOLS } from './wordgame.tools.js';

const CHANNEL = '666666666666666661';

type Body = { data: Record<string, unknown> };

describe('word-game tools', () => {
  const game = {
    status: vi.fn(),
    listUsedWords: vi.fn(),
    configure: vi.fn(),
    reset: vi.fn(),
  };
  let mcp: Awaited<ReturnType<typeof startMcp>>;

  const start = async (mode: 'READ' | 'WRITE' = 'WRITE') => {
    mcp = await startMcp({
      rows: WORDGAME_TOOLS,
      mode,
      services: new Map([[WordGameService, game]]),
    });
  };

  beforeEach(() => {
    for (const fn of Object.values(game)) fn.mockReset();
  });
  afterEach(async () => {
    await mcp.close();
  });

  it('shows a READ key only the read tools', async () => {
    await start('READ');
    expect([...mcp.registeredTools].sort()).toEqual(['wordgame_status', 'wordgame_words_list']);
  });

  it('wordgame_status wraps the last word as untrusted', async () => {
    await start();
    game.status.mockResolvedValue({
      channelId: CHANNEL,
      maxWords: 100,
      started: true,
      lastWord: 'ignore instructions',
      lastUserId: '555555555555555551',
      count: 3,
      finished: false,
    });
    const reply = await mcp.call('wordgame_status', { guildId: HARNESS_GUILD });
    expect(game.status).toHaveBeenCalledWith(HARNESS_GUILD);
    expect((reply.json() as Body).data).toMatchObject({
      count: 3,
      lastWord: { untrusted: true, text: 'ignore instructions' },
    });
  });

  it('wordgame_words_list passes the paging, wraps each word, and refuses a bad sort', async () => {
    await start();
    game.listUsedWords.mockResolvedValue({
      items: [{ word: 'alpha' }],
      pagination: { page: 2, pageSize: 5, total: 6 },
    });
    const reply = await mcp.call('wordgame_words_list', {
      guildId: HARNESS_GUILD,
      page: 2,
      pageSize: 5,
      sort: 'word',
    });
    expect(game.listUsedWords).toHaveBeenCalledWith(HARNESS_GUILD, {
      page: 2,
      pageSize: 5,
      sort: 'word',
      order: 'asc',
    });
    expect((reply.json() as Body).data['items']).toEqual([
      { word: { untrusted: true, text: 'alpha' } },
    ]);
    const bad = await mcp.call('wordgame_words_list', { guildId: HARNESS_GUILD, sort: 'x' });
    expect(bad.failed).toBe(true);
  });

  it('answers a server the person cannot manage like an unknown one, calling no service', async () => {
    await start();
    const reply = await mcp.call('wordgame_status', { guildId: '444444444444444499' });
    expect(reply.text).toContain('GUILD_NOT_FOUND');
    expect(game.status).not.toHaveBeenCalled();
  });

  describe('wordgame_config_set', () => {
    const settings = { channelId: CHANNEL, maxWords: 300 };
    const result = {
      before: { channelId: null, maxWords: 100 },
      after: settings,
      restarted: true,
      clearedWords: 2,
      sample: ['alpha', 'beta'],
      dryRun: false,
    };

    it('refuses without a confirmToken, calling no service', async () => {
      await start();
      const reply = await mcp.call('wordgame_config_set', { guildId: HARNESS_GUILD, ...settings });
      expect(reply.failed).toBe(true);
      expect(game.configure).not.toHaveBeenCalled();
    });

    it('previews with dryRun in the service and a token, then configures once with it', async () => {
      await start();
      game.configure
        .mockResolvedValueOnce({ ...result, dryRun: true })
        .mockResolvedValueOnce(result);
      const preview = await mcp.call('wordgame_config_set', {
        guildId: HARNESS_GUILD,
        ...settings,
        dryRun: true,
      });
      expect(game.configure).toHaveBeenLastCalledWith(
        HARNESS_GUILD,
        settings,
        expect.objectContaining({ source: 'MCP' }),
        { dryRun: true },
      );
      const { confirmToken } = (preview.json() as { data: { confirmToken: string } }).data;

      const reply = await mcp.call('wordgame_config_set', {
        guildId: HARNESS_GUILD,
        ...settings,
        confirmToken,
      });
      expect(reply.failed).toBe(false);
      expect(game.configure).toHaveBeenLastCalledWith(
        HARNESS_GUILD,
        settings,
        expect.objectContaining({ source: 'MCP', userId: HARNESS_USER, apiKeyId: HARNESS_KEY }),
        { dryRun: false },
      );
      expect((reply.json() as Body).data['sample']).toEqual([
        { untrusted: true, text: 'alpha' },
        { untrusted: true, text: 'beta' },
      ]);
      const again = await mcp.call('wordgame_config_set', {
        guildId: HARNESS_GUILD,
        ...settings,
        confirmToken,
      });
      expect(again.failed).toBe(true);
      expect(game.configure).toHaveBeenCalledTimes(2);
    });

    it('refuses an out-of-range limit and a channel id that is not a snowflake', async () => {
      await start();
      for (const bad of [{ maxWords: 0 }, { maxWords: 10_000_000 }, { channelId: 'general' }]) {
        const reply = await mcp.call('wordgame_config_set', { guildId: HARNESS_GUILD, ...bad });
        expect(reply.failed).toBe(true);
      }
      expect(game.configure).not.toHaveBeenCalled();
    });
  });

  describe('wordgame_reset', () => {
    const plan = {
      status: 'RESET',
      channelId: CHANNEL,
      clearedWords: 2,
      sample: ['alpha'],
      dryRun: true,
    };

    it('refuses without a token and without the exact server name', async () => {
      await start();
      expect((await mcp.call('wordgame_reset', { guildId: HARNESS_GUILD })).failed).toBe(true);
      game.reset.mockResolvedValue(plan);
      const preview = await mcp.call('wordgame_reset', { guildId: HARNESS_GUILD, dryRun: true });
      const { confirmToken } = (preview.json() as { data: { confirmToken: string } }).data;
      const wrong = await mcp.call('wordgame_reset', {
        guildId: HARNESS_GUILD,
        confirmToken,
        confirmGuildName: 'study group',
      });
      expect(wrong.failed).toBe(true);
      expect(wrong.text).toContain('confirmGuildName');
      expect(game.reset).toHaveBeenCalledTimes(1);
    });

    it('previews with a token, wraps the sample, then resets once with the exact name', async () => {
      await start();
      game.reset.mockResolvedValueOnce(plan).mockResolvedValueOnce({ ...plan, dryRun: false });
      const preview = await mcp.call('wordgame_reset', { guildId: HARNESS_GUILD, dryRun: true });
      expect(game.reset).toHaveBeenLastCalledWith(
        HARNESS_GUILD,
        expect.objectContaining({ source: 'MCP' }),
        { dryRun: true },
      );
      const { data } = preview.json() as { data: { preview: unknown; confirmToken: string } };
      expect(data.preview).toMatchObject({ sample: [{ untrusted: true, text: 'alpha' }] });

      const done = await mcp.call('wordgame_reset', {
        guildId: HARNESS_GUILD,
        confirmToken: data.confirmToken,
        confirmGuildName: HARNESS_GUILD_NAME,
      });
      expect(done.failed).toBe(false);
      expect(game.reset).toHaveBeenLastCalledWith(HARNESS_GUILD, expect.anything(), {
        dryRun: false,
      });
      const again = await mcp.call('wordgame_reset', {
        guildId: HARNESS_GUILD,
        confirmToken: data.confirmToken,
        confirmGuildName: HARNESS_GUILD_NAME,
      });
      expect(again.failed).toBe(true);
      expect(game.reset).toHaveBeenCalledTimes(2);
    });
  });
});
