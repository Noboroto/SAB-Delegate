import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, INTRO_SCAN_LIMIT, type ActorContext } from '@sab/shared';
import { Collection, PermissionFlagsBits } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import type { MessageResolver } from '../../discord/services/message-resolver.service.js';
import type { GuildConfigService } from '../guild-config/guild-config.service.js';
import { InfoService } from './info.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const OTHER = '100000000000000003';
const INTRO = '200000000000000001';
const ROLE = '300000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: USER };

const failsWith = (code: ErrorCode): unknown =>
  expect.objectContaining({ name: 'ServiceError', code });

/** Message ids grow with time, as snowflakes do; `n` larger means newer. */
const id = (n: number) => `5${String(n).padStart(17, '0')}`;
const message = (n: number, author: string) => ({
  id: id(n),
  channelId: INTRO,
  author: { id: author },
  url: `https://discord.com/channels/${GUILD}/${INTRO}/${id(n)}`,
  content: `message ${n}`,
});

type Options = {
  introChannelId?: string | null;
  unknownGuild?: boolean;
  access?: 'ok' | 'not-found' | 'missing-permissions';
  channel?: Record<string, unknown> | null;
};

function build(options: Options = {}) {
  const guild = {
    id: GUILD,
    roles: { fetch: vi.fn() },
    members: { fetch: vi.fn().mockResolvedValue(undefined) },
  };
  const channel =
    options.channel === undefined
      ? {
          id: INTRO,
          guildId: GUILD,
          isDMBased: () => false,
          isTextBased: () => true,
          isThread: () => false,
          messages: { fetch: vi.fn() },
        }
      : options.channel && { isDMBased: () => false, guildId: GUILD, ...options.channel };
  const client = {
    guilds: { fetch: vi.fn().mockResolvedValue(guild) },
    channels: { fetch: vi.fn().mockResolvedValue(channel) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const config = {
    get: vi.fn().mockImplementation(() => {
      if (options.unknownGuild === true) {
        return Promise.reject(new ServiceError(ErrorCode.GUILD_NOT_FOUND));
      }
      return Promise.resolve({
        introChannelId: options.introChannelId === undefined ? INTRO : options.introChannelId,
      });
    }),
  };
  const access = { check: vi.fn().mockResolvedValue(options.access ?? 'ok') };
  const resolver = { fetch: vi.fn() };
  const reactions = { hasReaction: vi.fn(), fetchReactorIds: vi.fn() };
  const service = new InfoService(
    client as never,
    audit as unknown as AuditService,
    config as unknown as GuildConfigService,
    access as unknown as ChannelAccessService,
    resolver as unknown as MessageResolver,
    reactions as unknown as DiscordReactionService,
  );
  return { service, guild, channel, client, audit, config, access, resolver, reactions };
}

/** A batch the way Discord returns it: newest first. */
const batchOf = (...messages: Array<ReturnType<typeof message>>) =>
  new Collection(messages.map((entry) => [entry.id, entry]));

describe('InfoService.getIntroduction', () => {
  it('says so when the server has no intro channel, or is unknown', async () => {
    for (const options of [{ introChannelId: null }, { unknownGuild: true }]) {
      const { service, client } = build(options);
      await expect(service.getIntroduction(GUILD, { userId: OTHER })).resolves.toEqual({
        status: 'NO_CHANNEL',
      });
      expect(client.channels.fetch).not.toHaveBeenCalled();
    }
  });

  it('refuses an intro channel the bot cannot read, naming which problem it is', async () => {
    const missing = build({ access: 'not-found' });
    await expect(missing.service.getIntroduction(GUILD, { userId: OTHER })).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
    const denied = build({ access: 'missing-permissions' });
    await expect(denied.service.getIntroduction(GUILD, { userId: OTHER })).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_MISSING_PERMISSIONS),
    );
    expect(denied.access.check).toHaveBeenCalledWith(INTRO, 'read');
  });

  it('returns the first message the member wrote, not the newest', async () => {
    const { service, channel } = build();
    const fetch = (channel as { messages: { fetch: ReturnType<typeof vi.fn> } }).messages.fetch;
    // Newest first, as Discord sends it; a short page is the last one.
    fetch.mockResolvedValueOnce(
      batchOf(
        message(9, OTHER),
        message(8, USER),
        message(7, OTHER),
        message(3, USER),
        message(2, OTHER),
      ),
    );
    const result = await service.getIntroduction(GUILD, { userId: USER });

    expect(result).toEqual({
      status: 'FOUND',
      channelId: INTRO,
      messageId: id(3),
      url: message(3, USER).url,
      content: 'message 3',
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps reading older pages while they are full, and finds the oldest match', async () => {
    const { service, channel } = build();
    const fetch = (channel as { messages: { fetch: ReturnType<typeof vi.fn> } }).messages.fetch;
    /** `count` messages counting down from `from`; the member wrote the ones in `mine`. */
    const page = (from: number, count: number, mine: number[] = []) =>
      batchOf(
        ...Array.from({ length: count }, (_, index) =>
          message(from - index, mine.includes(from - index) ? USER : OTHER),
        ),
      );
    fetch
      .mockResolvedValueOnce(page(1000, 100, [950]))
      .mockResolvedValueOnce(page(900, 100))
      .mockResolvedValueOnce(page(800, 20, [790]));
    const result = await service.getIntroduction(GUILD, { userId: USER });

    expect(result).toMatchObject({ status: 'FOUND', messageId: id(790) });
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(fetch.mock.calls[0]?.[0]).toEqual({ limit: 100, cache: false });
    expect(fetch.mock.calls[1]?.[0]).toEqual({ limit: 100, cache: false, before: id(901) });
    expect(fetch.mock.calls[2]?.[0]).toEqual({ limit: 100, cache: false, before: id(801) });
  });

  it('stops after the newest INTRO_SCAN_LIMIT messages and reports how many it read', async () => {
    const { service, channel } = build();
    const fetch = (channel as { messages: { fetch: ReturnType<typeof vi.fn> } }).messages.fetch;
    let next = 1_000_000;
    for (let page = 0; page < INTRO_SCAN_LIMIT / 100; page += 1) {
      fetch.mockResolvedValueOnce(
        batchOf(
          ...Array.from({ length: 100 }, () => {
            next -= 1;
            return message(next, OTHER);
          }),
        ),
      );
    }
    const result = await service.getIntroduction(GUILD, { userId: USER });

    expect(result).toEqual({ status: 'NOT_FOUND', scanned: INTRO_SCAN_LIMIT });
    expect(fetch).toHaveBeenCalledTimes(INTRO_SCAN_LIMIT / 100);
  });

  it('reports an empty channel as nothing found', async () => {
    const { service, channel } = build();
    (channel as { messages: { fetch: ReturnType<typeof vi.fn> } }).messages.fetch.mockResolvedValue(
      new Collection(),
    );
    await expect(service.getIntroduction(GUILD, { userId: USER })).resolves.toEqual({
      status: 'NOT_FOUND',
      scanned: 0,
    });
  });

  it('refuses an intro channel that belongs to another server', async () => {
    const { service } = build({
      channel: { guildId: '100000000000000777', isTextBased: () => true },
    });
    await expect(service.getIntroduction(GUILD, { userId: USER })).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_CHANNEL_NOT_FOUND),
    );
  });

  it('refuses a user id that is not a snowflake', async () => {
    const { service } = build();
    await expect(service.getIntroduction(GUILD, { userId: '<@1>' })).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
  });
});

describe('InfoService.listReactorIds', () => {
  const QUERY = { channelId: INTRO, messageId: id(1), emoji: ' 👍 ' };
  const found = (guildId: string | null) => ({
    status: 'OK' as const,
    message: { guildId, url: 'https://discord.com/x', channelId: INTRO, id: id(1) },
  });

  it('pages the reactors of the emoji, trimmed, and links the message', async () => {
    const { service, resolver, reactions } = build();
    resolver.fetch.mockResolvedValue(found(GUILD));
    reactions.hasReaction.mockReturnValue(true);
    reactions.fetchReactorIds.mockResolvedValue([USER, OTHER]);

    await expect(service.listReactorIds(GUILD, QUERY)).resolves.toEqual({
      url: 'https://discord.com/x',
      emoji: '👍',
      userIds: [USER, OTHER],
    });
    expect(resolver.fetch).toHaveBeenCalledWith(`${INTRO}/${id(1)}`);
    expect(reactions.hasReaction).toHaveBeenCalledWith(found(GUILD).message, '👍');
  });

  it('does not page anything for an emoji the message does not carry', async () => {
    const { service, resolver, reactions } = build();
    resolver.fetch.mockResolvedValue(found(GUILD));
    reactions.hasReaction.mockReturnValue(false);
    await expect(service.listReactorIds(GUILD, QUERY)).resolves.toMatchObject({ userIds: [] });
    expect(reactions.fetchReactorIds).not.toHaveBeenCalled();
  });

  it('serves a message of another server only to a caller that names that server', async () => {
    const { service, resolver, reactions } = build();
    resolver.fetch.mockResolvedValue(found('100000000000000777'));
    reactions.hasReaction.mockReturnValue(true);
    reactions.fetchReactorIds.mockResolvedValue([USER]);

    await expect(service.listReactorIds(GUILD, QUERY)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_MESSAGE_NOT_FOUND),
    );
    await expect(service.listReactorIds('100000000000000777', QUERY)).resolves.toMatchObject({
      userIds: [USER],
    });
  });

  it('maps a missing or unreadable message onto error codes', async () => {
    const { service, resolver } = build();
    resolver.fetch.mockResolvedValueOnce({ status: 'NOT_FOUND' });
    await expect(service.listReactorIds(GUILD, QUERY)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_MESSAGE_NOT_FOUND),
    );
    resolver.fetch.mockResolvedValueOnce({ status: 'NO_ACCESS' });
    await expect(service.listReactorIds(GUILD, QUERY)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_MISSING_PERMISSIONS),
    );
  });

  it('refuses a blank emoji or a bad id before looking anything up', async () => {
    const { service, resolver } = build();
    for (const input of [{ ...QUERY, emoji: ' ' }, { ...QUERY, messageId: 'x' }, undefined]) {
      await expect(service.listReactorIds(GUILD, input)).rejects.toEqual(
        failsWith(ErrorCode.VALIDATION_FAILED),
      );
    }
    expect(resolver.fetch).not.toHaveBeenCalled();
  });
});

describe('InfoService.listRoleMemberIds', () => {
  const holder = (memberId: string, canView = true) => ({
    id: memberId,
    canView,
  });

  function withRole(holders: Array<ReturnType<typeof holder>>, channel?: Record<string, unknown>) {
    const built = build(channel === undefined ? {} : { channel });
    built.guild.roles.fetch.mockResolvedValue({
      id: ROLE,
      name: 'Mentors',
      members: new Collection(holders.map((entry) => [entry.id, entry])),
    });
    return built;
  }

  it('lists everyone holding the role after loading the whole member list', async () => {
    const { service, guild } = withRole([holder(USER), holder(OTHER)]);
    await expect(service.listRoleMemberIds(GUILD, { roleId: ROLE })).resolves.toEqual({
      roleId: ROLE,
      roleName: 'Mentors',
      userIds: [USER, OTHER],
    });
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps only the members who can see a channel', async () => {
    const { service } = withRole([holder(USER), holder(OTHER, false)], {
      id: INTRO,
      isThread: () => false,
      permissionsFor: (entry: { canView: boolean }) => ({
        has: (flag: bigint) => entry.canView && flag === PermissionFlagsBits.ViewChannel,
      }),
    });
    const result = await service.listRoleMemberIds(GUILD, { roleId: ROLE, channelId: INTRO });
    expect(result.userIds).toEqual([USER]);
  });

  it('keeps only the members of a thread, which are not cached and so are fetched', async () => {
    const { service } = withRole([holder(USER), holder(OTHER)], {
      id: INTRO,
      isThread: () => true,
      members: { fetch: vi.fn().mockResolvedValue(new Collection([[OTHER, {}]])) },
    });
    const result = await service.listRoleMemberIds(GUILD, { roleId: ROLE, channelId: INTRO });
    expect(result.userIds).toEqual([OTHER]);
  });

  it('needs no permission of the caller: nothing here looks at who is asking', async () => {
    const { service } = withRole([holder(USER)]);
    await expect(service.listRoleMemberIds(GUILD, { roleId: ROLE })).resolves.toMatchObject({
      userIds: [USER],
    });
  });

  it('refuses a role the server does not have', async () => {
    const { service, guild } = build();
    guild.roles.fetch.mockResolvedValue(null);
    await expect(service.listRoleMemberIds(GUILD, { roleId: ROLE })).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });
});

describe('InfoService.createInvite', () => {
  const invitable = (extra: Record<string, unknown> = {}) => ({
    id: INTRO,
    name: 'general',
    isThread: () => false,
    createInvite: vi.fn().mockResolvedValue({ url: 'https://discord.gg/abc' }),
    ...extra,
  });

  it('makes a permanent unique invite and audits it', async () => {
    const channel = invitable();
    const { service, audit } = build({ channel });
    await expect(
      service.createInvite(GUILD, { channelId: INTRO, reason: 'Requested by an' }, ACTOR),
    ).resolves.toEqual({ url: 'https://discord.gg/abc', channelId: INTRO, channelName: 'general' });

    expect(channel.createInvite).toHaveBeenCalledWith({
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: 'Requested by an',
    });
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.inviteCreate,
      params: { channelId: INTRO },
    });
  });

  it('invites to the parent of a thread, because a thread holds no invite', async () => {
    const parent = invitable({ id: '200000000000000009', name: 'parent' });
    const thread = { id: INTRO, isThread: () => true, parent };
    const { service, audit } = build({ channel: thread });
    const result = await service.createInvite(GUILD, { channelId: INTRO }, ACTOR);

    expect(result).toMatchObject({ channelId: '200000000000000009', channelName: 'parent' });
    expect(parent.createInvite).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ params: { channelId: '200000000000000009' } }),
    );
  });

  it('refuses a channel that cannot hold an invite, and a thread with no parent', async () => {
    const category = build({ channel: { id: INTRO, isThread: () => false } });
    await expect(category.service.createInvite(GUILD, { channelId: INTRO }, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
    const orphan = build({ channel: { id: INTRO, isThread: () => true, parent: null } });
    await expect(orphan.service.createInvite(GUILD, { channelId: INTRO }, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
  });

  it('turns Discord refusing the invite into a missing-permissions answer, without an audit row', async () => {
    const channel = invitable({
      createInvite: vi
        .fn()
        .mockRejectedValue(Object.assign(new Error('Missing Permissions'), { code: 50013 })),
    });
    const { service, audit } = build({ channel });
    await expect(service.createInvite(GUILD, { channelId: INTRO }, ACTOR)).rejects.toEqual(
      failsWith(ErrorCode.DISCORD_MISSING_PERMISSIONS),
    );
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lets an unexpected Discord failure through to be reported', async () => {
    const channel = invitable({ createInvite: vi.fn().mockRejectedValue(new Error('boom')) });
    const { service } = build({ channel });
    await expect(service.createInvite(GUILD, { channelId: INTRO }, ACTOR)).rejects.toThrow('boom');
  });

  it('still returns the invite when only its audit row cannot be written', async () => {
    const { service, audit } = build({ channel: invitable() });
    audit.record.mockRejectedValueOnce(new Error('db down'));
    await expect(service.createInvite(GUILD, { channelId: INTRO }, ACTOR)).resolves.toMatchObject({
      url: 'https://discord.gg/abc',
    });
  });
});
