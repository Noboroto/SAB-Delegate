import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, MESSAGE_MAX_LENGTH, type ActorContext } from '@sab/shared';
import { ChannelType, Collection, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import type {
  MessageResolution,
  MessageResolver,
} from '../../discord/services/message-resolver.service.js';
import { MentionService } from './mention.service.js';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000009';
const CHANNEL = '100000000000000011';
const MESSAGE = '100000000000000021';
const REPLY_CHANNEL = '100000000000000012';
const REPLY_MESSAGE = '100000000000000022';
const ASKER = '100000000000000031';
const ROLE = '100000000000000041';
const ACTOR: ActorContext = { source: 'DISCORD', userId: ASKER };
const url = (channel: string, message: string) =>
  `https://discord.com/channels/${GUILD}/${channel}/${message}`;

const user = (n: number) => String(200000000000000000n + BigInt(n));

type FakeMember = {
  id: string;
  user: { bot: boolean };
  roles: { cache: Set<string> };
};
const member = (id: string, opts: { bot?: boolean; roles?: string[] } = {}): FakeMember => ({
  id,
  user: { bot: opts.bot ?? false },
  roles: { cache: new Set(opts.roles ?? []) },
});
const collect = (members: FakeMember[]) =>
  new Collection(members.map((entry) => [entry.id, entry] as const));

function discordFailure(message: string, code = 50013): Error {
  return Object.assign(new Error(message), { code });
}

type MessageSetup = { guildId?: string | null; channel?: unknown; members?: FakeMember[] };

function fakeMessage(id: string, channelId: string, setup: MessageSetup = {}) {
  return {
    id,
    channelId,
    guildId: setup.guildId === undefined ? GUILD : setup.guildId,
    url: url(channelId, id),
    reply: vi.fn().mockResolvedValue(undefined),
    channel:
      setup.channel ??
      ({
        type: ChannelType.GuildText,
        isThread: () => false,
        isSendable: () => true,
        send: vi.fn().mockResolvedValue(undefined),
        members: collect(setup.members ?? []),
      } as const),
    guild: { members: { fetch: vi.fn().mockResolvedValue(collect(setup.members ?? [])) } },
  };
}

function build(
  over: {
    reactors?: string[];
    source?: ReturnType<typeof fakeMessage>;
    reply?: ReturnType<typeof fakeMessage>;
    thread?: unknown;
    auditFails?: boolean;
  } = {},
) {
  const source = over.source ?? fakeMessage(MESSAGE, CHANNEL);
  const reply = over.reply ?? fakeMessage(REPLY_MESSAGE, REPLY_CHANNEL);
  const resolver = {
    fetch: vi.fn((link: string): Promise<MessageResolution> => {
      if (link.includes(MESSAGE))
        return Promise.resolve({ status: 'OK', message: source as never });
      if (link.includes(REPLY_MESSAGE)) {
        return Promise.resolve({ status: 'OK', message: reply as never });
      }
      return Promise.resolve({ status: 'NOT_FOUND' });
    }),
  };
  const reactions = {
    fetchReactorIds: vi.fn().mockResolvedValue(over.reactors ?? []),
  };
  const audit = {
    record:
      over.auditFails === true
        ? vi.fn().mockRejectedValue(new Error('db down'))
        : vi.fn().mockResolvedValue(undefined),
  };
  const client = { channels: { fetch: vi.fn().mockResolvedValue(over.thread ?? null) } };
  const service = new MentionService(
    client as unknown as Client,
    resolver as unknown as MessageResolver,
    reactions as unknown as DiscordReactionService,
    audit as unknown as AuditService,
  );
  return { service, source, reply, resolver, reactions, audit, client };
}

const reactorsInput = {
  channelId: CHANNEL,
  messageId: MESSAGE,
  emoji: '👍',
  locale: 'en' as const,
};

describe('mentionReactors', () => {
  it('lists the reactors, marks the asker, and hands the text back without posting', async () => {
    const { service, audit, reply } = build({ reactors: [user(1), ASKER] });
    const result = await service.mentionReactors(GUILD, reactorsInput, ACTOR);

    expect(result).toMatchObject({
      dryRun: false,
      status: 'OK',
      count: 2,
      sample: [user(1), ASKER],
      delivered: false,
    });
    expect(result.chunks).toHaveLength(1);
    expect(result.chunks[0]).toContain(`<@${user(1)}>,`);
    expect(result.chunks[0]).toContain(`<@${ASKER}> (author),`);
    expect(result.chunks[0]).toContain(url(CHANNEL, MESSAGE));
    expect(reply.reply).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.mentionReactors,
      params: { channelId: CHANNEL, messageId: MESSAGE, emoji: '👍', count: 2 },
    });
  });

  it('asks only for the emoji given', async () => {
    const { service, reactions, source } = build({ reactors: [user(1)] });
    await service.mentionReactors(GUILD, reactorsInput, ACTOR);
    expect(reactions.fetchReactorIds).toHaveBeenCalledWith(source, '👍');
  });

  it('says so, and audits nothing, when nobody reacted', async () => {
    const { service, audit } = build({ reactors: [] });
    const result = await service.mentionReactors(GUILD, reactorsInput, ACTOR);
    expect(result).toMatchObject({ status: 'NO_REACTORS', count: 0, chunks: [] });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never exceeds 2000 characters per message however many reacted', async () => {
    const reactors = Array.from({ length: 700 }, (_, n) => user(n));
    const { service } = build({ reactors });
    const result = await service.mentionReactors(
      GUILD,
      { ...reactorsInput, content: 'z'.repeat(1990) },
      ACTOR,
    );
    expect(result.chunks.length).toBeGreaterThan(1);
    for (const chunk of result.chunks) expect(chunk.length).toBeLessThanOrEqual(MESSAGE_MAX_LENGTH);
    expect(result.count).toBe(700);
    expect(result.sample).toHaveLength(10);
  });

  it('posts a reply to the target, pinging what the list names as the old bot did, and says it did', async () => {
    const { service, reply, audit } = build({ reactors: [user(1)] });
    const result = await service.mentionReactors(
      GUILD,
      { ...reactorsInput, replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } },
      ACTOR,
    );

    expect(result.delivered).toBe(true);
    expect(reply.reply).toHaveBeenCalledWith({
      content: result.chunks[0],
      allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: true },
    });
    expect(result.postedChunks).toBe(1);
    expect(audit.record).toHaveBeenCalledTimes(1);
  });

  it('lets a typed @everyone ping when a person at a slash command asks for the reply', async () => {
    const { service, reply } = build({ reactors: [user(1)] });
    await service.mentionReactors(
      GUILD,
      {
        ...reactorsInput,
        content: '@everyone @here come',
        replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE },
      },
      ACTOR,
    );

    const sent = reply.reply.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: { parse: string[] };
    };
    expect(sent.content).toContain('@everyone @here come');
    expect(sent.allowedMentions.parse).toContain('everyone');
  });

  it('pings nobody, not even the author of the target, for a caller that is not a slash command', async () => {
    const { service, reply } = build({ reactors: [user(1)] });
    await service.mentionReactors(
      GUILD,
      {
        ...reactorsInput,
        content: '@everyone',
        replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE },
      },
      { source: 'HTTP', userId: ASKER },
    );

    expect(reply.reply).toHaveBeenCalledWith(
      expect.objectContaining({ allowedMentions: { parse: [], repliedUser: false } }),
    );
  });

  it('says how far a long post got when Discord refuses a later piece', async () => {
    const reactors = Array.from({ length: 300 }, (_, n) => user(n));
    const reply = fakeMessage(REPLY_MESSAGE, REPLY_CHANNEL);
    const channel = reply.channel as { send: ReturnType<typeof vi.fn> };
    channel.send
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(discordFailure('Missing Permissions'));
    const { service, audit } = build({ reactors, reply });

    const result = await service.mentionReactors(
      GUILD,
      { ...reactorsInput, replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } },
      ACTOR,
    );

    expect(result.chunks.length).toBeGreaterThan(3);
    expect(result).toMatchObject({
      status: 'SEND_FAILED',
      delivered: false,
      postedChunks: 2,
      failure: 'Missing Permissions',
    });
    const recorded = audit.record.mock.calls.at(-1)?.[0] as {
      ok: boolean;
      params: Record<string, unknown>;
    };
    expect(recorded.ok).toBe(false);
    expect(recorded.params).toMatchObject({
      total: result.chunks.length,
      failed: result.chunks.length - 2,
    });
  });

  it('plans without posting, auditing or touching Discord when it is a dry run', async () => {
    const { service, reply, audit } = build({ reactors: [user(1)] });
    const result = await service.mentionReactors(
      GUILD,
      { ...reactorsInput, replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } },
      ACTOR,
      { dryRun: true },
    );

    expect(result).toMatchObject({ dryRun: true, status: 'OK', delivered: false, count: 1 });
    expect(result.chunks).not.toHaveLength(0);
    expect(reply.reply).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports Discord’s refusal to post as a result, audited as a failure', async () => {
    const { service, reply, audit } = build({ reactors: [user(1)] });
    reply.reply.mockRejectedValue(discordFailure('Missing Permissions'));
    const result = await service.mentionReactors(
      GUILD,
      { ...reactorsInput, replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } },
      ACTOR,
    );

    expect(result).toMatchObject({
      status: 'SEND_FAILED',
      delivered: false,
      failure: 'Missing Permissions',
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'DISCORD_API_ERROR' }),
    );
  });

  it('lets an error that is not a refusal reach the error handler', async () => {
    const { service, reply } = build({ reactors: [user(1)] });
    reply.reply.mockRejectedValue(new TypeError('boom'));
    await expect(
      service.mentionReactors(
        GUILD,
        { ...reactorsInput, replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } },
        ACTOR,
      ),
    ).rejects.toThrow(TypeError);
  });

  it('does not turn a failed audit write into an error after the post went out', async () => {
    const { service } = build({ reactors: [user(1)], auditFails: true });
    await expect(service.mentionReactors(GUILD, reactorsInput, ACTOR)).resolves.toMatchObject({
      status: 'OK',
    });
  });

  it('refuses a message from another server, answering as for a channel that does not exist', async () => {
    const { service } = build({
      reactors: [user(1)],
      source: fakeMessage(MESSAGE, CHANNEL, { guildId: OTHER_GUILD }),
    });
    await expect(service.mentionReactors(GUILD, reactorsInput, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
  });

  it('refuses a reply target in another server unless the caller allows it', async () => {
    const reply = fakeMessage(REPLY_MESSAGE, REPLY_CHANNEL, { guildId: OTHER_GUILD });
    const input = {
      ...reactorsInput,
      replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE },
    };
    const strict = build({ reactors: [user(1)], reply });
    await expect(strict.service.mentionReactors(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });

    const lenient = build({ reactors: [user(1)], reply });
    await expect(
      lenient.service.mentionReactors(GUILD, input, ACTOR, { crossGuild: true }),
    ).resolves.toMatchObject({ delivered: true });
  });

  it('maps a message Discord cannot find to the shared error code', async () => {
    const { service } = build({ reactors: [user(1)] });
    await expect(
      service.mentionReactors(GUILD, { ...reactorsInput, messageId: '100000000000000099' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_MESSAGE_NOT_FOUND });
  });

  it('rejects input that is not what the schema says', async () => {
    const { service } = build({ reactors: [user(1)] });
    await expect(
      service.mentionReactors(GUILD, { ...reactorsInput, emoji: '  ' }, ACTOR),
    ).rejects.toBeInstanceOf(ServiceError);
    await expect(service.mentionReactors('not-an-id', reactorsInput, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});

describe('mentionNonReactors', () => {
  const input = { channelId: CHANNEL, messageId: MESSAGE, locale: 'en' as const };

  it('lists the members who can see the channel and did not react, bots left out', async () => {
    const members = [
      member(user(1)),
      member(user(2)),
      member(user(3), { bot: true }),
      member(ASKER),
    ];
    const { service, audit } = build({
      reactors: [user(2)],
      source: fakeMessage(MESSAGE, CHANNEL, { members }),
    });
    const result = await service.mentionNonReactors(GUILD, input, ACTOR);

    expect(result).toMatchObject({ status: 'OK', count: 2, sample: [user(1), ASKER] });
    expect(result.chunks[0]).toContain(`<@${ASKER}> (author),`);
    expect(result.chunks[0]).not.toContain(user(3));
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: AUDIT_ACTIONS.mentionNonReactors }),
    );
  });

  it('includes bots when asked', async () => {
    const members = [member(user(1)), member(user(3), { bot: true })];
    const { service } = build({ source: fakeMessage(MESSAGE, CHANNEL, { members }) });
    const result = await service.mentionNonReactors(GUILD, { ...input, includeBots: true }, ACTOR);
    expect(result.sample).toEqual([user(1), user(3)]);
  });

  it('narrows to the role, and counts a reaction with any emoji', async () => {
    const members = [
      member(user(1), { roles: [ROLE] }),
      member(user(2)),
      member(user(4), { roles: [ROLE] }),
    ];
    const { service, reactions } = build({
      reactors: [user(4)],
      source: fakeMessage(MESSAGE, CHANNEL, { members }),
    });
    const result = await service.mentionNonReactors(GUILD, { ...input, roleId: ROLE }, ACTOR);

    expect(result.sample).toEqual([user(1)]);
    expect(reactions.fetchReactorIds).toHaveBeenCalledWith(expect.anything());
    expect(reactions.fetchReactorIds.mock.calls[0]).toHaveLength(1);
  });

  it('takes every member of the role, in or out of the channel, when onlyInChannel is false', async () => {
    const inChannel = [member(user(1), { roles: [ROLE] })];
    const source = fakeMessage(MESSAGE, CHANNEL, { members: inChannel });
    source.guild.members.fetch.mockResolvedValue(
      collect([...inChannel, member(user(5), { roles: [ROLE] }), member(user(6))]),
    );
    const { service } = build({ source });
    const result = await service.mentionNonReactors(
      GUILD,
      { ...input, roleId: ROLE, onlyInChannel: false },
      ACTOR,
    );
    expect(result.sample).toEqual([user(1), user(5)]);
  });

  it('takes the bots of the role too when onlyInChannel is false, as the old command did', async () => {
    const source = fakeMessage(MESSAGE, CHANNEL, { members: [] });
    source.guild.members.fetch.mockResolvedValue(
      collect([
        member(user(5), { roles: [ROLE] }),
        member(user(7), { roles: [ROLE], bot: true }),
        member(user(6)),
      ]),
    );
    const { service } = build({ source });
    const result = await service.mentionNonReactors(
      GUILD,
      { ...input, roleId: ROLE, onlyInChannel: false },
      ACTOR,
    );
    expect(result.sample).toEqual([user(5), user(7)]);
  });

  it('reads the members of a thread rather than the channel', async () => {
    const everyone = [member(user(1)), member(user(2)), member(user(3))];
    const thread = {
      type: ChannelType.PublicThread,
      isThread: () => true,
      members: { fetch: vi.fn().mockResolvedValue(collect([member(user(1)), member(user(2))])) },
    };
    const source = fakeMessage(MESSAGE, CHANNEL, { channel: thread, members: everyone });
    const { service } = build({ reactors: [user(2)], source });
    const result = await service.mentionNonReactors(GUILD, input, ACTOR);

    expect(thread.members.fetch).toHaveBeenCalledWith({ withMember: true });
    expect(result.sample).toEqual([user(1)]);
  });

  it.each([ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildForum])(
    'refuses channel type %s',
    async (type) => {
      const channel = { type, isThread: () => false };
      const source = fakeMessage(MESSAGE, CHANNEL, { channel });
      const { service, audit } = build({ source });
      const result = await service.mentionNonReactors(GUILD, input, ACTOR);
      expect(result).toMatchObject({ status: 'UNSUPPORTED_CHANNEL', chunks: [] });
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('says everyone reacted, without a list, when nobody is missing', async () => {
    const members = [member(user(1))];
    const { service, audit } = build({
      reactors: [user(1)],
      source: fakeMessage(MESSAGE, CHANNEL, { members }),
    });
    const result = await service.mentionNonReactors(GUILD, input, ACTOR);
    expect(result).toMatchObject({ status: 'ALL_REACTED', count: 0, chunks: [] });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('replies to the message itself when asked', async () => {
    const members = [member(user(1))];
    const source = fakeMessage(MESSAGE, CHANNEL, { members });
    const { service } = build({ source });
    const result = await service.mentionNonReactors(GUILD, { ...input, reply: true }, ACTOR);

    expect(result.delivered).toBe(true);
    expect(source.reply).toHaveBeenCalledTimes(1);
  });

  it('plans without posting when it is a dry run', async () => {
    const members = [member(user(1))];
    const source = fakeMessage(MESSAGE, CHANNEL, { members });
    const { service, audit } = build({ source });
    const result = await service.mentionNonReactors(GUILD, { ...input, reply: true }, ACTOR, {
      dryRun: true,
    });

    expect(result).toMatchObject({ dryRun: true, delivered: false, count: 1 });
    expect(source.reply).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('mentionEveryoneInThread', () => {
  const THREAD = '100000000000000051';
  const thread = (guildId = GUILD) => ({
    id: THREAD,
    guildId,
    isThread: () => true,
    send: vi.fn().mockResolvedValue(undefined),
  });
  const input = { threadId: THREAD, content: 'Meeting at 8', locale: 'en' as const };

  it('posts in the thread letting @everyone, users and roles ping, as the old bot did', async () => {
    const target = thread();
    const { service, audit } = build({ thread: target });
    const result = await service.mentionEveryoneInThread(GUILD, input, ACTOR);

    expect(result.status).toBe('OK');
    expect(result.text).toBe(`<@${ASKER}> mentioned @everyone\nMeeting at 8`);
    expect(target.send).toHaveBeenCalledWith({
      content: result.text,
      allowedMentions: { parse: ['users', 'roles', 'everyone'] },
    });
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.mentionEveryone,
        params: { channelId: THREAD },
      }),
    );
  });

  it('drops the empty second line when there is no text', async () => {
    const { service } = build({ thread: thread() });
    const result = await service.mentionEveryoneInThread(
      GUILD,
      { threadId: THREAD, locale: 'en' },
      ACTOR,
    );
    expect(result.text).toBe(`<@${ASKER}> mentioned @everyone`);
  });

  it('replies to the given message instead when there is one', async () => {
    const target = thread();
    const { service, reply } = build({ thread: target });
    await service.mentionEveryoneInThread(
      GUILD,
      { ...input, replyTo: { channelId: REPLY_CHANNEL, messageId: REPLY_MESSAGE } },
      ACTOR,
    );
    expect(reply.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedMentions: { parse: ['users', 'roles', 'everyone'], repliedUser: true },
      }),
    );
    expect(target.send).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a thread, sending nothing', async () => {
    const channel = { id: THREAD, isThread: () => false, send: vi.fn() };
    const { service, audit } = build({ thread: channel });
    const result = await service.mentionEveryoneInThread(GUILD, input, ACTOR);
    expect(result).toMatchObject({ status: 'NOT_A_THREAD', text: '' });
    expect(channel.send).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses a thread of another server', async () => {
    const { service } = build({ thread: thread(OTHER_GUILD) });
    await expect(service.mentionEveryoneInThread(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
  });

  it('maps a thread the bot cannot see to the channel error', async () => {
    const { service, client } = build();
    client.channels.fetch.mockRejectedValue(discordFailure('Unknown Channel', 10003));
    await expect(service.mentionEveryoneInThread(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
  });

  it('plans the text without sending when it is a dry run', async () => {
    const target = thread();
    const { service, audit } = build({ thread: target });
    const result = await service.mentionEveryoneInThread(GUILD, input, ACTOR, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, status: 'OK' });
    expect(target.send).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('reports a refusal from Discord instead of throwing', async () => {
    const target = thread();
    target.send.mockRejectedValue(discordFailure('Missing Access', 50001));
    const { service } = build({ thread: target });
    const result = await service.mentionEveryoneInThread(GUILD, input, ACTOR);
    expect(result).toMatchObject({ status: 'SEND_FAILED', failure: 'Missing Access' });
  });

  it.each(['HTTP', 'MCP'] as const)(
    'refuses a %s caller: @everyone is for slash commands',
    async (source) => {
      const target = thread();
      const { service, audit } = build({ thread: target });
      await expect(
        service.mentionEveryoneInThread(GUILD, input, { source, userId: ASKER }),
      ).rejects.toMatchObject({ code: ErrorCode.AUTH_FORBIDDEN });
      expect(target.send).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    },
  );

  it('needs a person to name', async () => {
    const { service } = build({ thread: thread() });
    await expect(
      service.mentionEveryoneInThread(GUILD, input, { source: 'SYSTEM' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});
