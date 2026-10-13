import 'reflect-metadata';
import {
  AUDIT_ACTIONS,
  ErrorCode,
  THREAD_MESSAGE_MAX_LENGTH,
  THREAD_NAME_MAX_LENGTH,
  type ActorContext,
} from '@sab/shared';
import { ChannelType, Collection, ThreadAutoArchiveDuration } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { ThreadService } from './thread.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const USER = '300000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: USER };

/** `expect.objectContaining` is typed `any`; naming it `unknown` keeps the matcher usable inside other matchers. */
const containing = (expected: object): unknown => expect.objectContaining(expected);

const discordError = (code: number, text = 'Discord error') =>
  Object.assign(new Error(text), { code });

function fakeThread(n: number, name: string, failure?: Error) {
  const thread = {
    id: `5000000000000000${String(n).padStart(2, '0')}`,
    name,
    setName: vi.fn((next: string) => {
      if (failure) return Promise.reject(failure);
      thread.name = next;
      return Promise.resolve(thread);
    }),
    delete: vi.fn(() => (failure ? Promise.reject(failure) : Promise.resolve(thread))),
    send: vi.fn().mockResolvedValue(undefined),
  };
  return thread;
}

type Setup = {
  type?: ChannelType;
  guildId?: string;
  active?: Array<ReturnType<typeof fakeThread>>;
  createError?: Error;
};

function build(setup: Setup = {}) {
  const created = fakeThread(99, 'created');
  const threads = {
    fetch: vi.fn(() =>
      Promise.resolve({
        threads: new Collection((setup.active ?? []).map((thread) => [thread.id, thread] as const)),
      }),
    ),
    create: vi.fn((_options: Record<string, unknown>) =>
      setup.createError ? Promise.reject(setup.createError) : Promise.resolve(created),
    ),
  };
  const channel = {
    id: CHANNEL,
    type: setup.type ?? ChannelType.GuildText,
    guildId: setup.guildId ?? GUILD,
    guild: {},
    threads,
  };
  const client = {
    channels: { fetch: vi.fn((id: string) => Promise.resolve(id === CHANNEL ? channel : null)) },
  };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new ThreadService(client as never, audit as unknown as AuditService);
  return { service, threads, created, audit, client };
}

const body = { channelId: CHANNEL, name: 'Planning', message: 'Hello everyone' };

describe('ThreadService.create', () => {
  it('opens a public thread in a text channel and posts the message under the byline', async () => {
    const { service, threads, created, audit } = build();

    const result = await service.create(
      GUILD,
      { ...body, byline: '<@3> created this thread.' },
      ACTOR,
    );

    expect(result).toEqual({ status: 'CREATED', threadId: created.id });
    expect(threads.create).toHaveBeenCalledWith({
      name: 'Planning',
      type: ChannelType.PublicThread,
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
      reason: `Create thread by ${USER}`,
    });
    expect(created.send).toHaveBeenCalledWith({
      content: '<@3> created this thread.\n\nHello everyone',
      allowedMentions: { parse: ['users', 'roles'] },
    });
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.threadCreate,
      params: { channelId: CHANNEL, threadId: created.id, kind: 'public' },
    });
  });

  it('posts the bare message when no byline is given', async () => {
    const { service, created } = build();
    await service.create(GUILD, body, ACTOR);
    expect(created.send).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'Hello everyone' }),
    );
  });

  it('pings nobody from the post of a caller that is not a slash command', async () => {
    const { service, created } = build();
    await service.create(GUILD, body, { source: 'HTTP', userId: USER });
    expect(created.send).toHaveBeenCalledWith(
      expect.objectContaining({ allowedMentions: { parse: [] } }),
    );
  });

  it('removes the thread it made when the first post cannot be sent', async () => {
    const { service, created } = build();
    created.send.mockRejectedValue(discordError(50013, 'Missing Permissions'));

    await expect(service.create(GUILD, body, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
    });
    expect(created.delete).toHaveBeenCalledTimes(1);
  });

  it('still reports the failed post when the unfinished thread cannot be removed either', async () => {
    const { service, created } = build();
    created.send.mockRejectedValue(discordError(50013, 'Missing Permissions'));
    created.delete.mockRejectedValue(discordError(50013, 'Missing Permissions'));

    await expect(service.create(GUILD, body, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
    });
  });

  it('makes a private thread in a text channel when asked', async () => {
    const { service, threads } = build();
    await service.create(GUILD, { ...body, isPrivate: true }, ACTOR);
    expect(threads.create.mock.calls[0]![0]).toMatchObject({ type: ChannelType.PrivateThread });
  });

  it('refuses a private thread outside a text channel without creating anything', async () => {
    const { service, threads, audit } = build({ type: ChannelType.GuildAnnouncement });

    const result = await service.create(GUILD, { ...body, isPrivate: true }, ACTOR);

    expect(result).toEqual({ status: 'PRIVATE_NEEDS_TEXT_CHANNEL', threadId: null });
    expect(threads.create).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('opens an announcement thread in an announcement channel', async () => {
    const { service, threads } = build({ type: ChannelType.GuildAnnouncement });
    await service.create(GUILD, body, ACTOR);
    expect(threads.create.mock.calls[0]![0]).toMatchObject({
      type: ChannelType.AnnouncementThread,
    });
  });

  it('makes the message the first post of a forum thread and ignores is-private there', async () => {
    const { service, threads, created, audit } = build({ type: ChannelType.GuildForum });

    const result = await service.create(
      GUILD,
      { ...body, isPrivate: true, byline: 'By me.' },
      ACTOR,
    );

    expect(result.status).toBe('CREATED');
    const options = threads.create.mock.calls[0]![0];
    expect(options).toMatchObject({
      name: 'Planning',
      message: {
        content: 'By me.\n\nHello everyone',
        allowedMentions: { parse: ['users', 'roles'] },
      },
    });
    expect(options).not.toHaveProperty('type');
    expect(created.send).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ params: containing({ kind: 'forum' }) }),
    );
  });

  it('says a channel that cannot hold threads cannot', async () => {
    const { service, threads } = build({ type: ChannelType.GuildVoice });

    expect(await service.create(GUILD, body, ACTOR)).toEqual({
      status: 'CHANNEL_CANNOT_HOLD_THREADS',
      threadId: null,
    });
    expect(threads.create).not.toHaveBeenCalled();
  });

  it('treats a channel of another server as not found', async () => {
    const { service } = build({ guildId: '900000000000000009' });
    await expect(service.create(GUILD, body, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
  });

  it('rejects a blank name, a blank message and one that is too long before touching Discord', async () => {
    const { service, client } = build();
    for (const bad of [
      { ...body, name: '   ' },
      { ...body, message: '  \n ' },
      { ...body, name: 'x'.repeat(THREAD_NAME_MAX_LENGTH + 1) },
      { ...body, message: 'x'.repeat(THREAD_MESSAGE_MAX_LENGTH + 1) },
      { ...body, message: 'x'.repeat(1899) },
    ]) {
      await expect(service.create(GUILD, bad, ACTOR)).rejects.toMatchObject({
        code: ErrorCode.VALIDATION_FAILED,
      });
    }
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('turns a Discord refusal into a service error', async () => {
    const { service } = build({ createError: discordError(50013, 'Missing Permissions') });
    await expect(service.create(GUILD, body, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_MISSING_PERMISSIONS,
    });
  });
});

describe('ThreadService.renameByPrefix', () => {
  const input = { channelId: CHANNEL, oldPrefix: 'A-', newPrefix: 'Z-' };

  it('replaces only the leading prefix of active threads that start with it', async () => {
    const a = fakeThread(1, 'A-one-A-');
    const b = fakeThread(2, 'B-two');
    const c = fakeThread(3, 'A-three');
    const { service, threads, audit } = build({ active: [c, b, a] });

    const result = await service.renameByPrefix(GUILD, input, ACTOR);

    expect(threads.fetch).toHaveBeenCalledWith();
    expect(result).toEqual({ status: 'OK', count: 2, done: 2, failures: [] });
    expect(a.name).toBe('Z-one-A-');
    expect(c.name).toBe('Z-three');
    expect(b.setName).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.threadRename,
      params: { channelId: CHANNEL, count: 2, failed: 0, total: 2 },
    });
  });

  it('matches the prefix exactly, spaces included', async () => {
    const spaced = fakeThread(1, 'A- one');
    const tight = fakeThread(2, 'A-two');
    const { service } = build({ active: [spaced, tight] });

    const result = await service.renameByPrefix(
      GUILD,
      { ...input, oldPrefix: 'A- ', newPrefix: 'Z-' },
      ACTOR,
    );

    expect(result).toMatchObject({ count: 1, done: 1 });
    expect(spaced.name).toBe('Z-one');
    expect(tight.setName).not.toHaveBeenCalled();
  });

  it('previews without renaming or auditing, naming the new names', async () => {
    const a = fakeThread(1, 'A-one');
    const { service, audit } = build({ active: [a] });

    const plan = await service.renameByPrefix(GUILD, input, ACTOR, { dryRun: true });

    expect(plan).toEqual({
      status: 'OK',
      count: 1,
      invalid: 0,
      sample: [{ threadId: a.id, name: 'A-one', newName: 'Z-one' }],
    });
    expect(a.setName).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('lists only the first few threads in a preview but counts them all', async () => {
    const many = Array.from({ length: 14 }, (_, i) => fakeThread(i + 1, `A-${i}`));
    const { service } = build({ active: many });

    const plan = await service.renameByPrefix(GUILD, input, ACTOR, { dryRun: true });

    expect(plan.count).toBe(14);
    expect(plan.sample).toHaveLength(10);
  });

  it('does not attempt a name that would be too long, and reports it', async () => {
    const short = fakeThread(1, 'A-x');
    const whole = fakeThread(2, 'A-');
    const { service } = build({ active: [short, whole] });
    const longPrefix = 'L'.repeat(THREAD_NAME_MAX_LENGTH);
    const request = { channelId: CHANNEL, oldPrefix: 'A-', newPrefix: longPrefix };

    const plan = await service.renameByPrefix(GUILD, request, ACTOR, { dryRun: true });
    expect(plan).toMatchObject({ count: 2, invalid: 1 });

    const result = await service.renameByPrefix(GUILD, request, ACTOR);
    expect(result).toMatchObject({ count: 2, done: 1 });
    expect(result.failures).toEqual([{ threadId: short.id, name: 'A-x', reason: 'NAME_INVALID' }]);
    expect(short.setName).not.toHaveBeenCalled();
    expect(whole.name).toBe(longPrefix);
  });

  it('does not attempt a name that would be empty, and reports it', async () => {
    const short = fakeThread(1, 'A-x');
    const whole = fakeThread(2, 'A-');
    const { service } = build({ active: [short, whole] });

    const result = await service.renameByPrefix(
      GUILD,
      { channelId: CHANNEL, oldPrefix: 'A-', newPrefix: '' },
      ACTOR,
    );

    expect(short.name).toBe('x');
    expect(result.failures).toEqual([{ threadId: whole.id, name: 'A-', reason: 'NAME_INVALID' }]);
    expect(whole.setName).not.toHaveBeenCalled();
  });

  it("keeps going after one thread fails and lists the failure with Discord's own words", async () => {
    const ok = fakeThread(1, 'A-ok');
    const locked = fakeThread(2, 'A-locked', discordError(50013, 'Missing Permissions'));
    const later = fakeThread(3, 'A-later');
    const { service, audit } = build({ active: [ok, locked, later] });

    const result = await service.renameByPrefix(GUILD, input, ACTOR);

    expect(result).toMatchObject({ count: 3, done: 2 });
    expect(result.failures).toEqual([
      { threadId: locked.id, name: 'A-locked', reason: 'Missing Permissions' },
    ]);
    expect(later.name).toBe('Z-later');
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ params: { channelId: CHANNEL, count: 2, failed: 1, total: 3 } }),
    );
  });

  it('does not call Discord to rename a thread to the name it has', async () => {
    const a = fakeThread(1, 'A-one');
    const { service } = build({ active: [a] });

    const result = await service.renameByPrefix(
      GUILD,
      { channelId: CHANNEL, oldPrefix: 'A-', newPrefix: 'A-' },
      ACTOR,
    );

    expect(a.setName).not.toHaveBeenCalled();
    expect(result).toMatchObject({ count: 1, done: 1 });
  });

  it('answers in the right shape for a channel without threads', async () => {
    const { service } = build({ type: ChannelType.GuildVoice });

    expect(await service.renameByPrefix(GUILD, input, ACTOR, { dryRun: true })).toEqual({
      status: 'CHANNEL_CANNOT_HOLD_THREADS',
      count: 0,
      invalid: 0,
      sample: [],
    });
    expect(await service.renameByPrefix(GUILD, input, ACTOR)).toEqual({
      status: 'CHANNEL_CANNOT_HOLD_THREADS',
      count: 0,
      done: 0,
      failures: [],
    });
  });

  it('rejects an empty old prefix', async () => {
    const { service } = build();
    await expect(
      service.renameByPrefix(GUILD, { ...input, oldPrefix: '' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });
});

describe('ThreadService.deleteByPrefix', () => {
  const input = { channelId: CHANNEL, prefix: 'Old-' };

  it('previews the threads that would go and deletes nothing', async () => {
    const a = fakeThread(1, 'Old-a');
    const b = fakeThread(2, 'New-b');
    const { service, audit } = build({ active: [a, b] });

    const plan = await service.deleteByPrefix(GUILD, input, ACTOR, { dryRun: true });

    expect(plan).toEqual({
      status: 'OK',
      count: 1,
      invalid: 0,
      sample: [{ threadId: a.id, name: 'Old-a' }],
    });
    expect(a.delete).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('deletes the matching active threads and audits once', async () => {
    const a = fakeThread(1, 'Old-a');
    const b = fakeThread(2, 'Old-b');
    const keep = fakeThread(3, 'Keep');
    const { service, audit } = build({ active: [a, b, keep] });

    const result = await service.deleteByPrefix(GUILD, input, ACTOR);

    expect(result).toEqual({ status: 'OK', count: 2, done: 2, failures: [] });
    expect(keep.delete).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AUDIT_ACTIONS.threadDelete,
        params: { channelId: CHANNEL, count: 2, failed: 0, total: 2 },
      }),
    );
  });

  it('lists a thread it could not delete and carries on', async () => {
    const a = fakeThread(1, 'Old-a', discordError(50013, 'Missing Permissions'));
    const b = fakeThread(2, 'Old-b');
    const { service } = build({ active: [a, b] });

    const result = await service.deleteByPrefix(GUILD, input, ACTOR);

    expect(result).toMatchObject({ count: 2, done: 1 });
    expect(result.failures).toEqual([
      { threadId: a.id, name: 'Old-a', reason: 'Missing Permissions' },
    ]);
  });

  it('does not audit when nothing matched', async () => {
    const { service, audit } = build({ active: [fakeThread(1, 'Keep')] });

    expect(await service.deleteByPrefix(GUILD, input, ACTOR)).toEqual({
      status: 'OK',
      count: 0,
      done: 0,
      failures: [],
    });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('treats a channel of another server as not found', async () => {
    const { service } = build({ guildId: '900000000000000009' });
    await expect(service.deleteByPrefix(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });
  });
});
