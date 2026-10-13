import { AUDIT_ACTIONS } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { useScheduleDb } from './schedule.db-harness.js';
import {
  SCHEDULE_LEASE_MS,
  SCHEDULE_MAX_ATTEMPTS,
  SCHEDULE_RETRY_DELAY_S,
} from './schedule.delivery.js';

describe('ScheduleService delivery against Postgres', () => {
  const db = useScheduleDb();
  const {
    delivered,
    attemptsAt,
    failures,
    channelGuild,
    unsendable,
    sources,
    manage,
    jobs,
    state,
    report,
    canManage,
    fakeUuid,
    newId,
    inOneHour,
    anHourAgo,
    world,
    apiFor,
    rowOf,
    auditRows,
    insertRow,
    schedule,
    registerSource,
  } = db;

  /** Skips the wait a failed send puts on its message, as pg-boss's retry delay would. */
  const waitedOut = (id: string) =>
    db.prisma.scheduledMessage.update({ where: { id }, data: { leaseUntil: null } });

  describe('sending', () => {
    it('lets only one of two workers send, then marks the message sent', async () => {
      const w = world();
      const { id } = await schedule(w);
      let release: () => void = () => undefined;
      state.hold = new Promise<void>((resolve) => {
        release = resolve;
      });

      const first = db.service.handleJob(id);
      await vi.waitFor(async () => expect((await rowOf(id)).status).toBe('SENDING'));
      // The same job again, as a retry would deliver it.
      await expect(db.service.handleJob(id)).resolves.toBe(false);

      release();
      await expect(first).resolves.toBe(true);

      expect(delivered).toHaveLength(1);
      expect(await rowOf(id)).toMatchObject({
        status: 'SENT',
        attempts: 1,
        leaseUntil: null,
        lastError: null,
      });
      const entries = await auditRows(w.guildId, AUDIT_ACTIONS.messageSend);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ ok: true, source: 'SYSTEM', actorDiscordId: null });
      const sentMessageId: unknown = expect.stringMatching(/^message-\d+$/);
      expect(entries[0]?.params).toMatchObject({ scheduleId: id, messageId: sentMessageId });
    });

    it('sends two jobs started at the same moment once', async () => {
      const w = world();
      const { id } = await schedule(w);
      const results = await Promise.all([db.service.handleJob(id), db.service.handleJob(id)]);
      expect(results.filter(Boolean)).toHaveLength(1);
      expect(delivered).toHaveLength(1);
    });

    it('never sends a sent message again', async () => {
      const w = world();
      const { id } = await schedule(w);
      await db.service.handleJob(id);
      await expect(db.service.handleJob(id)).resolves.toBe(false);
      expect(delivered).toHaveLength(1);
    });

    it('sends to the chosen channel with a nonce Discord can de-duplicate on', async () => {
      const w = world();
      const { id } = await schedule(w, 'Hello');
      await db.service.handleJob(id);
      const payload = delivered[0]?.payload;
      expect(delivered[0]?.channelId).toBe(w.channelId);
      expect(payload).toMatchObject({ content: 'Hello', enforceNonce: true });
      expect(String(payload?.['nonce'])).toHaveLength(25);
      expect(String(payload?.['nonce'])).toBe(id.replaceAll('-', '').slice(-25));
    });

    it('ignores a job id that is not a message', async () => {
      await expect(db.service.handleJob('not-a-uuid')).resolves.toBe(false);
      await expect(db.service.handleJob(fakeUuid())).resolves.toBe(false);
    });
  });

  describe('a copy', () => {
    it('sends the source as it is when the time comes, not as it was when scheduled', async () => {
      const w = world();
      const source = registerSource(w, { content: 'First version', files: ['file-a'] });
      await db.service.scheduleCopy(
        w.guildId,
        { channelId: w.channelId, source: source.key, runAt: inOneHour() },
        w.slash,
      );
      source.edit('Second version');
      const row = await db.prisma.scheduledMessage.findFirstOrThrow({
        where: { guild: { discordId: w.guildId } },
      });

      await db.service.handleJob(row.id);
      expect(delivered[0]?.payload).toMatchObject({
        content: 'Second version',
        files: ['file-a'],
      });
      expect((await rowOf(row.id)).status).toBe('SENT');
      const entries = await auditRows(w.guildId, AUDIT_ACTIONS.messageCopy);
      expect(entries).toHaveLength(1);
    });

    it('fails with the reason when the source was deleted', async () => {
      const w = world();
      const source = registerSource(w, { content: 'Soon gone' });
      await db.service.scheduleCopy(
        w.guildId,
        { channelId: w.channelId, source: source.key, runAt: inOneHour() },
        w.slash,
      );
      sources.delete(source.key);
      const row = await db.prisma.scheduledMessage.findFirstOrThrow({
        where: { guild: { discordId: w.guildId } },
      });

      await expect(db.service.handleJob(row.id)).resolves.toBe(true);
      expect(delivered).toEqual([]);
      expect(await rowOf(row.id)).toMatchObject({ status: 'FAILED', lastError: 'SOURCE_GONE' });
      expect(report).toHaveBeenCalledTimes(1);
      // Failing for good is not retried.
      await expect(db.service.handleJob(row.id)).resolves.toBe(false);
      const [entry] = await auditRows(w.guildId, AUDIT_ACTIONS.messageCopy);
      expect(entry).toMatchObject({ ok: false, error: 'SOURCE_GONE' });
    });

    it('fails when the source lost all its text and files', async () => {
      const w = world();
      const source = registerSource(w, { content: 'Something' });
      await db.service.scheduleCopy(
        w.guildId,
        { channelId: w.channelId, source: source.key, runAt: inOneHour() },
        w.slash,
      );
      source.edit('');
      const row = await db.prisma.scheduledMessage.findFirstOrThrow({
        where: { guild: { discordId: w.guildId } },
      });
      await db.service.handleJob(row.id);
      expect(await rowOf(row.id)).toMatchObject({ status: 'FAILED', lastError: 'SOURCE_EMPTY' });
    });

    it('refuses, for an API key, a source that is not from the same server', async () => {
      const w = world();
      const source = registerSource(w, { content: 'Elsewhere' });
      const row = await insertRow(w.guildId, w.channelId, w.userId, {
        kind: 'COPY',
        sourceChannelId: source.channelId,
        sourceMessageId: source.messageId,
        source: 'HTTP',
      });
      sources.set(source.key, {
        status: 'OK',
        message: {
          id: source.messageId,
          channelId: source.channelId,
          guildId: newId('guild'),
          content: 'Elsewhere',
          attachments: { values: () => [] },
        },
      });
      await db.service.handleJob(row.id);
      expect(delivered).toEqual([]);
      expect(await rowOf(row.id)).toMatchObject({ status: 'FAILED', lastError: 'GUILD_MISMATCH' });
    });
  });

  describe('when sending goes wrong', () => {
    it.each([
      [50013, 'NO_PERMISSION'],
      [10003, 'CHANNEL_GONE'],
      [50001, 'CHANNEL_GONE'],
      [50035, 'SEND_REJECTED'],
    ])('gives up at once on Discord error %i', async (code, reason) => {
      const w = world();
      const { id } = await schedule(w);
      failures.set(w.channelId, [Object.assign(new Error('Discord says no'), { code })]);

      await expect(db.service.handleJob(id)).resolves.toBe(true);
      expect(await rowOf(id)).toMatchObject({ status: 'FAILED', lastError: reason, attempts: 1 });
      expect(report).toHaveBeenCalledTimes(1);
      await expect(db.service.handleJob(id)).resolves.toBe(false);
      expect(attemptsAt.get(w.channelId)).toBe(1);
    });

    it('fails a message whose channel is gone or cannot be posted in', async () => {
      const w = world();
      const { id } = await schedule(w);
      unsendable.add(w.channelId);
      await db.service.handleJob(id);
      expect(await rowOf(id)).toMatchObject({ status: 'FAILED', lastError: 'CHANNEL_GONE' });

      const second = await schedule(w);
      channelGuild.delete(w.channelId);
      await db.service.handleJob(second.id);
      expect(await rowOf(second.id)).toMatchObject({ status: 'FAILED', lastError: 'CHANNEL_GONE' });
    });

    it('hands the message back and rethrows on a passing error, so the job runs again', async () => {
      const w = world();
      const { id } = await schedule(w);
      failures.set(w.channelId, [new Error('socket hang up')]);

      await expect(db.service.handleJob(id)).rejects.toThrow('socket hang up');
      const waiting = await rowOf(id);
      expect(waiting).toMatchObject({ status: 'PENDING', attempts: 1, lastError: 'Error' });
      // The retry wait rides on the row, so a sweep cannot send it sooner than the job would.
      const waitMs = (waiting.leaseUntil?.getTime() ?? 0) - Date.now();
      expect(waitMs).toBeGreaterThan((SCHEDULE_RETRY_DELAY_S - 5) * 1000);
      expect(waitMs).toBeLessThanOrEqual(SCHEDULE_RETRY_DELAY_S * 1000);
      await expect(db.service.handleJob(id)).resolves.toBe(false);

      await waitedOut(id);
      await expect(db.service.handleJob(id)).resolves.toBe(true);
      expect(await rowOf(id)).toMatchObject({ status: 'SENT', attempts: 2, lastError: null });
      expect(delivered).toHaveLength(1);
    });

    it('does not let a sweep resend a failed message before its retry wait is over', async () => {
      const w = world();
      const { id } = await schedule(w);
      await db.prisma.scheduledMessage.update({
        where: { id },
        data: { runAt: anHourAgo() },
      });
      failures.set(w.channelId, [new Error('socket hang up')]);
      await expect(db.service.handleJob(id)).rejects.toThrow('socket hang up');

      await db.service.reconcilePending();
      expect(attemptsAt.get(w.channelId)).toBe(1);
      expect((await rowOf(id)).status).toBe('PENDING');

      await waitedOut(id);
      await db.service.reconcilePending();
      expect((await rowOf(id)).status).toBe('SENT');
    });

    it('counts no attempt when the claim itself fails before anything is sent', async () => {
      const w = world();
      const { id } = await schedule(w);
      type ClaimTx = { scheduledMessage: { updateMany(args: object): Promise<unknown> } };
      const real = db.prisma.$transaction.bind(db.prisma) as unknown as (
        fn: (tx: ClaimTx) => Promise<unknown>,
      ) => Promise<unknown>;
      const spy = vi.spyOn(db.prisma, '$transaction').mockImplementationOnce(((
        fn: (tx: unknown) => Promise<unknown>,
      ) =>
        real((tx) =>
          fn({
            scheduledMessage: {
              updateMany: (args: object) => tx.scheduledMessage.updateMany(args),
              findUnique: () => Promise.reject(new Error('read failed')),
            },
          }),
        )) as never);

      await expect(db.service.handleJob(id)).rejects.toThrow('read failed');
      spy.mockRestore();
      expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: 0, leaseUntil: null });
      expect(delivered).toEqual([]);
    });

    it('gives up after the attempts are used, without throwing, and says so', async () => {
      const w = world();
      const { id } = await schedule(w);
      failures.set(
        w.channelId,
        Array.from({ length: SCHEDULE_MAX_ATTEMPTS }, () => new Error('socket hang up')),
      );

      for (let attempt = 1; attempt < SCHEDULE_MAX_ATTEMPTS; attempt += 1) {
        await expect(db.service.handleJob(id)).rejects.toThrow('socket hang up');
        await waitedOut(id);
      }
      await expect(db.service.handleJob(id)).resolves.toBe(true);

      expect(await rowOf(id)).toMatchObject({
        status: 'FAILED',
        lastError: 'GAVE_UP',
        attempts: SCHEDULE_MAX_ATTEMPTS,
      });
      expect(report).toHaveBeenCalledTimes(1);
      await expect(db.service.handleJob(id)).resolves.toBe(false);
    });
  });

  describe('the person who scheduled it', () => {
    it('cancels instead of sending when an API key owner can no longer manage the server', async () => {
      const w = world();
      const { id } = await schedule(w, 'From the API', await apiFor(w));
      manage.set(w.userId, false);

      await expect(db.service.handleJob(id)).resolves.toBe(true);
      expect(delivered).toEqual([]);
      expect(await rowOf(id)).toMatchObject({
        status: 'CANCELED',
        lastError: 'CREATOR_LOST_ACCESS',
      });
      expect(canManage).toHaveBeenCalledWith(w.userId, w.guildId, { fresh: true });
      expect(report).not.toHaveBeenCalled();
      const [entry] = await auditRows(w.guildId, AUDIT_ACTIONS.messageSend);
      expect(entry).toMatchObject({ ok: false, error: 'CREATOR_LOST_ACCESS' });
    });

    it('cancels instead of sending when the key that scheduled it was revoked meanwhile', async () => {
      const w = world();
      const actor = await apiFor(w);
      const keyId = actor.apiKeyId ?? '';
      const { id } = await schedule(w, 'From the API', actor);
      await db.prisma.apiKey.update({
        where: { id: keyId },
        data: { revokedAt: new Date() },
      });

      await expect(db.service.handleJob(id)).resolves.toBe(true);
      expect(delivered).toEqual([]);
      expect(await rowOf(id)).toMatchObject({ status: 'CANCELED', lastError: 'KEY_REVOKED' });
      expect(canManage).not.toHaveBeenCalled();
    });

    it('sends when the owner of an API key still can', async () => {
      const w = world();
      const { id } = await schedule(w, 'From the API', await apiFor(w));
      await db.service.handleJob(id);
      expect(delivered).toHaveLength(1);
      expect(canManage).toHaveBeenCalledTimes(1);
    });

    it('does not ask about a slash command author: Discord already decided who may run it', async () => {
      const w = world();
      const { id } = await schedule(w);
      manage.set(w.userId, false);
      await db.service.handleJob(id);
      expect(delivered).toHaveLength(1);
      expect(canManage).not.toHaveBeenCalled();
    });

    it('retries, instead of canceling, when the permission check itself fails', async () => {
      const w = world();
      const { id } = await schedule(w, 'From the API', await apiFor(w, 'MCP'));
      manage.set(w.userId, new Error('Discord is down'));

      await expect(db.service.handleJob(id)).rejects.toThrow('Discord is down');
      expect(await rowOf(id)).toMatchObject({ status: 'PENDING', attempts: 1 });
      expect(delivered).toEqual([]);

      manage.delete(w.userId);
      await waitedOut(id);
      await db.service.handleJob(id);
      expect((await rowOf(id)).status).toBe('SENT');
    });
  });

  describe('a sender that died, and starting up again', () => {
    it('leaves a message alone while its sender may still be alive', async () => {
      const w = world();
      const row = await insertRow(w.guildId, w.channelId, w.userId, {
        status: 'SENDING',
        attempts: 1,
        leaseUntil: new Date(Date.now() + SCHEDULE_LEASE_MS),
      });
      await expect(db.service.handleJob(row.id)).resolves.toBe(false);
      expect(delivered).toEqual([]);
    });

    it('sends exactly once, after the lease lapsed, when the sender died before sending', async () => {
      const w = world();
      const row = await insertRow(w.guildId, w.channelId, w.userId, {
        status: 'SENDING',
        attempts: 1,
        leaseUntil: new Date(Date.now() - 1000),
      });
      await expect(db.service.handleJob(row.id)).resolves.toBe(true);
      await expect(db.service.handleJob(row.id)).resolves.toBe(false);
      expect(delivered).toHaveLength(1);
      expect(await rowOf(row.id)).toMatchObject({ status: 'SENT', attempts: 2 });
    });

    it('repeats a message at most once when the sender died after sending and before recording it', async () => {
      const w = world();
      const { id } = await schedule(w);
      // The record of "sent" fails, as it would if the process died right there.
      const spy = vi.spyOn(db.audit, 'record').mockRejectedValueOnce(new Error('process died'));

      await expect(db.service.handleJob(id)).rejects.toThrow('process died');
      spy.mockRestore();
      expect(delivered).toHaveLength(1);
      const stuck = await rowOf(id);
      expect(stuck.status).toBe('SENDING');
      // Nobody takes it over while the lease is live.
      await expect(db.service.handleJob(id)).resolves.toBe(false);

      await db.prisma.scheduledMessage.update({
        where: { id },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      });
      await expect(db.service.handleJob(id)).resolves.toBe(true);

      expect(delivered).toHaveLength(2);
      // Both posts carry the same nonce, which is what lets Discord drop the second one within its window.
      expect(delivered[1]?.payload['nonce']).toBe(delivered[0]?.payload['nonce']);
      expect((await rowOf(id)).status).toBe('SENT');
      await expect(db.service.handleJob(id)).resolves.toBe(false);
      expect(delivered).toHaveLength(2);
    });

    it('stops a stalled sender from recording over the worker that took its message', async () => {
      const w = world();
      const { id } = await schedule(w);
      let release: () => void = () => undefined;
      state.hold = new Promise<void>((resolve) => {
        release = resolve;
      });

      const stalled = db.service.handleJob(id);
      await vi.waitFor(async () => expect((await rowOf(id)).status).toBe('SENDING'));
      await db.prisma.scheduledMessage.update({
        where: { id },
        data: { leaseUntil: new Date(Date.now() - 1000) },
      });

      await expect(db.service.handleJob(id)).resolves.toBe(true);
      expect(await rowOf(id)).toMatchObject({ status: 'SENT', attempts: 2 });

      release();
      await expect(stalled).resolves.toBe(true);

      // The stalled worker's write found a lease that was no longer its own.
      expect(await rowOf(id)).toMatchObject({ status: 'SENT', attempts: 2 });
      expect(await auditRows(w.guildId, AUDIT_ACTIONS.messageSend)).toHaveLength(1);
    });

    it('on start-up sends what is overdue once, queues what has no job, and takes over a dead sender', async () => {
      const w = world();
      const overdue = await insertRow(w.guildId, w.channelId, w.userId, { runAt: anHourAgo() });
      const dead = await insertRow(w.guildId, w.channelId, w.userId, {
        status: 'SENDING',
        attempts: 1,
        runAt: anHourAgo(),
        leaseUntil: new Date(Date.now() - 1000),
      });
      const alive = await insertRow(w.guildId, w.channelId, w.userId, {
        status: 'SENDING',
        attempts: 1,
        runAt: anHourAgo(),
        leaseUntil: new Date(Date.now() + SCHEDULE_LEASE_MS),
      });
      const justDue = await insertRow(w.guildId, w.channelId, w.userId, {
        runAt: new Date(Date.now() - 1000),
      });
      const canceled = await insertRow(w.guildId, w.channelId, w.userId, {
        status: 'CANCELED',
        runAt: anHourAgo(),
      });
      const future = await insertRow(w.guildId, w.channelId, w.userId, { runAt: inOneHour() });
      const queued = await insertRow(w.guildId, w.channelId, w.userId, {
        runAt: inOneHour(),
        pgBossJobId: fakeUuid(),
      });

      const summary = await db.service.reconcilePending();

      expect(summary.handled).toBeGreaterThanOrEqual(2);
      expect(summary.enqueued).toBeGreaterThanOrEqual(1);
      expect((await rowOf(overdue.id)).status).toBe('SENT');
      expect((await rowOf(dead.id)).status).toBe('SENT');
      expect((await rowOf(alive.id)).status).toBe('SENDING');
      // A job that is about to fire is left to pg-boss.
      expect((await rowOf(justDue.id)).status).toBe('PENDING');
      expect((await rowOf(canceled.id)).status).toBe('CANCELED');
      expect(delivered.filter((d) => d.channelId === w.channelId)).toHaveLength(2);

      expect(jobs.get(future.id)?.startAfter).toEqual(future.runAt);
      expect((await rowOf(future.id)).pgBossJobId).toBe(future.id);
      expect(jobs.has(queued.id)).toBe(false);
      expect((await rowOf(queued.id)).pgBossJobId).toBe(queued.pgBossJobId);

      // Running it again changes nothing.
      const sentBefore = delivered.length;
      await db.service.reconcilePending();
      expect(delivered).toHaveLength(sentBefore);
    });

    it('counts a message as overdue at once when the grace is zero', async () => {
      const w = world();
      const row = await insertRow(w.guildId, w.channelId, w.userId, {
        runAt: new Date(Date.now() - 1000),
      });
      await db.service.reconcilePending(0);
      expect((await rowOf(row.id)).status).toBe('SENT');
    });

    it('does not send an overdue message of an API key whose owner lost the server', async () => {
      const w = world();
      const row = await insertRow(w.guildId, w.channelId, w.userId, {
        runAt: anHourAgo(),
        source: 'MCP',
      });
      manage.set(w.userId, false);
      await db.service.reconcilePending();
      expect(await rowOf(row.id)).toMatchObject({
        status: 'CANCELED',
        lastError: 'CREATOR_LOST_ACCESS',
      });
      expect(delivered.filter((d) => d.channelId === w.channelId)).toEqual([]);
    });
  });
});
