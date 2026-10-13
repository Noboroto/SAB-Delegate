import 'reflect-metadata';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  PRIVATE_THREAD_MAX_MEMBERS,
  type ActorContext,
} from '@sab/shared';
import { ChannelType, Collection, ThreadAutoArchiveDuration } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import type { MessageResolver } from '../../discord/services/message-resolver.service.js';
import { PrivateThreadService } from './private-thread.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const INVOKER = '300000000000000001';
const ALICE = '300000000000000002';
const BOB = '300000000000000003';
const STRANGER = '300000000000000004';
const ROLE = '600000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: INVOKER };

const discordError = (code: number, text = 'Discord error') =>
  Object.assign(new Error(text), { code });

type FakeMember = { id: string; user: { username: string }; roles: { cache: Set<string> } };
const member = (id: string, username: string, roles: string[] = []): FakeMember => ({
  id,
  user: { username },
  roles: { cache: new Set(roles) },
});

type Setup = {
  members?: FakeMember[];
  type?: ChannelType;
  guildId?: string;
  createFailureFor?: string;
};

function build(setup: Setup = {}) {
  const members = setup.members ?? [member(ALICE, 'alice'), member(BOB, 'bob')];
  const opened: Array<{
    name: string;
    add: ReturnType<typeof vi.fn>;
    send: ReturnType<typeof vi.fn>;
  }> = [];
  let active = 0;
  let peak = 0;

  const threads = {
    create: vi.fn(async (options: { name: string }) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise<void>((resolve) => setImmediate(resolve));
      active -= 1;
      if (setup.createFailureFor !== undefined && options.name.endsWith(setup.createFailureFor)) {
        throw discordError(50013, 'Missing Permissions');
      }
      const thread = {
        name: options.name,
        members: { add: vi.fn().mockResolvedValue(undefined) },
        send: vi.fn().mockResolvedValue(undefined),
      };
      opened.push({ name: options.name, add: thread.members.add, send: thread.send });
      return thread;
    }),
  };
  const guild = {
    members: {
      fetch: vi.fn(() =>
        Promise.resolve(new Collection(members.map((entry) => [entry.id, entry] as const))),
      ),
    },
  };
  const channel = {
    id: CHANNEL,
    type: setup.type ?? ChannelType.GuildText,
    guildId: setup.guildId ?? GUILD,
    guild,
    threads,
  };
  const client = {
    channels: { fetch: vi.fn((id: string) => Promise.resolve(id === CHANNEL ? channel : null)) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const messages = { fetch: vi.fn() };
  const reactions = { fetchReactorIds: vi.fn() };
  const service = new PrivateThreadService(
    client as never,
    audit as unknown as AuditService,
    messages as unknown as MessageResolver,
    reactions as unknown as DiscordReactionService,
  );
  return { service, threads, guild, opened, audit, messages, reactions, peak: () => peak };
}

const request = { channelId: CHANNEL, prefix: 'Team', message: 'Welcome!' };

describe('PrivateThreadService.createPrivateThreads', () => {
  it('opens one closed private thread per member and puts the member and the invoker in it', async () => {
    const { service, threads, opened, audit } = build();

    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: [ALICE, BOB] },
      ACTOR,
    );

    expect(result).toEqual({ status: 'OK', linkProblem: null, total: 2, created: 2, failures: [] });
    expect(threads.create).toHaveBeenCalledWith({
      type: ChannelType.PrivateThread,
      name: 'Team-alice',
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Create thread for Team by ${INVOKER}`,
      invitable: false,
    });
    expect(opened.map((thread) => thread.name)).toEqual(['Team-alice', 'Team-bob']);
    expect(opened[0]!.add.mock.calls.map(([id]) => id as string)).toEqual([ALICE, INVOKER]);
    expect(opened[0]!.send).toHaveBeenCalledWith({
      content: 'Welcome!',
      allowedMentions: { parse: [] },
    });
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.privateThreadCreate,
      params: { channelId: CHANNEL, count: 2, failed: 0, total: 2 },
    });
  });

  it('adds the invoker once when the invoker is also on the list', async () => {
    const { service, opened } = build({ members: [member(INVOKER, 'me')] });

    await service.createPrivateThreads(GUILD, { ...request, userIds: [INVOKER] }, ACTOR);

    expect(opened[0]!.add.mock.calls.map(([id]) => id as string)).toEqual([INVOKER]);
  });

  it('collapses duplicate ids', async () => {
    const { service } = build();
    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: [ALICE, ALICE, ALICE] },
      ACTOR,
    );
    expect(result.total).toBe(1);
  });

  it('reports an id that is not a member and still opens the others', async () => {
    const { service } = build();

    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: [ALICE, STRANGER] },
      ACTOR,
    );

    expect(result).toMatchObject({ total: 2, created: 1 });
    expect(result.failures).toEqual([{ userId: STRANGER, reason: 'MEMBER_NOT_FOUND' }]);
  });

  it('reports a member whose thread Discord refused, and finishes the rest', async () => {
    const { service } = build({ createFailureFor: 'alice' });

    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: [ALICE, BOB] },
      ACTOR,
    );

    expect(result).toMatchObject({ total: 2, created: 1 });
    expect(result.failures).toEqual([{ userId: ALICE, reason: 'Missing Permissions' }]);
  });

  it('adds every member of a role to the explicit ids', async () => {
    const { service, opened } = build({
      members: [
        member(ALICE, 'alice', [ROLE]),
        member(BOB, 'bob'),
        member(STRANGER, 'carol', [ROLE]),
      ],
    });

    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: [BOB], roleId: ROLE },
      ACTOR,
    );

    expect(result.total).toBe(3);
    expect(opened.map((thread) => thread.name).sort()).toEqual([
      'Team-alice',
      'Team-bob',
      'Team-carol',
    ]);
  });

  it('opens at most three threads at a time', async () => {
    const many = Array.from({ length: 10 }, (_, i) =>
      member(`7000000000000000${String(i).padStart(2, '0')}`, `user${i}`),
    );
    const { service, peak } = build({ members: many });

    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: many.map((entry) => entry.id) },
      ACTOR,
    );

    expect(result.created).toBe(10);
    expect(peak()).toBeLessThanOrEqual(3);
    expect(peak()).toBeGreaterThan(1);
  });

  it('says there is nobody when a role has no members, without opening anything', async () => {
    const { service, threads, audit } = build();

    const result = await service.createPrivateThreads(GUILD, { ...request, roleId: ROLE }, ACTOR);

    expect(result).toMatchObject({ status: 'NO_MEMBERS', total: 0, created: 0 });
    expect(threads.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses a role that would need more threads than one call may open', async () => {
    const crowd = Array.from({ length: PRIVATE_THREAD_MAX_MEMBERS + 1 }, (_, i) =>
      member(`8${String(i).padStart(17, '0')}`, `u${i}`, [ROLE]),
    );
    const { service, threads } = build({ members: crowd });

    await expect(
      service.createPrivateThreads(GUILD, { ...request, roleId: ROLE }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(threads.create).not.toHaveBeenCalled();
  });

  it('needs ids or a role', async () => {
    const { service } = build();
    await expect(service.createPrivateThreads(GUILD, request, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(
      service.createPrivateThreads(GUILD, { ...request, userIds: [] }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('refuses a channel that is not a text channel before listing any member', async () => {
    const { service, guild } = build({ type: ChannelType.GuildAnnouncement });

    const result = await service.createPrivateThreads(
      GUILD,
      { ...request, userIds: [ALICE] },
      ACTOR,
    );

    expect(result.status).toBe('CHANNEL_NOT_TEXT');
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });

  it('treats a channel of another server as not found', async () => {
    const { service } = build({ guildId: '900000000000000009' });
    await expect(
      service.createPrivateThreads(GUILD, { ...request, userIds: [ALICE] }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND });
  });
});

describe('PrivateThreadService.createPrivateThreadsFromReactors', () => {
  const byReaction = {
    ...request,
    messageLink: `${CHANNEL}/${'400000000000000001'}`,
    emoji: '👍',
  };

  it('opens a thread for each person who reacted with the emoji', async () => {
    const { service, messages, reactions, opened } = build();
    const message = { id: 'message' };
    messages.fetch.mockResolvedValue({ status: 'OK', message });
    reactions.fetchReactorIds.mockResolvedValue([ALICE, BOB]);

    const result = await service.createPrivateThreadsFromReactors(GUILD, byReaction, ACTOR);

    expect(messages.fetch).toHaveBeenCalledWith(byReaction.messageLink);
    expect(reactions.fetchReactorIds).toHaveBeenCalledWith(message, '👍');
    expect(result).toMatchObject({ status: 'OK', total: 2, created: 2 });
    expect(opened).toHaveLength(2);
  });

  it('says so, and opens nothing, when nobody reacted', async () => {
    const { service, messages, reactions, threads, guild } = build();
    messages.fetch.mockResolvedValue({ status: 'OK', message: {} });
    reactions.fetchReactorIds.mockResolvedValue([]);

    const result = await service.createPrivateThreadsFromReactors(GUILD, byReaction, ACTOR);

    expect(result).toMatchObject({ status: 'NO_MEMBERS', total: 0, created: 0 });
    expect(threads.create).not.toHaveBeenCalled();
    expect(guild.members.fetch).not.toHaveBeenCalled();
  });

  it('passes on why the link was refused', async () => {
    const { service, messages, reactions } = build();
    messages.fetch.mockResolvedValue({ status: 'INVALID_LINK', reason: 'MALFORMED' });

    expect(await service.createPrivateThreadsFromReactors(GUILD, byReaction, ACTOR)).toMatchObject({
      status: 'INVALID_LINK',
      linkProblem: 'MALFORMED',
    });
    expect(reactions.fetchReactorIds).not.toHaveBeenCalled();
  });

  it('tells a missing message from one the bot cannot read', async () => {
    const { service, messages } = build();
    messages.fetch.mockResolvedValueOnce({ status: 'NOT_FOUND' });
    messages.fetch.mockResolvedValueOnce({ status: 'NO_ACCESS' });

    expect((await service.createPrivateThreadsFromReactors(GUILD, byReaction, ACTOR)).status).toBe(
      'MESSAGE_NOT_FOUND',
    );
    expect((await service.createPrivateThreadsFromReactors(GUILD, byReaction, ACTOR)).status).toBe(
      'NO_ACCESS',
    );
  });

  it('refuses a channel that is not a text channel before reading the message', async () => {
    const { service, messages } = build({ type: ChannelType.GuildAnnouncement });

    const result = await service.createPrivateThreadsFromReactors(GUILD, byReaction, ACTOR);

    expect(result.status).toBe('CHANNEL_NOT_TEXT');
    expect(messages.fetch).not.toHaveBeenCalled();
  });
});
