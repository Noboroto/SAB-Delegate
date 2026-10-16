import 'reflect-metadata';
import { AUDIT_ACTIONS, CHATBOT_MAX_CHANNELS, ErrorCode, type ActorContext } from '@sab/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { LlmChatError, type LlmChatService } from '../llm/llm-chat.service.js';
import type { LlmService } from '../llm/llm.service.js';
import { ChatbotConfigService } from './chatbot-config.service.js';
import { ChatbotPauseService, pauseKeyOf } from '../llm/chatbot-pause.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const OTHER_CHANNEL = '200000000000000002';
const ADMIN_GUILD = '700000000000000001';
const ACTOR: ActorContext = { source: 'HTTP', userId: '300000000000000001' };
const URL_A = 'https://api.example.test/v1';
const URL_B = 'https://other.example.test/v1';
/** Built at run time: a literal next to a key trips the secret scanners. */
const keyOf = (label: string) => `${label}-`.padEnd(24, 'x');

type Setup = {
  access?: 'ok' | 'not-found' | 'forbidden';
  /** The guild row `routeOf` and `get` read. */
  row?: {
    chatbot: Record<string, unknown> | null;
    chatbotChannels: Array<{ channelId: string }>;
  } | null;
  holder?: { guildId: string } | null;
  word?: boolean;
  game?: boolean;
  count?: number;
  createError?: Error;
  holderAfterError?: { guild: { discordId: string } } | null;
  removed?: number;
  config?: Record<string, unknown> | null;
  globalTarget?: { baseUrl: string; model: string; apiKey: string } | null;
  /** What `openKey` returns; sealed values are `sealed:<plain>`. */
  unreadable?: boolean;
  noSecret?: boolean;
  /** Rows the key-keeping write matches; 0 when a clear got in first. */
  keepMatches?: number;
};

const DEFAULTS = { enabled: false, defaultMonthlyLimit: 100_000 };

afterEach(() => {
  vi.restoreAllMocks();
});

function build(setup: Setup = {}) {
  const chatbotChannel = {
    findUnique: vi
      .fn()
      .mockResolvedValueOnce(setup.holder ?? null)
      .mockResolvedValue(setup.holderAfterError ?? null),
    count: vi.fn().mockResolvedValue(setup.count ?? 0),
    create: vi.fn(() =>
      setup.createError === undefined ? Promise.resolve({}) : Promise.reject(setup.createError),
    ),
    deleteMany: vi.fn().mockResolvedValue({ count: setup.removed ?? 1 }),
  };
  const chatbotConfig = {
    createMany: vi.fn().mockResolvedValue({ count: 0 }),
    findUniqueOrThrow: vi.fn().mockResolvedValue({ ...DEFAULTS, ...setup.config }),
    findFirst: vi.fn().mockResolvedValue(setup.config ?? null),
    update: vi
      .fn()
      .mockImplementation(({ data }: { data: Record<string, unknown> }) =>
        Promise.resolve({ ...DEFAULTS, ...data }),
      ),
    updateMany: vi
      .fn()
      .mockResolvedValue({ count: setup.keepMatches ?? (setup.config === null ? 0 : 1) }),
  };
  const chatbotChannelMemory = { deleteMany: vi.fn().mockResolvedValue({ count: 1 }) };
  const guild = {
    findUnique: vi.fn((args: { select: Record<string, unknown> }) =>
      Promise.resolve('chatbot' in args.select ? (setup.row ?? null) : { id: 'guild-key' }),
    ),
  };
  const tx = {
    chatbotChannel,
    chatbotConfig,
    chatbotChannelMemory,
    guild,
    guildConfig: {
      findFirst: vi.fn().mockResolvedValue(setup.word === true ? { id: 'config' } : null),
    },
    gameChannel: {
      findUnique: vi.fn().mockResolvedValue(setup.game === true ? { id: 'game' } : null),
    },
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  const prisma = {
    ...tx,
    $transaction: vi.fn((run: (client: typeof tx) => Promise<unknown>) => run(tx)),
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const guilds = {
    ensureGuild: vi.fn().mockResolvedValue({ id: 'guild-key' }),
    lockChannelClaim: vi.fn().mockResolvedValue(undefined),
  };
  const access = { check: vi.fn().mockResolvedValue(setup.access ?? 'ok') };
  const llm = {
    globalTarget: vi.fn().mockResolvedValue(setup.globalTarget ?? null),
    assertSecretAvailable: vi.fn(() => {
      if (setup.noSecret === true) throw new ServiceError(ErrorCode.LLM_NOT_AVAILABLE);
    }),
    sealKey: vi.fn((plain: string) => `sealed:${plain}`),
    adminGuildId: ADMIN_GUILD,
    openKey: vi.fn((stored: string) =>
      setup.unreadable === true ? null : stored.replace(/^sealed:/u, ''),
    ),
  };
  const chat = { ping: vi.fn().mockResolvedValue(undefined) };
  const pause = new ChatbotPauseService();
  const service = new ChatbotConfigService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    guilds as unknown as GuildConfigService,
    access as unknown as ChannelAccessService,
    llm as unknown as LlmService,
    chat as unknown as LlmChatService,
    pause,
  );
  return {
    service,
    pause,
    prisma,
    tx,
    chatbotChannel,
    chatbotConfig,
    chatbotChannelMemory,
    audit,
    guilds,
    access,
    llm,
    chat,
    guild,
  };
}

describe('ChatbotConfigService.routeOf', () => {
  const row = { chatbot: { enabled: true }, chatbotChannels: [{ channelId: CHANNEL }] };

  it('names the switch for a designated channel and null for any other', async () => {
    const { service } = build({ row });
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toEqual({ enabled: true });
    await expect(service.routeOf(GUILD, OTHER_CHANNEL)).resolves.toBeNull();
  });

  it('keeps a designated channel of a switched-off chatbot visible as disabled', async () => {
    const { service } = build({
      row: { chatbot: { enabled: false }, chatbotChannels: [{ channelId: CHANNEL }] },
    });
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toEqual({ enabled: false });
  });

  it('answers null for a server the bot never saw, and caches that too', async () => {
    const { service, guild } = build({ row: null });
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toBeNull();
    await service.routeOf(GUILD, CHANNEL);
    expect(guild.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads the database once for every message after the first', async () => {
    const { service, guild } = build({ row });
    for (let i = 0; i < 5; i += 1) await service.routeOf(GUILD, CHANNEL);
    expect(guild.findUnique).toHaveBeenCalledTimes(1);
  });

  it('reads again after forget', async () => {
    const { service, guild } = build({ row });
    await service.routeOf(GUILD, CHANNEL);
    service.forget(GUILD);
    await service.routeOf(GUILD, CHANNEL);
    expect(guild.findUnique).toHaveBeenCalledTimes(2);
  });

  it('reads again after the one-minute lifetime', async () => {
    let now = 1_000_000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { service, guild } = build({ row });
    await service.routeOf(GUILD, CHANNEL);
    // lru-cache reuses a reading of the clock for one millisecond.
    await new Promise((resolve) => setTimeout(resolve, 5));
    now += 59_000;
    await service.routeOf(GUILD, CHANNEL);
    expect(guild.findUnique).toHaveBeenCalledTimes(1);
    now += 2_000;
    await new Promise((resolve) => setTimeout(resolve, 5));
    await service.routeOf(GUILD, CHANNEL);
    expect(guild.findUnique).toHaveBeenCalledTimes(2);
  });

  it('does not keep an answer read while a write was committing', async () => {
    const { service, guild } = build({ row });
    let release: () => void = () => undefined;
    guild.findUnique.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(row);
        }),
    );
    const first = service.routeOf(GUILD, CHANNEL);
    service.forget(GUILD);
    release();
    await expect(first).resolves.toEqual({ enabled: true });
    guild.findUnique.mockResolvedValue({ chatbot: null, chatbotChannels: [] });
    await expect(service.routeOf(GUILD, CHANNEL)).resolves.toBeNull();
    expect(guild.findUnique).toHaveBeenCalledTimes(2);
  });

  it('keeps the servers apart and rejects an id that is not a snowflake', async () => {
    const { service, guild } = build({ row });
    await service.routeOf(GUILD, CHANNEL);
    await service.routeOf('100000000000000002', CHANNEL);
    expect(guild.findUnique).toHaveBeenCalledTimes(2);
    await expect(service.routeOf('guild', CHANNEL)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});

describe('ChatbotConfigService.get', () => {
  it('shows defaults for a server that never configured it, and writes nothing', async () => {
    const { service, prisma, tx } = build({ row: null });
    await expect(service.get(GUILD)).resolves.toEqual({
      enabled: false,
      defaultMonthlyLimit: 100_000,
      channels: [],
      llm: { source: 'none', baseUrl: null, model: null, keyLast4: null, globalAvailable: false },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.chatbotConfig.createMany).not.toHaveBeenCalled();
  });

  it('reports the shared model when the server has no override of its own', async () => {
    const { service } = build({
      row: { chatbot: { ...DEFAULTS, enabled: true }, chatbotChannels: [{ channelId: CHANNEL }] },
      globalTarget: { baseUrl: URL_A, model: 'm', apiKey: keyOf('global') },
    });
    const view = await service.get(GUILD);
    expect(view).toMatchObject({ enabled: true, channels: [CHANNEL] });
    expect(view.llm).toEqual({
      source: 'global',
      baseUrl: null,
      model: null,
      keyLast4: null,
      globalAvailable: true,
    });
  });

  it('shows the override without any key material but the last four characters', async () => {
    const { service } = build({
      row: {
        chatbot: {
          ...DEFAULTS,
          llmBaseUrl: URL_A,
          llmModel: 'gpt',
          llmApiKeyEnc: 'sealed:secret-value',
          llmKeyLast4: 'alue',
        },
        chatbotChannels: [],
      },
    });
    const view = await service.get(GUILD);
    expect(view.llm).toEqual({
      source: 'guild',
      baseUrl: URL_A,
      model: 'gpt',
      keyLast4: 'alue',
      globalAvailable: false,
    });
    expect(JSON.stringify(view)).not.toContain('secret-value');
  });

  it('asks for the key again when the stored one cannot be read', async () => {
    const { service } = build({
      unreadable: true,
      row: {
        chatbot: {
          ...DEFAULTS,
          llmBaseUrl: URL_A,
          llmModel: 'gpt',
          llmApiKeyEnc: 'sealed:x',
          llmKeyLast4: 'abcd',
        },
        chatbotChannels: [],
      },
    });
    expect((await service.get(GUILD)).llm).toMatchObject({ source: 'guild', keyLast4: null });
  });
});

describe('ChatbotConfigService.configure', () => {
  it('writes the changed fields only and audits before and after', async () => {
    const { service, chatbotConfig, audit, guilds } = build({ config: { enabled: false } });
    await service.configure(GUILD, { enabled: true }, ACTOR);
    expect(guilds.ensureGuild).toHaveBeenCalledWith(GUILD, undefined, expect.anything());
    expect(chatbotConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { enabled: true } }),
    );
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.chatbotConfigure,
        params: { before: { enabled: false }, after: { enabled: true } },
      },
      expect.anything(),
    );
  });

  it('audits the default limit under the allow-listed name', async () => {
    const { service, audit } = build();
    await service.configure(GUILD, { defaultMonthlyLimit: 5_000 }, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { before: { defaultLimit: 100_000 }, after: { defaultLimit: 5_000 } },
      }),
      expect.anything(),
    );
  });

  it.each([
    {},
    { enabled: undefined },
    { unknown: true },
    { defaultMonthlyLimit: -1 },
    { enabled: 'yes' },
  ])('refuses %j without opening a transaction or auditing', async (patch) => {
    const { service, prisma, audit } = build();
    await expect(service.configure(GUILD, patch, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('clears the route cache after the write', async () => {
    const { service, guild } = build({ row: { chatbot: { enabled: true }, chatbotChannels: [] } });
    await service.routeOf(GUILD, CHANNEL);
    await service.configure(GUILD, { enabled: true }, ACTOR);
    await service.routeOf(GUILD, CHANNEL);
    expect(
      guild.findUnique.mock.calls.filter(([a]) => 'chatbotChannels' in a.select).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe('ChatbotConfigService.addChannel', () => {
  it('asks Discord for send and read, scoped to the server, before the transaction', async () => {
    const { service, access, prisma } = build();
    access.check.mockImplementation(() => {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      return Promise.resolve('ok');
    });
    await service.addChannel(GUILD, CHANNEL, ACTOR);
    expect(access.check.mock.calls).toEqual([
      [CHANNEL, 'send', GUILD],
      [CHANNEL, 'read', GUILD],
    ]);
  });

  it('refuses a channel Discord does not know, or one the bot cannot use, writing nothing', async () => {
    const missing = build({ access: 'not-found' });
    await expect(missing.service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
    const denied = build({ access: 'forbidden' });
    await expect(denied.service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
      params: { permission: 'send' },
    });
    for (const { prisma, audit } of [missing, denied]) {
      expect(prisma.$transaction).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    }
  });

  it('names the read permission when only reading fails', async () => {
    const { service, access } = build();
    access.check.mockResolvedValueOnce('ok').mockResolvedValueOnce('forbidden');
    await expect(service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
      params: { permission: 'read' },
    });
  });

  it('rejects ids that are not snowflakes before any Discord call', async () => {
    const { service, access } = build();
    await expect(service.addChannel(GUILD, 'x', ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(service.addChannel('x', CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(access.check).not.toHaveBeenCalled();
  });

  it('designates the channel under the claim lock and audits it', async () => {
    const { service, chatbotChannel, audit, guilds, tx } = build();
    await service.addChannel(GUILD, CHANNEL, ACTOR);
    expect(chatbotChannel.create).toHaveBeenCalledWith({
      data: { guildId: 'guild-key', channelId: CHANNEL },
    });
    expect(guilds.lockChannelClaim).toHaveBeenCalledWith(CHANNEL, tx);
    expect(guilds.lockChannelClaim.mock.invocationCallOrder[0]).toBeLessThan(
      chatbotChannel.findUnique.mock.invocationCallOrder[0] ?? 0,
    );
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.chatbotChannelAdd,
        params: { channelId: CHANNEL },
      },
      expect.anything(),
    );
  });

  it('does nothing, and audits nothing, for a channel the server already has', async () => {
    const { service, chatbotChannel, audit } = build({ holder: { guildId: 'guild-key' } });
    await service.addChannel(GUILD, CHANNEL, ACTOR);
    expect(chatbotChannel.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    ['another server holds it', { holder: { guildId: 'other-key' } }],
    ['it is the word chain channel', { word: true }],
    ['it hosts a channel game', { game: true }],
  ] as const)('is CHANNEL_IN_USE when %s', async (_name, setup) => {
    const { service, chatbotChannel, audit } = build(setup);
    await expect(service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.CHANNEL_IN_USE,
    });
    expect(chatbotChannel.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses the channel past the cap and takes the one at the cap minus one', async () => {
    const full = build({ count: CHATBOT_MAX_CHANNELS });
    await expect(full.service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.CHATBOT_CHANNEL_LIMIT_REACHED,
    });
    expect(full.chatbotChannel.create).not.toHaveBeenCalled();
    const last = build({ count: CHATBOT_MAX_CHANNELS - 1 });
    await last.service.addChannel(GUILD, CHANNEL, ACTOR);
    expect(last.chatbotChannel.create).toHaveBeenCalledTimes(1);
  });

  it('is CHANNEL_IN_USE when a concurrent add of another server wins the channel', async () => {
    const { service } = build({
      createError: Object.assign(new Error('unique'), { code: 'P2002' }),
      holderAfterError: { guild: { discordId: '100000000000000002' } },
    });
    await expect(service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.CHANNEL_IN_USE,
    });
  });

  it('rethrows the unique violation when no holder is found afterwards', async () => {
    const unique = Object.assign(new Error('unique'), { code: 'P2002' });
    const { service } = build({ createError: unique, holderAfterError: null });
    await expect(service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toBe(unique);
  });

  it('treats a concurrent add of the same server as done', async () => {
    const { service } = build({
      createError: Object.assign(new Error('unique'), { code: 'P2002' }),
      holderAfterError: { guild: { discordId: GUILD } },
    });
    await expect(service.addChannel(GUILD, CHANNEL, ACTOR)).resolves.toBeUndefined();
  });

  it('rethrows any other failure and still clears the route cache', async () => {
    const down = new Error('db down');
    const { service, guild } = build({
      createError: down,
      row: { chatbot: null, chatbotChannels: [] },
    });
    await service.routeOf(GUILD, CHANNEL);
    await expect(service.addChannel(GUILD, CHANNEL, ACTOR)).rejects.toBe(down);
    await service.routeOf(GUILD, CHANNEL);
    expect(guild.findUnique.mock.calls.filter(([a]) => 'chatbotChannels' in a.select)).toHaveLength(
      2,
    );
  });
});

describe('ChatbotConfigService dryRun', () => {
  const row = (channels: string[]) => ({
    chatbot: { enabled: false, defaultMonthlyLimit: 100_000 },
    chatbotChannels: channels.map((channelId) => ({ channelId })),
  });
  const untouched = ({ prisma, audit, guilds }: ReturnType<typeof build>) => {
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
    expect(guilds.lockChannelClaim).not.toHaveBeenCalled();
  };

  it('configure answers the config with the change applied and writes nothing', async () => {
    const built = build({ row: row([CHANNEL]) });
    const preview = await built.service.configure(GUILD, { enabled: true }, ACTOR, {
      dryRun: true,
    });
    expect(preview).toMatchObject({ enabled: true, defaultMonthlyLimit: 100_000 });
    untouched(built);
    await expect(built.service.configure(GUILD, {}, ACTOR, { dryRun: true })).rejects.toMatchObject(
      { code: ErrorCode.VALIDATION_FAILED },
    );
  });

  it('addChannel checks access and ownership like a real call, then adds in memory only', async () => {
    const built = build({ row: row([]) });
    const preview = await built.service.addChannel(GUILD, CHANNEL, ACTOR, { dryRun: true });
    expect(preview?.channels).toEqual([CHANNEL]);
    untouched(built);

    const denied = build({ access: 'forbidden' });
    await expect(
      denied.service.addChannel(GUILD, CHANNEL, ACTOR, { dryRun: true }),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_MISSING_PERMISSIONS });
    for (const setup of [{ holder: { guildId: 'other' } }, { word: true }, { game: true }]) {
      const taken = build({ row: row([]), ...setup });
      await expect(
        taken.service.addChannel(GUILD, CHANNEL, ACTOR, { dryRun: true }),
      ).rejects.toMatchObject({ code: ErrorCode.CHANNEL_IN_USE });
    }
    const full = build({
      row: row(
        Array.from({ length: CHATBOT_MAX_CHANNELS }, (_, n) => String(300_000_000_000_000_000 + n)),
      ),
    });
    await expect(
      full.service.addChannel(GUILD, CHANNEL, ACTOR, { dryRun: true }),
    ).rejects.toMatchObject({ code: ErrorCode.CHATBOT_CHANNEL_LIMIT_REACHED });
  });

  it('addChannel on a channel the server already has answers the config unchanged', async () => {
    const built = build({ row: row([CHANNEL]), holder: { guildId: 'guild-key' } });
    const preview = await built.service.addChannel(GUILD, CHANNEL, ACTOR, { dryRun: true });
    expect(preview?.channels).toEqual([CHANNEL]);
  });

  it('removeChannel answers the config without the channel and writes nothing', async () => {
    const built = build({ row: row([CHANNEL, '777777777777777777']) });
    const preview = await built.service.removeChannel(GUILD, CHANNEL, ACTOR, { dryRun: true });
    expect(preview?.channels).toEqual(['777777777777777777']);
    expect(built.chatbotChannel.deleteMany).not.toHaveBeenCalled();
    untouched(built);
  });
});

describe('ChatbotConfigService.removeChannel', () => {
  it('deletes the channel and its memory together, then audits', async () => {
    const { service, chatbotChannel, chatbotChannelMemory, audit, prisma } = build();
    await service.removeChannel(GUILD, CHANNEL, ACTOR);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(chatbotChannel.deleteMany).toHaveBeenCalledWith({
      where: { guildId: 'guild-key', channelId: CHANNEL },
    });
    expect(chatbotChannelMemory.deleteMany).toHaveBeenCalledWith({
      where: { guildId: 'guild-key', channelId: CHANNEL },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.chatbotChannelRemove,
        params: { channelId: CHANNEL },
      }),
      expect.anything(),
    );
  });

  it('does not touch the memory or audit when the channel was not designated', async () => {
    const { service, chatbotChannelMemory, audit } = build({ removed: 0 });
    await service.removeChannel(GUILD, CHANNEL, ACTOR);
    expect(chatbotChannelMemory.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ChatbotConfigService.saveOverride', () => {
  const stored = {
    llmBaseUrl: URL_A,
    llmModel: 'old',
    llmApiKeyEnc: 'sealed:stored-key-value',
    llmKeyLast4: 'alue',
  };

  it('seals a new key, keeps only its last four, and audits without key material', async () => {
    const { service, chatbotConfig, audit, llm } = build();
    const apiKey = keyOf('fresh');
    await service.saveOverride(GUILD, { baseUrl: URL_A, model: 'gpt', apiKey }, ACTOR);
    expect(llm.sealKey).toHaveBeenCalledWith(apiKey);
    expect(chatbotConfig.update).toHaveBeenCalledWith({
      where: { guildId: 'guild-key' },
      data: {
        llmBaseUrl: URL_A,
        llmModel: 'gpt',
        llmApiKeyEnc: `sealed:${apiKey}`,
        llmKeyLast4: apiKey.slice(-4),
      },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    const recorded = JSON.stringify(audit.record.mock.calls);
    expect(recorded).not.toContain(apiKey);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.chatbotLlmSet,
        params: { host: 'api.example.test', model: 'gpt', keyChanged: true },
      }),
      expect.anything(),
    );
  });

  it('keeps the stored key when the address stays and the key still decrypts', async () => {
    const { service, chatbotConfig, audit, llm } = build({ config: stored });
    await service.saveOverride(GUILD, { baseUrl: URL_A, model: 'gpt' }, ACTOR);
    expect(llm.sealKey).not.toHaveBeenCalled();
    // Written only while the row still holds the key that was read.
    expect(chatbotConfig.updateMany).toHaveBeenCalledWith({
      where: { guildId: 'guild-key', llmBaseUrl: URL_A, llmApiKeyEnc: stored.llmApiKeyEnc },
      data: { llmModel: 'gpt' },
    });
    expect(chatbotConfig.update).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { host: 'api.example.test', model: 'gpt', keyChanged: false },
      }),
      expect.anything(),
    );
  });

  it('does not write the old key back when a clear committed after the read', async () => {
    const { service, audit } = build({ config: stored, keepMatches: 0 });
    await expect(
      service.saveOverride(GUILD, { baseUrl: URL_A, model: 'gpt' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_KEY_REQUIRED });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('is LLM_NOT_AVAILABLE, before anything else, when the server has no secret', async () => {
    const { service, prisma } = build({ noSecret: true });
    await expect(
      service.saveOverride(GUILD, { baseUrl: URL_A, model: 'gpt' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_NOT_AVAILABLE });
    await expect(
      service.testOverride(GUILD, { baseUrl: URL_A, model: 'gpt' }),
    ).rejects.toMatchObject({ code: ErrorCode.LLM_NOT_AVAILABLE });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['the address changes', { config: stored }, URL_B],
    ['nothing is stored', { config: {} }, URL_A],
    ['the stored key cannot be read', { config: stored, unreadable: true }, URL_A],
  ] as const)('requires a key when %s', async (_name, setup, baseUrl) => {
    const { service, chatbotConfig, audit } = build(setup);
    await expect(
      service.saveOverride(GUILD, { baseUrl, model: 'gpt' }, ACTOR),
    ).rejects.toMatchObject({
      code: ErrorCode.LLM_KEY_REQUIRED,
    });
    expect(chatbotConfig.update).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it.each([
    { baseUrl: 'http://api.example.test/v1', model: 'gpt', apiKey: keyOf('k') },
    { baseUrl: URL_A, model: '', apiKey: keyOf('k') },
    { baseUrl: URL_A, model: 'gpt', apiKey: 'short' },
    { baseUrl: URL_A },
  ])('refuses %j', async (input) => {
    const { service, prisma } = build();
    await expect(service.saveOverride(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe('ChatbotConfigService.clearOverride', () => {
  it('drops all four columns together and audits once', async () => {
    const { service, chatbotConfig, audit } = build();
    await service.clearOverride(GUILD, ACTOR);
    expect(chatbotConfig.updateMany).toHaveBeenCalledWith({
      where: { guild: { discordId: GUILD }, llmBaseUrl: { not: null } },
      data: { llmBaseUrl: null, llmModel: null, llmApiKeyEnc: null, llmKeyLast4: null },
    });
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.chatbotLlmClear }),
      expect.anything(),
    );
  });

  it('writes no audit row when there was no override', async () => {
    const { service, audit } = build({ config: null });
    await service.clearOverride(GUILD, ACTOR);
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('ChatbotConfigService.testOverride', () => {
  const stored = { llmBaseUrl: URL_A, llmApiKeyEnc: 'sealed:stored-key-value' };

  it('pings with the given key, saved or not', async () => {
    const { service, chat } = build();
    const apiKey = keyOf('given');
    await expect(
      service.testOverride(GUILD, { baseUrl: URL_A, model: 'gpt', apiKey }),
    ).resolves.toEqual({
      ok: true,
    });
    expect(chat.ping).toHaveBeenCalledWith({ baseUrl: URL_A, model: 'gpt', apiKey });
  });

  it('uses the stored key only for the address it was saved with', async () => {
    const same = build({ config: stored });
    await same.service.testOverride(GUILD, { baseUrl: URL_A, model: 'gpt' });
    expect(same.chat.ping).toHaveBeenCalledWith({
      baseUrl: URL_A,
      model: 'gpt',
      apiKey: 'stored-key-value',
    });
    const moved = build({ config: stored });
    await expect(
      moved.service.testOverride(GUILD, { baseUrl: URL_B, model: 'gpt' }),
    ).rejects.toMatchObject({
      code: ErrorCode.LLM_KEY_REQUIRED,
    });
    expect(moved.chat.ping).not.toHaveBeenCalled();
    const unreadable = build({ config: stored, unreadable: true });
    await expect(
      unreadable.service.testOverride(GUILD, { baseUrl: URL_A, model: 'gpt' }),
    ).rejects.toMatchObject({
      code: ErrorCode.LLM_KEY_REQUIRED,
    });
  });

  it('turns a failed call into a reason and rethrows anything else', async () => {
    const { service, chat } = build();
    const input = { baseUrl: URL_A, model: 'gpt', apiKey: keyOf('given') };
    chat.ping.mockRejectedValueOnce(new LlmChatError('unauthorized'));
    await expect(service.testOverride(GUILD, input)).resolves.toEqual({
      ok: false,
      reason: 'unauthorized',
    });
    const bug = new Error('bug');
    chat.ping.mockRejectedValueOnce(bug);
    await expect(service.testOverride(GUILD, input)).rejects.toBe(bug);
  });
});

describe('ChatbotConfigService: provider out of credit', () => {
  const ownKey = keyOf('own');
  const own = {
    llmBaseUrl: URL_A,
    llmModel: 'gpt',
    llmApiKeyEnc: `sealed:${ownKey}`,
    llmKeyLast4: ownKey.slice(-4),
  };
  const ownRow = { chatbot: { ...DEFAULTS, ...own }, chatbotChannels: [] };
  const ownPauseKey = pauseKeyOf(GUILD, URL_A, 'gpt', ownKey.slice(-4));
  const sharedKey = keyOf('shared');
  const shared = { baseUrl: URL_B, model: 'm', apiKey: sharedKey };
  const sharedPauseKey = pauseKeyOf(null, URL_B, 'm', sharedKey.slice(-4));

  it('shows when the own model resumes, and nothing once the window has passed', async () => {
    const { service, pause } = build({ row: ownRow });
    expect((await service.get(GUILD)).llm.pausedUntil).toBeUndefined();
    const { until } = pause.trip(ownPauseKey, GUILD, 0);
    expect((await service.get(GUILD)).llm.pausedUntil).toBe(until.toISOString());
  });

  it('keys the own pause by the opened key even when the stored last four are missing', async () => {
    const { service, pause } = build({
      row: { chatbot: { ...DEFAULTS, ...own, llmKeyLast4: null }, chatbotChannels: [] },
    });
    const { until } = pause.trip(ownPauseKey, GUILD, 0);
    expect((await service.get(GUILD)).llm.pausedUntil).toBe(until.toISOString());
  });

  it('shows the shared pause only for servers that use the shared model', async () => {
    const sharedRow = { chatbot: DEFAULTS, chatbotChannels: [] };
    const { service, pause } = build({ row: sharedRow, globalTarget: shared });
    const { until } = pause.trip(sharedPauseKey, null, 0);
    expect((await service.get(GUILD)).llm.pausedUntil).toBe(until.toISOString());

    const withOwn = build({ row: ownRow, globalTarget: shared });
    withOwn.pause.trip(sharedPauseKey, null, 0);
    expect((await withOwn.service.get(GUILD)).llm.pausedUntil).toBeUndefined();
  });

  it('shows the own pause as nothing when the pause belongs to another server', async () => {
    const { service, pause } = build({ row: ownRow });
    pause.trip(pauseKeyOf('100000000000000009', URL_A, 'gpt', ownKey.slice(-4)), GUILD, 0);
    expect((await service.get(GUILD)).llm.pausedUntil).toBeUndefined();
  });

  it('forgets the pause when the override is saved or cleared', async () => {
    const saved = build({ row: ownRow });
    saved.pause.trip(ownPauseKey, GUILD, 0);
    await saved.service.saveOverride(
      GUILD,
      { baseUrl: URL_A, model: 'gpt', apiKey: ownKey },
      ACTOR,
    );
    expect(saved.pause.pausedUntil(ownPauseKey)).toBeNull();

    const cleared = build({ row: ownRow });
    cleared.pause.trip(ownPauseKey, GUILD, 0);
    await cleared.service.clearOverride(GUILD, ACTOR);
    expect(cleared.pause.pausedUntil(ownPauseKey)).toBeNull();
  });

  it('ends the pause when a test of that very model works, and not when it fails', async () => {
    const { service, pause, chat } = build();
    const input = { baseUrl: URL_A, model: 'gpt', apiKey: ownKey };
    pause.trip(ownPauseKey, GUILD, 0);
    chat.ping.mockRejectedValueOnce(new LlmChatError('provider_quota'));
    await expect(service.testOverride(GUILD, input)).resolves.toEqual({
      ok: false,
      reason: 'provider_quota',
    });
    expect(pause.pausedUntil(ownPauseKey)).not.toBeNull();
    await service.testOverride(GUILD, { ...input, model: 'other' });
    expect(pause.pausedUntil(ownPauseKey)).not.toBeNull();
    await service.testOverride(GUILD, input);
    expect(pause.pausedUntil(ownPauseKey)).toBeNull();
  });

  it('names the admin server whose #bot-log hears about it', () => {
    expect(build().service.alertGuildId).toBe(ADMIN_GUILD);
  });
});

describe('ChatbotConfigService.resolveTarget', () => {
  const global = { baseUrl: URL_B, model: 'shared', apiKey: keyOf('global') };
  const own = {
    llmBaseUrl: URL_A,
    llmModel: 'own',
    llmApiKeyEnc: 'sealed:own-key-value',
    llmKeyLast4: 'alue',
  };

  it('prefers the override of the server', async () => {
    const { service, llm } = build({ config: own, globalTarget: global });
    await expect(service.resolveTarget(GUILD)).resolves.toEqual({
      source: 'guild',
      target: { baseUrl: URL_A, model: 'own', apiKey: 'own-key-value' },
    });
    expect(llm.globalTarget).not.toHaveBeenCalled();
  });

  it('falls back to the shared model without an override', async () => {
    const { service } = build({ config: null, globalTarget: global });
    await expect(service.resolveTarget(GUILD)).resolves.toEqual({
      source: 'global',
      target: global,
    });
  });

  it('is null when neither exists', async () => {
    const { service } = build({ config: null });
    await expect(service.resolveTarget(GUILD)).resolves.toBeNull();
  });

  it('is null, not the shared model, when the own key cannot be read, and logs no key', async () => {
    const { service, llm } = build({ config: own, globalTarget: global, unreadable: true });
    const warn = vi.spyOn(service['logger'], 'warn').mockImplementation(() => undefined);
    await expect(service.resolveTarget(GUILD)).resolves.toBeNull();
    expect(llm.globalTarget).not.toHaveBeenCalled();
    await service.resolveTarget(GUILD);
    await service.resolveTarget(GUILD);
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = String(warn.mock.calls[0]?.[0]);
    expect(logged).toContain(GUILD);
    expect(logged).not.toContain('own-key-value');
  });
});
