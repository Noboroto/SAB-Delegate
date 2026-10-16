import 'reflect-metadata';
import { CHATBOT_LIMIT_MAX, ErrorCode, MESSAGES } from '@sab/shared';
import { ChannelType, MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { ChatbotConfigService } from './chatbot-config.service.js';
import type { ChatbotMemoryService } from './chatbot-memory.service.js';
import type { ChatbotQuotaService } from './chatbot-quota.service.js';
import { ChatbotCommands } from './chatbot.commands.js';

// The reply names when the allowance renews, which depends on the clock.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T08:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

const GUILD = '100000000000000001';
const ADMIN = '100000000000000002';
const MEMBER = '100000000000000003';
const CHANNEL = '100000000000000004';
const ACTOR = { source: 'DISCORD', userId: ADMIN };

const STANDING = { used: 1200, limit: 5000, bonus: 500, total: 5500, remaining: 4300 };

function build(locale: 'vi' | 'en' = 'en') {
  const config = {
    get: vi.fn().mockResolvedValue({
      enabled: true,
      defaultMonthlyLimit: 100000,
      channels: [CHANNEL],
      llm: {
        source: 'guild',
        baseUrl: 'https://llm.example.test/v1',
        model: 'model-x',
        keyLast4: 'wxyz',
        globalAvailable: true,
      },
    }),
    configure: vi.fn().mockResolvedValue({}),
    addChannel: vi.fn().mockResolvedValue(undefined),
    removeChannel: vi.fn().mockResolvedValue(undefined),
  };
  const quota = {
    setLimit: vi.fn().mockResolvedValue(STANDING),
    grant: vi.fn().mockResolvedValue(STANDING),
    reset: vi.fn().mockResolvedValue({ dryRun: false, used: 1200 }),
    limitOf: vi.fn().mockResolvedValue(STANDING),
    list: vi.fn().mockResolvedValue({ items: [], total: 0, period: '2026-10', defaultLimit: 1 }),
  };
  const memory = {
    clear: vi.fn().mockResolvedValue({ dryRun: false, userMemories: 2, channelMemories: 1 }),
  };
  const locales = { resolve: vi.fn().mockResolvedValue(locale) };
  const commands = new ChatbotCommands(
    config as unknown as ChatbotConfigService,
    quota as unknown as ChatbotQuotaService,
    memory as unknown as ChatbotMemoryService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale: 'en-US',
      user: { id: ADMIN },
      replied: false,
      deferred: false,
      deferReply: vi.fn().mockImplementation(() => {
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    // The commands must not look at who is allowed: reading it fails the test.
    return new Proxy(target, {
      get(object, key, receiver) {
        if (key === 'memberPermissions' || key === 'member') {
          throw new Error(`the command read ${String(key)}`);
        }
        return Reflect.get(object, key, receiver) as unknown;
      },
    });
  };
  return { commands, config, quota, memory, locales, interaction };
}

const sent = (target: { editReply: { mock: { calls: unknown[][] } } }) =>
  (target.editReply.mock.calls[0]?.[0] as { content: string; allowedMentions: unknown }).content;

describe('/chatbot', () => {
  it('answers privately, pinging nobody', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onEnable([target] as never);

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(target.editReply).toHaveBeenCalledWith({
      content: MESSAGES.en.chatbot.slash.enabled,
      allowedMentions: { parse: [] },
    });
  });

  it.each([
    ['enable', true],
    ['disable', false],
  ] as const)('%s switches the chatbot as the Discord caller', async (name, enabled) => {
    const { commands, config, interaction } = build();
    const args = [interaction()] as never;
    await (name === 'enable' ? commands.onEnable(args) : commands.onDisable(args));
    expect(config.configure).toHaveBeenCalledWith(GUILD, { enabled }, ACTOR);
  });

  it('status shows the state, channels, model and key tail, and points to the dashboard', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onStatus([target] as never);

    const text = sent(target);
    expect(text).toContain('**on**');
    expect(text).toContain(`<#${CHANNEL}>`);
    expect(text).toContain('100,000 tokens');
    expect(text).toContain('model-x');
    expect(text).toContain('wxyz');
    expect(text).toContain(MESSAGES.en.chatbot.slash.status.dashboardHint);
    expect(text).not.toContain('llm.example.test');
  });

  it('status says when calls are held back', async () => {
    const { commands, config, interaction } = build('vi');
    config.get.mockResolvedValue({
      enabled: false,
      defaultMonthlyLimit: 100000,
      channels: [],
      llm: {
        source: 'global',
        baseUrl: null,
        model: null,
        keyLast4: null,
        globalAvailable: true,
        pausedUntil: '2026-10-16T10:00:00.000Z',
      },
    });
    const target = interaction();
    await commands.onStatus([target] as never);

    const text = sent(target);
    expect(text).toContain('**tắt**');
    expect(text).toContain('100.000 token');
    expect(text).toContain(`<t:${Date.parse('2026-10-16T10:00:00.000Z') / 1000}:R>`);
  });

  it('channel-add and channel-remove pass the channel id', async () => {
    const { commands, config, interaction } = build();
    await commands.onChannelAdd([interaction()] as never, { channel: { id: CHANNEL } });
    await commands.onChannelRemove([interaction()] as never, { channel: { id: CHANNEL } });
    expect(config.addChannel).toHaveBeenCalledWith(GUILD, CHANNEL, ACTOR);
    expect(config.removeChannel).toHaveBeenCalledWith(GUILD, CHANNEL, ACTOR);
  });

  it('limit sets the server default', async () => {
    const { commands, config, interaction } = build();
    const target = interaction();
    await commands.onLimit([target] as never, { amount: 250000 });
    expect(config.configure).toHaveBeenCalledWith(GUILD, { defaultMonthlyLimit: 250000 }, ACTOR);
    expect(sent(target)).toContain('250,000');
  });

  it('quota-set gives the member their own limit and shows where they stand', async () => {
    const { commands, quota, interaction } = build();
    const target = interaction();
    await commands.onQuotaSet([target] as never, { user: { id: MEMBER }, limit: 5000 });
    expect(quota.setLimit).toHaveBeenCalledWith(GUILD, MEMBER, 5000, ACTOR);
    expect(sent(target)).toContain(`<@${MEMBER}>`);
    expect(sent(target)).toContain('remaining 4,300 / 5,500');
  });

  it('quota-set with clear drops the member limit', async () => {
    const { commands, quota, interaction } = build();
    const target = interaction();
    await commands.onQuotaSet([target] as never, { user: { id: MEMBER }, clear: true });
    expect(quota.setLimit).toHaveBeenCalledWith(GUILD, MEMBER, null, ACTOR);
    expect(sent(target)).toContain(
      MESSAGES.en.chatbot.slash.quotaCleared.replace('{user}', `<@${MEMBER}>`),
    );
  });

  it.each([
    ['neither a limit nor clear', {}],
    ['both a limit and clear', { limit: 10, clear: true }],
  ])('quota-set refuses %s before touching anything', async (_label, extra) => {
    const { commands, quota, interaction } = build();
    const target = interaction();
    await expect(
      commands.onQuotaSet([target] as never, { user: { id: MEMBER }, ...extra }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(quota.setLimit).not.toHaveBeenCalled();
    expect(target.deferReply).not.toHaveBeenCalled();
  });

  it('quota-grant adds or takes back, by the sign', async () => {
    const { commands, quota, interaction } = build();
    const add = interaction();
    await commands.onQuotaGrant([add] as never, { user: { id: MEMBER }, tokens: 1000 });
    const take = interaction();
    await commands.onQuotaGrant([take] as never, { user: { id: MEMBER }, tokens: -1000 });

    expect(quota.grant).toHaveBeenNthCalledWith(1, GUILD, MEMBER, 1000, ACTOR);
    expect(quota.grant).toHaveBeenNthCalledWith(2, GUILD, MEMBER, -1000, ACTOR);
    expect(sent(add)).toContain('Added 1,000');
    expect(sent(take)).toContain('Took back 1,000');
  });

  it('quota-reset applies at once, with no dry run', async () => {
    const { commands, quota, interaction } = build();
    const target = interaction();
    await commands.onQuotaReset([target] as never, { user: { id: MEMBER } });
    expect(quota.reset).toHaveBeenCalledWith(GUILD, MEMBER, ACTOR, { dryRun: false });
    expect(sent(target)).toContain('1,200');
  });

  it('usage of one member reads that member only', async () => {
    const { commands, quota, interaction } = build();
    const target = interaction();
    await commands.onUsage([target] as never, { user: { id: MEMBER } });
    expect(quota.limitOf).toHaveBeenCalledWith(GUILD, MEMBER);
    expect(quota.list).not.toHaveBeenCalled();
    expect(sent(target)).toBe(
      `<@${MEMBER}>: used 1,200, remaining 4,300 / 5,500 · resets <t:1793466000:R>`,
    );
  });

  it('usage without a member lists the ten biggest spenders of the month', async () => {
    const { commands, quota, interaction } = build();
    quota.list.mockResolvedValue({
      items: [
        { userId: MEMBER, used: 900, limit: 1000, bonus: 100, overridden: false, remaining: 200 },
        { userId: ADMIN, used: 5, limit: 1000, bonus: 0, overridden: true, remaining: 995 },
      ],
      total: 2,
      period: '2026-10',
      defaultLimit: 1000,
    });
    const target = interaction();
    await commands.onUsage([target] as never, {});

    expect(quota.list).toHaveBeenCalledWith(
      GUILD,
      expect.objectContaining({ sort: 'used', order: 'desc', page: 1, pageSize: 10 }),
    );
    const lines = sent(target).split('\n');
    expect(lines[0]).toBe(MESSAGES.en.chatbot.slash.usageTopTitle);
    expect(lines[1]).toBe(`1. <@${MEMBER}>: used 900, remaining 200 / 1,100`);
    expect(lines[2]).toBe(`2. <@${ADMIN}>: used 5, remaining 995 / 1,000`);
  });

  it('usage says so when nobody has used the chatbot', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onUsage([target] as never, {});
    expect(sent(target)).toBe(MESSAGES.en.chatbot.slash.usageTopEmpty);
  });

  it('memory-clear forwards the scope with the ids given, leaving the checks to the service', async () => {
    const { commands, memory, interaction } = build();
    const target = interaction();
    await commands.onMemoryClear([target] as never, {
      scope: 'user',
      user: { id: MEMBER },
    });
    expect(memory.clear).toHaveBeenCalledWith(
      GUILD,
      { scope: 'user', dryRun: false, userId: MEMBER },
      ACTOR,
    );
    expect(sent(target)).toContain('2 member memories and 1 channel memories');
  });

  it('memory-clear for a channel and for everything', async () => {
    const { commands, memory, interaction } = build();
    await commands.onMemoryClear([interaction()] as never, {
      scope: 'channel',
      channel: { id: CHANNEL },
    });
    await commands.onMemoryClear([interaction()] as never, { scope: 'all' });
    expect(memory.clear).toHaveBeenNthCalledWith(
      1,
      GUILD,
      { scope: 'channel', dryRun: false, channelId: CHANNEL },
      ACTOR,
    );
    expect(memory.clear).toHaveBeenNthCalledWith(2, GUILD, { scope: 'all', dryRun: false }, ACTOR);
  });

  it('answers in the language of the server', async () => {
    const { commands, locales, interaction } = build('vi');
    const target = interaction();
    await commands.onEnable([target] as never);
    expect(locales.resolve).toHaveBeenCalledWith(GUILD, target);
    expect(sent(target)).toBe(MESSAGES.vi.chatbot.slash.enabled);
  });

  it.each([
    ['status', (c: ChatbotCommands, t: never) => c.onStatus([t])],
    ['enable', (c: ChatbotCommands, t: never) => c.onEnable([t])],
    ['limit', (c: ChatbotCommands, t: never) => c.onLimit([t], { amount: 1 })],
  ])('%s in a direct message fails with GUILD_NOT_FOUND', async (_name, run) => {
    const { commands, config, interaction } = build();
    const target = interaction(null);
    await expect(run(commands, target as never)).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(config.get).not.toHaveBeenCalled();
    expect(config.configure).not.toHaveBeenCalled();
  });

  describe('registered options', () => {
    type Option = {
      name: string;
      min_value?: number;
      max_value?: number;
      channel_types?: number[];
      choices?: { value: string }[];
    };
    const optionsOf = (handler: string): Record<string, Option> =>
      Reflect.getMetadata(
        'necord:options_meta',
        (ChatbotCommands.prototype as unknown as Record<string, object>)[handler] as object,
      ) as Record<string, Option>;

    it('bound the token amounts by the shared ceiling', () => {
      expect(optionsOf('onLimit')['amount']).toMatchObject({
        min_value: 0,
        max_value: CHATBOT_LIMIT_MAX,
      });
      expect(optionsOf('onQuotaSet')['limit']).toMatchObject({
        min_value: 0,
        max_value: CHATBOT_LIMIT_MAX,
      });
      expect(optionsOf('onQuotaGrant')['tokens']).toMatchObject({
        min_value: -CHATBOT_LIMIT_MAX,
        max_value: CHATBOT_LIMIT_MAX,
      });
    });

    it('offer text channels and threads, never a forum or voice channel', () => {
      const allowed = [
        ChannelType.GuildText,
        ChannelType.GuildAnnouncement,
        ChannelType.AnnouncementThread,
        ChannelType.PublicThread,
        ChannelType.PrivateThread,
      ];
      for (const [handler, key] of [
        ['onChannelAdd', 'channel'],
        ['onChannelRemove', 'channel'],
        ['onMemoryClear', 'channel'],
      ] as const) {
        expect(optionsOf(handler)[key]?.channel_types, handler).toEqual(allowed);
      }
      expect(allowed).not.toContain(ChannelType.GuildForum);
    });

    it('offer exactly the three memory scopes', () => {
      expect(optionsOf('onMemoryClear')['scope']?.choices?.map((choice) => choice.value)).toEqual([
        'user',
        'channel',
        'all',
      ]);
    });
  });
});
