import { Logger } from '@nestjs/common';
import type { ChatbotRecentTurn } from '@sab/shared';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { BirthdayService } from '../birthday/birthday.service.js';
import type { GameChannelService } from '../game-core/game-channel.service.js';
import type { LeaderboardService } from '../game-core/leaderboard.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import type { CommandsCatalogService } from '../system/commands-catalog.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import type { ChatbotHistoryService } from './chatbot-history.service.js';
import type { ChatbotIntroService } from './chatbot-intro.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';
import { TOOL_RESULT_MAX_BYTES } from './chatbot-tool-output.js';
import { ChatbotToolsService } from './chatbot-tools.service.js';

const GUILD = '100000000000000001';
const ASKER = '300000000000000001';
const OTHER = '400000000000000001';
const OTHER_GUILD = '100000000000000002';
const CHANNEL = '200000000000000001';

const MODEL = { name: 'model-x', source: 'global' as const };

type Callable = {
  inputSchema: { parse(input: unknown): unknown };
  execute(input: unknown, options: object): unknown;
};

function setup() {
  const list = vi.fn((_locale: string) => [
    {
      name: 'poll',
      description: 'Tạo poll <script>',
      defaultMemberPermissions: '32',
      guildOnly: true,
      subcommands: [{ name: 'poll create', description: 'Tạo poll mới' }],
    },
    {
      name: 'ping',
      description: 'Kiểm tra bot',
      defaultMemberPermissions: null,
      guildOnly: false,
      subcommands: [],
    },
  ]);
  const board = vi.fn((_guild: string, _game: string, _user: string) =>
    Promise.resolve({
      top: [
        { userId: OTHER, points: 9, rank: 1 },
        { userId: ASKER, points: 5, rank: 2 },
        { userId: '400000000000000009', points: 1, rank: 3 },
      ],
      you: { userId: ASKER, points: 5, rank: 2 },
    }),
  );
  const channelOf = vi.fn((_guild: string, game: string) =>
    Promise.resolve(game === 'WORDLE' ? CHANNEL : null),
  );
  const guildGet = vi.fn((_guild: string) =>
    Promise.resolve({
      wordChannelId: CHANNEL,
      introChannelId: null,
      birthdayChannelId: null,
      logChannelId: '999999999999999999',
    }),
  );
  const chatbotGet = vi.fn((_guild: string) =>
    Promise.resolve({
      enabled: true,
      channels: [CHANNEL],
      llm: {
        source: 'guild',
        baseUrl: 'https://secret-host.example',
        model: 'm',
        keyLast4: 'abcd',
      },
    }),
  );
  const birthdayList = vi.fn((_guild: string, _filter: { month?: number }) =>
    Promise.resolve([
      { studentId: '2012345', name: 'Lan <b>', discordId: OTHER, month: 10, day: 18 },
      { studentId: '2012346', name: 'Hùng', discordId: null, month: 10, day: 25 },
      { studentId: '2012347', name: 'Mai', discordId: null, month: 10, day: 17 },
    ]),
  );
  const limitOf = vi.fn((_guild: string, _user: string) =>
    Promise.resolve({
      used: 40,
      remaining: 60,
      total: 100,
      limit: 100,
      bonus: 0,
      overridden: false,
    }),
  );
  const recentFor = vi.fn((_guild: string, _user: string): Promise<ChatbotRecentTurn[]> =>
    Promise.resolve([
      {
        triggerMessageId: '1',
        replyMessageId: '2',
        question: 'câu cũ <@123>',
        answer: 'đáp cũ',
        createdAt: '2026-10-16T01:00:00.000Z',
      },
      {
        triggerMessageId: '3',
        replyMessageId: '4',
        question: 'câu mới',
        answer: 'đáp mới',
        createdAt: '2026-10-16T02:00:00.000Z',
      },
    ]),
  );
  const lookup = vi.fn((_guild: string, _member: string, _signal?: AbortSignal) =>
    Promise.resolve({ status: 'NOT_FOUND', member: `<@${OTHER}>`, scanned: 3 }),
  );
  const channel = { name: 'trò-chơi' };
  const client = {
    guilds: {
      cache: {
        get: (id: string) =>
          id === GUILD ? { channels: { cache: { get: () => channel } } } : undefined,
      },
    },
  };
  const service = new ChatbotToolsService(
    { list } as unknown as CommandsCatalogService,
    { board } as unknown as LeaderboardService,
    { channelOf } as unknown as GameChannelService,
    { get: guildGet } as unknown as GuildConfigService,
    { get: chatbotGet } as unknown as ChatbotConfigService,
    { list: birthdayList } as unknown as BirthdayService,
    { limitOf } as unknown as ChatbotQuotaService,
    { recentFor } as unknown as ChatbotHistoryService,
    { lookup } as unknown as ChatbotIntroService,
    client as never,
  );
  const tools = service.build({
    guildId: GUILD,
    askerId: ASKER,
    held: 0,
    locale: 'vi',
    model: MODEL,
  });
  const tool = (name: string) => (tools as unknown as Record<string, Callable>)[name] as Callable;
  const call = (name: string, input: unknown = {}, abortSignal?: AbortSignal) => {
    const t = tool(name);
    return Promise.resolve(
      t.execute(t.inputSchema.parse(input), { toolCallId: 't', messages: [], abortSignal }),
    );
  };
  /** The same tools for a turn that holds `held` tokens. */
  const callHolding = (held: number, name: string) => {
    const holding = service.build({
      guildId: GUILD,
      askerId: ASKER,
      held,
      locale: 'vi',
      model: MODEL,
    }) as unknown as Record<string, Callable>;
    const t = holding[name] as Callable;
    return Promise.resolve(t.execute({}, { toolCallId: 't', messages: [] }));
  };
  return {
    tools,
    tool,
    call,
    callHolding,
    list,
    board,
    channelOf,
    guildGet,
    chatbotGet,
    birthdayList,
    limitOf,
    recentFor,
    lookup,
  };
}

let warn: MockInstance;

beforeEach(() => {
  warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('ChatbotToolsService', () => {
  it('offers exactly the eight read-only tools', () => {
    expect(Object.keys(setup().tools).sort()).toEqual([
      'birthdays',
      'current_model',
      'game_leaderboard',
      'get_intro',
      'list_commands',
      'my_quota',
      'my_recent_turns',
      'server_channels',
    ]);
  });

  it('takes no server or member id from the model: crafted arguments are stripped', async () => {
    const s = setup();
    for (const name of Object.keys(s.tools)) {
      const parsed = s.tool(name).inputSchema.parse({
        game: 'WORDLE',
        member: 'x',
        guildId: OTHER_GUILD,
        userId: OTHER,
        askerId: OTHER,
      }) as Record<string, unknown>;
      expect(parsed).not.toHaveProperty('guildId');
      expect(parsed).not.toHaveProperty('userId');
      expect(parsed).not.toHaveProperty('askerId');
    }
    await s.call('game_leaderboard', { game: 'WORD_CHAIN', guildId: OTHER_GUILD, userId: OTHER });
    await s.call('my_quota', { userId: OTHER, guildId: OTHER_GUILD });
    await s.call('my_recent_turns', { userId: OTHER });
    await s.call('birthdays', { guildId: OTHER_GUILD });
    await s.call('server_channels', { guildId: OTHER_GUILD });
    await s.call('get_intro', { member: 'Lan', guildId: OTHER_GUILD });
    expect(s.board).toHaveBeenCalledWith(GUILD, 'WORD_CHAIN', ASKER);
    expect(s.limitOf).toHaveBeenCalledWith(GUILD, ASKER);
    expect(s.recentFor).toHaveBeenCalledWith(GUILD, ASKER);
    expect(s.birthdayList.mock.calls.every(([guild]) => guild === GUILD)).toBe(true);
    expect(s.guildGet).toHaveBeenCalledWith(GUILD);
    expect(s.chatbotGet).toHaveBeenCalledWith(GUILD);
    expect(s.lookup).toHaveBeenCalledWith(GUILD, 'Lan', undefined);
  });

  describe('list_commands', () => {
    it('lists the registered commands in the guild locale, with who may use them', async () => {
      const s = setup();
      const result = (await s.call('list_commands')) as { commands: Record<string, unknown>[] };
      expect(s.list).toHaveBeenCalledWith('vi');
      expect(result.commands).toEqual([
        {
          command: '/poll',
          description: 'Tạo poll ‹script›',
          restricted: true,
          subcommands: [{ command: '/poll create', description: 'Tạo poll mới' }],
        },
        { command: '/ping', description: 'Kiểm tra bot', restricted: false, subcommands: [] },
      ]);
    });

    it('filters by a word in the name, the text or a subcommand, ignoring case', async () => {
      const s = setup();
      const byName = (await s.call('list_commands', { query: 'PING' })) as { commands: unknown[] };
      expect(byName.commands).toHaveLength(1);
      const bySub = (await s.call('list_commands', { query: 'mới' })) as { commands: unknown[] };
      expect(bySub.commands).toHaveLength(1);
      const none = (await s.call('list_commands', { query: 'zzz' })) as { commands: unknown[] };
      expect(none.commands).toEqual([]);
    });

    it('stays within the size cap however many commands exist', async () => {
      const s = setup();
      s.list.mockReturnValue(
        Array.from({ length: 200 }, (_, i) => ({
          name: `cmd${i}`,
          description: 'm'.repeat(150),
          defaultMemberPermissions: null,
          guildOnly: false,
          subcommands: [],
        })),
      );
      const result = (await s.call('list_commands')) as { commands: unknown[]; truncated?: true };
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(TOOL_RESULT_MAX_BYTES);
      expect(result.truncated).toBe(true);
      expect(result.commands.length).toBeGreaterThan(0);
    });
  });

  describe('game_leaderboard', () => {
    it('shows members as mentions, honours the limit and returns the asker rank', async () => {
      const s = setup();
      const result = await s.call('game_leaderboard', { game: 'WORDLE', limit: 2 });
      expect(result).toEqual({
        game: 'WORDLE',
        top: [
          { rank: 1, member: `<@${OTHER}>`, points: 9 },
          { rank: 2, member: `<@${ASKER}>`, points: 5 },
        ],
        you: { rank: 2, member: `<@${ASKER}>`, points: 5 },
      });
    });

    it('refuses a limit over ten and an unknown game', () => {
      const s = setup();
      const schema = s.tool('game_leaderboard').inputSchema;
      expect(() => schema.parse({ game: 'WORDLE', limit: 11 })).toThrow();
      expect(() => schema.parse({ game: 'CHESS' })).toThrow();
    });
  });

  describe('server_channels', () => {
    it('names the configured channels and leaks nothing of the model or the log channel', async () => {
      const s = setup();
      const result = await s.call('server_channels');
      expect(result).toMatchObject({
        wordChain: { channel: `<#${CHANNEL}>`, name: 'trò-chơi' },
        introductions: null,
        chatbot: { enabled: true, channels: [{ channel: `<#${CHANNEL}>`, name: 'trò-chơi' }] },
      });
      const text = JSON.stringify(result);
      expect(text).not.toContain('secret-host');
      expect(text).not.toContain('abcd');
      expect(text).not.toContain('999999999999999999');
      expect(text).toContain('WORDLE');
    });
  });

  describe('birthdays', () => {
    it('gives day and month only: no year, no student id, a mention when the member is linked', async () => {
      const s = setup();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-16T17:11:00Z'));
      const result = (await s.call('birthdays')) as { birthdays: Record<string, unknown>[] };
      expect(s.birthdayList).toHaveBeenCalledWith(GUILD, { month: 10 });
      expect(result.birthdays).toEqual([
        { who: 'Mai', day: 17, month: 10 },
        { who: `<@${OTHER}>`, day: 18, month: 10 },
        { who: 'Hùng', day: 25, month: 10 },
      ]);
      const text = JSON.stringify(result);
      expect(text).not.toContain('2012345');
      expect(text).not.toMatch(/year/iu);
      expect(text).not.toContain('<b>');
    });

    it('reads the month asked for', async () => {
      const s = setup();
      await s.call('birthdays', { month: 3 });
      expect(s.birthdayList).toHaveBeenCalledWith(GUILD, { month: 3 });
    });

    it('limits upcoming days to the window starting today (Vietnam time)', async () => {
      const s = setup();
      vi.useFakeTimers({ toFake: ['Date'] });
      // 00:11 on 17/10 in Vietnam is still 16/10 in UTC.
      vi.setSystemTime(new Date('2026-10-16T17:11:00Z'));
      const result = (await s.call('birthdays', { upcomingDays: 3 })) as {
        birthdays: { day: number }[];
      };
      expect(result.birthdays.map((b) => b.day)).toEqual([17, 18]);
    });

    it('asks for both months when the window crosses a month end', async () => {
      const s = setup();
      s.birthdayList.mockResolvedValue([]);
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
      await s.call('birthdays', { upcomingDays: 5 });
      expect(s.birthdayList.mock.calls.map(([, filter]) => filter.month).sort()).toEqual([10, 11]);
    });

    it('refuses more than a month of upcoming days', () => {
      expect(() => setup().tool('birthdays').inputSchema.parse({ upcomingDays: 32 })).toThrow();
    });
  });

  describe('the asker own data', () => {
    it('my_quota reports the month and when it renews', async () => {
      const result = (await setup().call('my_quota')) as Record<string, unknown>;
      expect(result).toMatchObject({ used: 40, remaining: 60, total: 100 });
      expect(result.renews).toMatch(/^<t:\d+:R>$/u);
    });

    it('my_quota adds back the tokens held for the reply being written', async () => {
      const s = setup();
      s.limitOf.mockResolvedValue({
        used: 100,
        remaining: 0,
        total: 100,
        limit: 100,
        bonus: 0,
        overridden: false,
      });
      expect(await s.callHolding(30, 'my_quota')).toMatchObject({
        used: 70,
        remaining: 30,
        total: 100,
      });
      expect(await s.callHolding(500, 'my_quota')).toMatchObject({
        used: 0,
        remaining: 100,
        total: 100,
      });
    });

    it('my_recent_turns lists the newest first, neutralized', async () => {
      const result = (await setup().call('my_recent_turns')) as {
        turns: { asked: string; answered: string }[];
      };
      expect(result.turns.map((t) => t.asked)).toEqual(['câu mới', 'câu cũ ‹@123›']);
      expect(JSON.stringify(result)).not.toContain('<@123>');
    });

    it('my_recent_turns shows at most five turns', async () => {
      const s = setup();
      s.recentFor.mockResolvedValue(
        Array.from({ length: 8 }, (_, i) => ({
          triggerMessageId: String(i),
          replyMessageId: null,
          question: `q${i}`,
          answer: `a${i}`,
          createdAt: '2026-10-16T01:00:00.000Z',
        })),
      );
      const result = (await s.call('my_recent_turns')) as { turns: { asked: string }[] };
      expect(result.turns.map((t) => t.asked)).toEqual(['q7', 'q6', 'q5', 'q4', 'q3']);
    });
  });

  it('get_intro hands the lookup the member text and returns its answer', async () => {
    const s = setup();
    expect(await s.call('get_intro', { member: ` <@${OTHER}> ` })).toEqual({
      status: 'NOT_FOUND',
      member: `<@${OTHER}>`,
      scanned: 3,
    });
    expect(s.lookup).toHaveBeenCalledWith(GUILD, `<@${OTHER}>`, undefined);
  });

  it('get_intro passes the call abort signal to the lookup', async () => {
    const s = setup();
    const controller = new AbortController();
    await s.call('get_intro', { member: 'Lan' }, controller.signal);
    expect(s.lookup).toHaveBeenCalledWith(GUILD, 'Lan', controller.signal);
  });

  it('current_model names the model and where it comes from, nothing else', async () => {
    expect(await setup().call('current_model')).toEqual({ model: 'model-x', source: 'global' });
  });

  describe('failures', () => {
    it('answers a code, never the text of the error, and logs only a label', async () => {
      const s = setup();
      s.board.mockRejectedValue(new Error('connection to db-host.internal refused'));
      s.limitOf.mockRejectedValue(new Error('password authentication failed'));
      s.lookup.mockRejectedValue(new Error('boom'));
      s.list.mockImplementation(() => {
        throw new Error('registry exploded');
      });
      for (const [name, input] of [
        ['game_leaderboard', { game: 'WORDLE' }],
        ['my_quota', {}],
        ['get_intro', { member: 'x' }],
        ['list_commands', {}],
      ] as const) {
        const result = await s.call(name, input);
        expect(result).toEqual({ error: 'unavailable' });
      }
      expect(JSON.stringify(warn.mock.calls)).not.toContain('db-host');
      expect(JSON.stringify(warn.mock.calls)).not.toContain('password');
    });
  });
});
