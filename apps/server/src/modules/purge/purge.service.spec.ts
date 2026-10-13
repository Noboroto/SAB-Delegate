import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, PURGE_RANGE_MAX, type ActorContext } from '@sab/shared';
import { Collection } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import { PurgeService } from './purge.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '200000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '300000000000000001' };

const DISCORD_EPOCH = 1_420_070_400_000;
const NOW = Date.now();
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

type FakeMessage = { id: string; createdTimestamp: number; system: boolean };

let sequence = 0;
/** A message created `ageMs` ago; ids grow with time, as snowflakes do. */
function message(ageMs: number, system = false): FakeMessage {
  const createdTimestamp = NOW - ageMs;
  const id = ((BigInt(createdTimestamp - DISCORD_EPOCH) << 22n) + BigInt(sequence++)).toString();
  return { id, createdTimestamp, system };
}

/** Oldest first: `[0]` is the oldest, the last is the newest. */
function conversation(count: number, systemAt: number[] = []): FakeMessage[] {
  return Array.from({ length: count }, (_, index) =>
    message((count - index) * MINUTE, systemAt.includes(index)),
  );
}

const discordError = (code: number, text = 'Discord error') =>
  Object.assign(new Error(text), { code });

type Setup = {
  messages: FakeMessage[];
  guildId?: string;
  dm?: boolean;
  bulkError?: Error;
  singleErrors?: Map<string, Error>;
  auditError?: Error;
};

function build(setup: Setup) {
  const store = [...setup.messages];
  const newestFirst = () => [...store].sort((a, b) => (BigInt(a.id) < BigInt(b.id) ? 1 : -1));
  const remove = (id: string) => {
    const index = store.findIndex((entry) => entry.id === id);
    if (index >= 0) store.splice(index, 1);
  };

  const messages = {
    fetch: vi.fn((arg: { message?: string; limit?: number; before?: string }) => {
      if (arg.message !== undefined) {
        const found = store.find((entry) => entry.id === arg.message);
        return found ? Promise.resolve(found) : Promise.reject(discordError(10008));
      }
      const page = newestFirst()
        .filter((entry) => arg.before === undefined || BigInt(entry.id) < BigInt(arg.before))
        .slice(0, arg.limit ?? 50);
      return Promise.resolve(new Collection(page.map((entry) => [entry.id, entry] as const)));
    }),
    delete: vi.fn((id: string) => {
      const failure = setup.singleErrors?.get(id);
      if (failure) return Promise.reject(failure);
      remove(id);
      return Promise.resolve();
    }),
  };
  const channel = {
    id: CHANNEL,
    guildId: setup.guildId ?? GUILD,
    isTextBased: () => true,
    isDMBased: () => setup.dm === true,
    messages,
    bulkDelete: vi.fn((ids: string[], _filterOld?: boolean) => {
      if (setup.bulkError) return Promise.reject(setup.bulkError);
      for (const id of ids) remove(id);
      return Promise.resolve(new Collection());
    }),
  };
  const client = {
    channels: { fetch: vi.fn((id: string) => Promise.resolve(id === CHANNEL ? channel : null)) },
  };
  const audit = {
    record: vi.fn(() =>
      setup.auditError ? Promise.reject(setup.auditError) : Promise.resolve(undefined),
    ),
  };
  const service = new PurgeService(client as never, audit as unknown as AuditService);
  return { service, channel, messages, client, audit, store };
}

/** `expect.objectContaining` is typed `any`; naming it `unknown` keeps the matcher usable inside other matchers. */
const containing = (expected: object): unknown => expect.objectContaining(expected);

const ids = (list: FakeMessage[]) => list.map((entry) => entry.id);

describe('PurgeService.purgeRange', () => {
  it('keeps the until message and selects everything newer, up to the newest', async () => {
    const all = conversation(6);
    const { service, store } = build({ messages: all });

    const plan = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[1]!.id },
      ACTOR,
      { dryRun: true },
    );

    expect(plan).toMatchObject({
      status: 'OK',
      count: 4,
      fromMessageId: all[5]!.id,
      olderCount: 0,
    });
    expect(plan.sample).toEqual(ids(all.slice(2)).reverse());
    expect(store).toHaveLength(6);
  });

  it('includes the from message and leaves the newer ones', async () => {
    const all = conversation(6);
    const { service } = build({ messages: all });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[1]!.id, fromMessageId: all[4]!.id },
      ACTOR,
    );

    expect(result).toEqual({ status: 'OK', count: 3, deleted: 3, failed: 0 });
  });

  it('never selects system messages, not even as the from message', async () => {
    const all = conversation(6, [3, 5]);
    const { service } = build({ messages: all });

    const plan = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[0]!.id },
      ACTOR,
      { dryRun: true },
    );

    expect(plan.count).toBe(3);
    expect(plan.sample).toEqual([all[4]!.id, all[2]!.id, all[1]!.id]);
  });

  it('refuses an until message that is not older than the from message', async () => {
    const all = conversation(4);
    const { service } = build({ messages: all });

    const plan = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[3]!.id, fromMessageId: all[1]!.id },
      ACTOR,
      { dryRun: true },
    );
    expect(plan).toMatchObject({ status: 'RANGE_REVERSED', count: 0 });

    const same = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[2]!.id, fromMessageId: all[2]!.id },
      ACTOR,
      { dryRun: true },
    );
    expect(same.status).toBe('RANGE_REVERSED');
  });

  it('has nothing to do when the until message is the newest and no from message is given', async () => {
    const all = conversation(3);
    const { service, audit } = build({ messages: all });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[2]!.id },
      ACTOR,
    );

    expect(result).toEqual({ status: 'OK', count: 0, deleted: 0, failed: 0 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('says which message is missing, and a message of another channel counts as missing', async () => {
    const all = conversation(3);
    const { service } = build({ messages: all });
    const stranger = message(2 * MINUTE).id;

    expect(
      (
        await service.purgeRange(GUILD, { channelId: CHANNEL, untilMessageId: stranger }, ACTOR, {
          dryRun: true,
        })
      ).status,
    ).toBe('UNTIL_NOT_FOUND');
    expect(
      (
        await service.purgeRange(
          GUILD,
          { channelId: CHANNEL, untilMessageId: all[0]!.id, fromMessageId: stranger },
          ACTOR,
          { dryRun: true },
        )
      ).status,
    ).toBe('FROM_NOT_FOUND');
  });

  it('refuses a range past the maximum instead of cutting it', async () => {
    const all = conversation(PURGE_RANGE_MAX + 3);
    const { service, store } = build({ messages: all });

    const plan = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[0]!.id },
      ACTOR,
      { dryRun: true },
    );

    expect(plan).toMatchObject({ status: 'RANGE_TOO_LARGE', count: 0 });
    expect(store).toHaveLength(all.length);
  });

  it('the preview counts exactly what the real run deletes, and only the real run is audited', async () => {
    const all = conversation(8, [2]);
    const { service, audit, store } = build({ messages: all });
    const input = { channelId: CHANNEL, untilMessageId: all[0]!.id };

    const plan = await service.purgeRange(GUILD, input, ACTOR, { dryRun: true });
    expect(audit.record).not.toHaveBeenCalled();
    expect(store).toHaveLength(8);

    const result = await service.purgeRange(
      GUILD,
      { ...input, fromMessageId: plan.fromMessageId },
      ACTOR,
      { dryRun: false },
    );

    expect(result.deleted).toBe(plan.count);
    expect(result.count).toBe(plan.count);
    expect(store).toHaveLength(8 - plan.count);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.purgeMessages,
      params: { channelId: CHANNEL, count: plan.count, failed: 0, total: plan.count },
    });
  });

  it('does not sweep up messages posted after the preview when the start is pinned', async () => {
    const all = conversation(5);
    const { service, store, messages } = build({ messages: all });
    const input = { channelId: CHANNEL, untilMessageId: all[0]!.id };
    const plan = await service.purgeRange(GUILD, input, ACTOR, { dryRun: true });

    const late = message(0);
    store.push(late);
    const result = await service.purgeRange(
      GUILD,
      { ...input, fromMessageId: plan.fromMessageId },
      ACTOR,
    );

    expect(result.deleted).toBe(4);
    expect(store.map((entry) => entry.id)).toEqual([all[0]!.id, late.id]);
    expect(messages.delete).not.toHaveBeenCalled();
  });
});

describe('PurgeService deleting', () => {
  it('bulk deletes young messages in requests of at most 100 and older ones one by one', async () => {
    const young = conversation(150);
    const old = [message(20 * DAY), message(30 * DAY)];
    const anchor = message(40 * DAY);
    const { service, channel, messages, store } = build({ messages: [anchor, ...old, ...young] });

    const plan = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: anchor.id },
      ACTOR,
      { dryRun: true },
    );
    expect(plan).toMatchObject({ count: 152, olderCount: 2 });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: anchor.id },
      ACTOR,
    );

    expect(result).toEqual({ status: 'OK', count: 152, deleted: 152, failed: 0 });
    expect(channel.bulkDelete.mock.calls.map(([batch]) => batch.length)).toEqual([100, 50]);
    // `false`: the service has already split by age and must not let discord.js silently drop any.
    expect(channel.bulkDelete.mock.calls.every(([, filterOld]) => filterOld === false)).toBe(true);
    expect(messages.delete).toHaveBeenCalledTimes(2);
    expect(store).toEqual([anchor]);
  });

  it('deletes a single young message with a plain delete', async () => {
    const all = conversation(2);
    const { service, channel, messages } = build({ messages: all });

    await service.purgeRange(GUILD, { channelId: CHANNEL, untilMessageId: all[0]!.id }, ACTOR);

    expect(channel.bulkDelete).not.toHaveBeenCalled();
    expect(messages.delete).toHaveBeenCalledWith(all[1]!.id);
  });

  it('falls back to deleting one by one when a bulk request fails', async () => {
    const all = conversation(5);
    const { service, channel, messages } = build({
      messages: all,
      bulkError: discordError(50035, 'Invalid Form Body'),
    });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[0]!.id },
      ACTOR,
    );

    expect(channel.bulkDelete).toHaveBeenCalledTimes(1);
    expect(messages.delete).toHaveBeenCalledTimes(4);
    expect(result).toEqual({ status: 'OK', count: 4, deleted: 4, failed: 0 });
  });

  it('stops asking once Discord says the bot may not delete there, and reports the rest as failed', async () => {
    const all = conversation(6);
    const { service, messages, audit } = build({
      messages: all,
      bulkError: discordError(50013, 'Missing Permissions'),
    });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[0]!.id },
      ACTOR,
    );

    expect(messages.delete).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'OK', count: 5, deleted: 0, failed: 5 });
    expect(audit.record).toHaveBeenCalledWith(
      containing({ params: containing({ count: 0, failed: 5 }) }),
    );
  });

  it('counts a message somebody else already deleted as gone, and other failures as failed', async () => {
    const all = conversation(4);
    const singleErrors = new Map<string, Error>([
      [all[1]!.id, discordError(10008, 'Unknown Message')],
      [all[2]!.id, discordError(50001, 'Missing Access')],
    ]);
    const { service } = build({
      messages: all,
      bulkError: discordError(50035),
      singleErrors,
    });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[0]!.id },
      ACTOR,
    );

    expect(result.count).toBe(3);
    expect(result.deleted + result.failed).toBe(3);
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  it('still answers when the audit row cannot be written', async () => {
    const all = conversation(3);
    const { service } = build({ messages: all, auditError: new Error('database down') });

    const result = await service.purgeRange(
      GUILD,
      { channelId: CHANNEL, untilMessageId: all[0]!.id },
      ACTOR,
    );

    expect(result.deleted).toBe(2);
  });
});

describe('PurgeService.purgeLast', () => {
  it('selects the newest messages, skipping system messages', async () => {
    const all = conversation(8, [7, 5]);
    const { service } = build({ messages: all });

    const plan = await service.purgeLast(GUILD, { channelId: CHANNEL, count: 3 }, ACTOR, {
      dryRun: true,
    });

    expect(plan.count).toBe(3);
    expect(plan.sample).toEqual([all[6]!.id, all[4]!.id, all[3]!.id]);
    expect(plan.fromMessageId).toBe(all[6]!.id);
  });

  it('takes fewer when the channel has fewer', async () => {
    const all = conversation(2);
    const { service } = build({ messages: all });

    const result = await service.purgeLast(GUILD, { channelId: CHANNEL, count: 50 }, ACTOR);

    expect(result).toEqual({ status: 'OK', count: 2, deleted: 2, failed: 0 });
  });

  it('counts from the pinned message so later posts are left alone', async () => {
    const all = conversation(6);
    const { service, store } = build({ messages: all });
    const plan = await service.purgeLast(GUILD, { channelId: CHANNEL, count: 2 }, ACTOR, {
      dryRun: true,
    });
    const late = message(0);
    store.push(late);

    await service.purgeLast(
      GUILD,
      { channelId: CHANNEL, count: 2, fromMessageId: plan.fromMessageId },
      ACTOR,
    );

    expect(store.map((entry) => entry.id)).toEqual([...ids(all.slice(0, 4)), late.id]);
  });

  it('reports a pinned message that is gone', async () => {
    const all = conversation(3);
    const { service } = build({ messages: all });

    const plan = await service.purgeLast(
      GUILD,
      { channelId: CHANNEL, count: 2, fromMessageId: message(MINUTE).id },
      ACTOR,
      { dryRun: true },
    );

    expect(plan.status).toBe('FROM_NOT_FOUND');
  });
});

describe('PurgeService input and channel checks', () => {
  it('refuses a channel of another server or a direct message as not found', async () => {
    const all = conversation(3);
    const input = { channelId: CHANNEL, untilMessageId: all[0]!.id };

    const other = build({ messages: all, guildId: '900000000000000009' });
    await expect(other.service.purgeRange(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });

    const dm = build({ messages: all, dm: true });
    await expect(dm.service.purgeRange(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });

    const missing = build({ messages: all });
    await expect(
      missing.service.purgeRange(GUILD, { ...input, channelId: '200000000000000099' }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND });
  });

  it('turns Discord permission failures into a service error', async () => {
    const all = conversation(3);
    const { service, client } = build({ messages: all });
    client.channels.fetch.mockRejectedValueOnce(discordError(50001, 'Missing Access'));

    await expect(
      service.purgeRange(GUILD, { channelId: CHANNEL, untilMessageId: all[0]!.id }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.DISCORD_MISSING_PERMISSIONS });
  });

  it('rejects malformed input before touching Discord', async () => {
    const { service, client } = build({ messages: [] });

    await expect(service.purgeRange(GUILD, { channelId: CHANNEL }, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(
      service.purgeLast(GUILD, { channelId: CHANNEL, count: 0 }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    await expect(
      service.purgeLast('not-an-id', { channelId: CHANNEL, count: 1 }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });
});
