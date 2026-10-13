import { ALLOWED_MENTIONS_ALL, AUDIT_ACTIONS, type ActorContext } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { useScheduleDb } from './schedule.db-harness.js';

describe('ScheduleService against Postgres', () => {
  const db = useScheduleDb();
  const {
    delivered,
    jobs,
    cancelledJobs,
    sendOptions,
    state,
    inOneHour,
    world,
    mintKey,
    apiFor,
    rowOf,
    auditRows,
    insertRow,
    schedule,
    registerSource,
  } = db;

  describe('creating', () => {
    it('stores the row and queues a job with the same id, due at the chosen moment', async () => {
      const w = world();
      const runAt = inOneHour();
      const result = await db.service.scheduleSend(
        w.guildId,
        { channelId: w.channelId, content: 'Hello', runAt },
        w.slash,
      );

      expect(result.dryRun).toBe(false);
      expect(result.schedule).toMatchObject({
        seq: 1,
        kind: 'SEND',
        status: 'PENDING',
        content: 'Hello',
        channelId: w.channelId,
        createdByUserId: w.userId,
        source: 'DISCORD',
        attempts: 0,
      });
      const row = await db.prisma.scheduledMessage.findFirstOrThrow({
        where: { guild: { discordId: w.guildId } },
      });
      expect(row.runAt).toEqual(runAt);
      expect(row.pgBossJobId).toBe(row.id);
      expect(jobs.get(row.id)).toEqual({ data: { scheduleId: row.id }, startAfter: runAt });

      const [entry, ...rest] = await auditRows(w.guildId, AUDIT_ACTIONS.scheduleCreate);
      expect(rest).toEqual([]);
      expect(entry).toMatchObject({ ok: true, actorDiscordId: w.userId, source: 'DISCORD' });
      expect(entry?.params).toMatchObject({ scheduleId: row.id, channelId: w.channelId });
    });

    it('queues the job with a retry wait that grows, so three attempts span minutes', async () => {
      const w = world();
      const { id } = await schedule(w);
      expect(sendOptions.get(id)).toMatchObject({
        retryLimit: 2,
        retryDelay: 30,
        retryBackoff: true,
      });
    });

    it('files a message for a channel of another server under the server of the command', async () => {
      const w = world();
      const elsewhere = world();
      const { id } = await db.service
        .scheduleSend(
          w.guildId,
          { channelId: elsewhere.channelId, content: 'Over there', runAt: inOneHour() },
          w.slash,
        )
        .then((result) => ({ id: result.schedule?.id ?? '' }));

      expect(await db.service.list(w.guildId, { status: 'PENDING' })).toMatchObject([
        { id, seq: 1, channelId: elsewhere.channelId },
      ]);
      expect(await db.service.list(elsewhere.guildId)).toEqual([]);
      await expect(db.service.cancel(w.guildId, 1, w.slash)).resolves.toMatchObject({
        code: 'CANCELED',
      });
      await expect(
        db.service.scheduleSend(
          w.guildId,
          { channelId: elsewhere.channelId, content: 'Nope', runAt: inOneHour() },
          await apiFor(w),
        ),
      ).rejects.toMatchObject({ code: 'DISCORD_CHANNEL_NOT_FOUND' });
    });

    it('numbers the messages of each server from 1, and concurrent ones get different numbers', async () => {
      const first = world();
      const second = world();
      const results = await Promise.all(Array.from({ length: 6 }, () => schedule(first)));
      const seqs = results.map(({ result }) => result.schedule?.seq).sort();
      expect(seqs).toEqual([1, 2, 3, 4, 5, 6]);
      expect((await schedule(second)).result.schedule?.seq).toBe(1);
    });

    it('keeps the row, and reports success, when the queue is down; reconcile queues it later', async () => {
      const w = world();
      state.queueDown = true;
      const { result, id } = await schedule(w);
      expect(result.schedule).not.toBeNull();
      expect((await rowOf(id)).pgBossJobId).toBeNull();
      expect(jobs.size).toBe(0);

      state.queueDown = false;
      const summary = await db.service.reconcilePending();
      expect(summary.enqueued).toBeGreaterThanOrEqual(1);
      expect(jobs.has(id)).toBe(true);
      expect((await rowOf(id)).pgBossJobId).toBe(id);
    });

    it('with dryRun leaves no row, job or audit entry', async () => {
      const w = world();
      const result = await db.service.scheduleSend(
        w.guildId,
        { channelId: w.channelId, content: 'Preview', runAt: inOneHour() },
        w.slash,
        { dryRun: true },
      );
      expect(result.schedule).toBeNull();
      expect(
        await db.prisma.scheduledMessage.count({ where: { guild: { discordId: w.guildId } } }),
      ).toBe(0);
      expect(jobs.size).toBe(0);
      expect(await auditRows(w.guildId, AUDIT_ACTIONS.scheduleCreate)).toEqual([]);
    });

    it('records the person and the API key that scheduled it', async () => {
      const w = world();
      const api = await apiFor(w);
      const { id } = await schedule(w, 'From the API', api);
      expect(await rowOf(id)).toMatchObject({
        source: 'HTTP',
        createdByUserId: w.userId,
        apiKeyId: api.apiKeyId,
      });
    });

    it('stores what a copy needs and reads the source only when the time comes', async () => {
      const w = world();
      const source = registerSource(w, { content: 'First version' });
      const result = await db.service.scheduleCopy(
        w.guildId,
        { channelId: w.channelId, source: source.key, runAt: inOneHour() },
        w.slash,
      );
      expect(result.schedule).toMatchObject({
        kind: 'COPY',
        content: null,
        sourceChannelId: source.channelId,
        sourceMessageId: source.messageId,
      });
    });
  });

  describe('mentions', () => {
    it('stores no mentions for an API key and applies that when it is sent', async () => {
      const w = world();
      const { id } = await schedule(w, '@everyone <@&123456789012345678> hello', await apiFor(w));
      expect((await rowOf(id)).allowedMentions).toEqual({ parse: [] });

      await db.service.handleJob(id);
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.payload['allowedMentions']).toEqual({ parse: [] });
      expect(delivered[0]?.payload['content']).toBe('@everyone <@&123456789012345678> hello');
    });

    it('keeps the old behaviour for a slash command', async () => {
      const w = world();
      const { id } = await schedule(w, '@everyone hello');
      expect((await rowOf(id)).allowedMentions).toEqual(ALLOWED_MENTIONS_ALL);

      await db.service.handleJob(id);
      expect(delivered[0]?.payload['allowedMentions']).toEqual(ALLOWED_MENTIONS_ALL);
    });

    it('sends without mentions when the stored policy is unreadable', async () => {
      const w = world();
      const row = await insertRow(w.guildId, w.channelId, w.userId, {
        allowedMentions: { parse: 'everyone' },
      });
      await db.service.handleJob(row.id);
      expect(delivered[0]?.payload['allowedMentions']).toEqual({ parse: [] });
    });
  });

  describe('canceling', () => {
    it('cancels once, drops the job, and answers "already canceled" the second time', async () => {
      const w = world();
      const { id } = await schedule(w);

      const first = await db.service.cancel(w.guildId, 1, w.slash);
      expect(first).toEqual({ dryRun: false, code: 'CANCELED', seq: 1, status: 'CANCELED' });
      expect((await rowOf(id)).status).toBe('CANCELED');
      expect(cancelledJobs.has(id)).toBe(true);

      const second = await db.service.cancel(w.guildId, 1, w.slash);
      expect(second).toMatchObject({ code: 'ALREADY_CANCELED', status: 'CANCELED' });
      expect(await auditRows(w.guildId, AUDIT_ACTIONS.scheduleCancel)).toHaveLength(1);
    });

    it('does not send a message that was canceled, even if its job still fires', async () => {
      const w = world();
      const { id } = await schedule(w);
      await db.service.cancel(w.guildId, 1, w.slash);
      await expect(db.service.handleJob(id)).resolves.toBe(false);
      expect(delivered).toEqual([]);
    });

    it('with dryRun changes nothing', async () => {
      const w = world();
      const { id } = await schedule(w);
      const plan = await db.service.cancel(w.guildId, 1, w.slash, { dryRun: true });
      expect(plan).toMatchObject({ dryRun: true, code: 'CANCELED' });
      expect((await rowOf(id)).status).toBe('PENDING');
      expect(cancelledJobs.size).toBe(0);
      expect(await auditRows(w.guildId, AUDIT_ACTIONS.scheduleCancel)).toEqual([]);
    });

    it('does not find a number that belongs to another server', async () => {
      const mine = world();
      const theirs = world();
      await schedule(theirs);
      await expect(db.service.cancel(mine.guildId, 1, mine.slash)).resolves.toMatchObject({
        code: 'NOT_FOUND',
        status: null,
      });
      expect(
        (
          await db.prisma.scheduledMessage.findFirstOrThrow({
            where: { guild: { discordId: theirs.guildId } },
          })
        ).status,
      ).toBe('PENDING');
    });

    it('refuses to cancel a message that is being sent, and lets the send finish', async () => {
      const w = world();
      const { id } = await schedule(w);
      let release: () => void = () => undefined;
      state.hold = new Promise<void>((resolve) => {
        release = resolve;
      });

      const sending = db.service.handleJob(id);
      await vi.waitFor(async () => expect((await rowOf(id)).status).toBe('SENDING'));
      await expect(db.service.cancel(w.guildId, 1, w.slash)).resolves.toMatchObject({
        code: 'NOT_PENDING',
        status: 'SENDING',
      });

      release();
      await sending;
      expect((await rowOf(id)).status).toBe('SENT');
    });

    it('cancels what a revoked key scheduled, in every server, and nothing else', async () => {
      const a = world();
      const b = world();
      const keyId = await mintKey(a.userId);
      const keyIn = (w: ReturnType<typeof world>): ActorContext => ({
        source: 'MCP',
        userId: w.userId,
        apiKeyId: keyId,
      });
      const otherKey: ActorContext = {
        source: 'HTTP',
        userId: a.userId,
        apiKeyId: await mintKey(a.userId),
      };

      const mineInA = (await schedule(a, 'one', keyIn(a))).id;
      const mineInB = (await schedule(b, 'two', keyIn(b))).id;
      const sentAlready = (await schedule(a, 'three', keyIn(a))).id;
      await db.service.handleJob(sentAlready);
      const theirs = (await schedule(a, 'four', otherKey)).id;
      const slash = (await schedule(a, 'five')).id;

      const revoker: ActorContext = { source: 'DISCORD', userId: a.userId };
      await expect(db.service.cancelByApiKey(keyId, revoker)).resolves.toEqual({ count: 2 });

      expect(await rowOf(mineInA)).toMatchObject({ status: 'CANCELED', lastError: 'KEY_REVOKED' });
      expect(await rowOf(mineInB)).toMatchObject({ status: 'CANCELED', lastError: 'KEY_REVOKED' });
      expect((await rowOf(sentAlready)).status).toBe('SENT');
      expect((await rowOf(theirs)).status).toBe('PENDING');
      expect((await rowOf(slash)).status).toBe('PENDING');
      expect(cancelledJobs.has(mineInA)).toBe(true);
      expect(cancelledJobs.has(mineInB)).toBe(true);
      expect(cancelledJobs.has(theirs)).toBe(false);

      // One audit entry per server it touched, naming whoever revoked.
      const entries = await auditRows(a.guildId, AUDIT_ACTIONS.scheduleCancel);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorDiscordId: a.userId, params: { count: 1 } });

      await expect(db.service.cancelByApiKey(keyId, revoker)).resolves.toEqual({ count: 0 });
    });
  });

  describe('listing and suggestions', () => {
    it('lists the newest messages oldest first, with the public fields only', async () => {
      const w = world();
      for (let i = 1; i <= 5; i += 1) await schedule(w, `message ${i}`);
      await db.service.cancel(w.guildId, 2, w.slash);

      const all = await db.service.list(w.guildId);
      expect(all.map((view) => view.seq)).toEqual([1, 2, 3, 4, 5]);
      expect(all[1]?.status).toBe('CANCELED');
      expect(Object.keys(all[0] ?? {}).sort()).toEqual(
        [
          'allowedMentions',
          'attempts',
          'channelId',
          'content',
          'createdAt',
          'createdByUserId',
          'id',
          'kind',
          'lastError',
          'runAt',
          'seq',
          'source',
          'sourceChannelId',
          'sourceMessageId',
          'status',
        ].sort(),
      );
      expect((await db.service.list(w.guildId, { limit: 2 })).map((view) => view.seq)).toEqual([
        4, 5,
      ]);
      expect(
        (await db.service.list(w.guildId, { status: 'CANCELED' })).map((view) => view.seq),
      ).toEqual([2]);
    });

    it('suggests pending messages soonest first, narrowed to the numbers that start with the typed digits', async () => {
      const w = world();
      const other = world();
      const start = Date.now() + 3_600_000;
      for (let seq = 1; seq <= 30; seq += 1) {
        // The later the number, the sooner the time, so the order is not the number's.
        await insertRow(w.guildId, w.channelId, w.userId, {
          runAt: new Date(start + (31 - seq) * 60_000),
        });
      }
      await insertRow(other.guildId, other.channelId, other.userId);
      await db.service.cancel(w.guildId, 12, w.slash);
      await db.prisma.scheduledMessage.updateMany({
        where: { guild: { discordId: w.guildId }, seq: 13 },
        data: { status: 'SENT' },
      });

      const everything = await db.service.autocompletePending(w.guildId, '');
      expect(everything).toHaveLength(25);
      expect(everything[0]?.seq).toBe(30);
      expect(everything.map((choice) => choice.seq)).not.toContain(12);
      expect(everything.map((choice) => choice.seq)).not.toContain(13);

      const ones = (await db.service.autocompletePending(w.guildId, '1')).map(
        (choice) => choice.seq,
      );
      expect(ones.sort((a, b) => a - b)).toEqual([1, 10, 11, 14, 15, 16, 17, 18, 19]);
      const twos = (await db.service.autocompletePending(w.guildId, ' 2 ')).map(
        (choice) => choice.seq,
      );
      expect(twos.sort((a, b) => a - b)).toEqual([2, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
      expect(await db.service.autocompletePending(w.guildId, '12')).toEqual([]);
      expect((await db.service.autocompletePending(w.guildId, '30')).map((c) => c.seq)).toEqual([
        30,
      ]);
      for (const typed of ['0', '01', 'abc', '3x']) {
        expect(await db.service.autocompletePending(w.guildId, typed), typed).toEqual([]);
      }
    });
  });
});
