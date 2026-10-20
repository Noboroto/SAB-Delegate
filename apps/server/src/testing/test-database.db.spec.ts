import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../../../../vitest-test-database.mjs';
import { createPool } from '../prisma/pool-factory.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';

// Postgres reports a violated CHECK as SQLSTATE 23514; Prisma has no dedicated
// error code for it, so the code or the server's own wording is what identifies it.
const CHECK_VIOLATION = /23514|violates check constraint/;

const DAY = 24 * 60 * 60 * 1000;
const SNOWFLAKE = '123456789012345678';

describe('test database harness', () => {
  it('gives every call its own schema and drops it on dispose', async () => {
    const server = requireDatabaseUrl();
    const first = await createTestDatabase(server);
    const second = await createTestDatabase(server);
    try {
      expect(first.schema).toMatch(/^t_[0-9a-f]{12}$/);
      expect(second.schema).not.toBe(first.schema);

      await first.prisma.appState.create({ data: { key: 'only-in-first', value: 'x' } });
      await expect(first.prisma.appState.count()).resolves.toBe(1);
      await expect(second.prisma.appState.count()).resolves.toBe(0);
    } finally {
      await first.dispose();
      await second.dispose();
    }

    const url = new URL(server.url);
    url.searchParams.delete('schema');
    const probe = createPool(url.toString(), 1);
    try {
      const remaining = await probe.query(
        'SELECT 1 FROM information_schema.schemata WHERE schema_name = ANY($1)',
        [[first.schema, second.schema]],
      );
      expect(remaining.rowCount).toBe(0);
    } finally {
      await probe.end();
    }
    await expect(first.dispose()).resolves.toBeUndefined();
  });
});

describe('schema and migrations', () => {
  let database: TestDatabase;

  let guildCounter = 0;
  const newGuild = async (): Promise<string> => {
    guildCounter += 1;
    const discordId = `9${String(guildCounter).padStart(17, '0')}`;
    return (await database.prisma.guild.create({ data: { discordId } })).id;
  };

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('generates primary keys in Postgres, ordered by creation', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 5; index++) {
      ids.push(await newGuild());
      // uuidv7 orders by millisecond; two backends inside one millisecond are
      // not ordered against each other.
      await sleep(3);
    }
    expect(new Set(ids).size).toBe(5);
    expect(ids).toEqual([...ids].sort());
  });

  it('stores a timestamptz as the same instant whatever the process time zone is', async () => {
    const instant = new Date('2026-10-13T00:30:00.000Z');
    const guild = await database.prisma.guild.create({
      data: { discordId: '200000000000000000', createdAt: instant },
    });
    const rows = await database.prisma.$queryRaw<Array<{ utc: string }>>`
      SELECT to_char("createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS utc
      FROM "Guild" WHERE id = ${guild.id}::uuid`;
    expect(rows[0]?.utc).toBe('2026-10-13T00:30:00.000Z');
    const read = await database.prisma.guild.findUniqueOrThrow({ where: { id: guild.id } });
    expect(read.createdAt.getTime()).toBe(instant.getTime());
  });

  it.each(['UTC', 'Asia/Ho_Chi_Minh'])(
    'keeps one absolute instant for a session in %s, written by either side',
    async (zone) => {
      const server = requireDatabaseUrl();
      const url = new URL(server.url);
      url.searchParams.delete('schema');
      const session = createPool(
        url.toString(),
        1,
        `-c timezone=${zone} -c search_path=${database.schema}`,
      );
      try {
        const instant = new Date('2026-10-13T00:30:00.000Z');
        const discordId = `8${zone.length}0000000000000001`;
        const written = await database.prisma.guild.create({
          data: { discordId, createdAt: instant },
        });

        const seen = await session.query<{ ms: string }>(
          'SELECT (extract(epoch FROM "createdAt") * 1000)::bigint AS ms FROM "Guild" WHERE id = $1',
          [written.id],
        );
        expect(Number(seen.rows[0]?.ms)).toBe(instant.getTime());

        // The same instant spelled in another offset, written by the session.
        const viaSession = await session.query<{ id: string }>(
          `INSERT INTO "Guild" ("discordId", "createdAt", "updatedAt")
           VALUES ($1, '2026-10-13T07:30:00+07:00', now()) RETURNING id`,
          [`${discordId.slice(0, -1)}2`],
        );
        const read = await database.prisma.guild.findUniqueOrThrow({
          where: { id: viaSession.rows[0]?.id ?? '' },
        });
        expect(read.createdAt.getTime()).toBe(instant.getTime());
      } finally {
        await session.end();
      }
    },
  );

  it('rejects a duplicate natural key', async () => {
    const guildId = await newGuild();
    const base = { guildId, name: 'A', discordId: SNOWFLAKE, month: 5, day: 5 };
    await database.prisma.birthdayEntry.create({ data: { ...base, studentId: 'S1' } });
    await expect(
      database.prisma.birthdayEntry.create({ data: { ...base, studentId: 'S1' } }),
    ).rejects.toMatchObject({ code: 'P2002' });

    await database.prisma.birthdayCompletedDate.create({
      data: { guildId, date: new Date('2026-10-13'), status: 'DONE' },
    });
    await expect(
      database.prisma.birthdayCompletedDate.create({
        data: { guildId, date: new Date('2026-10-13'), status: 'DONE' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });

    const state = await database.prisma.wordGameState.create({ data: { guildId } });
    await database.prisma.wordGameUsedWord.create({ data: { stateId: state.id, word: 'xin' } });
    await expect(
      database.prisma.wordGameUsedWord.create({ data: { stateId: state.id, word: 'xin' } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  describe('unique keys', () => {
    const duplicate = async (create: () => Promise<unknown>) => {
      await create();
      await expect(create()).rejects.toMatchObject({ code: 'P2002' });
    };
    const tick = { channelId: SNOWFLAKE, source: 'DISCORD' as const, createdByUserId: SNOWFLAKE };

    it('Guild.discordId', async () => {
      await duplicate(() =>
        database.prisma.guild.create({ data: { discordId: '910000000000000001' } }),
      );
    });

    it('ApiKey.keyHash', async () => {
      await duplicate(() =>
        database.prisma.apiKey.create({
          data: {
            discordUserId: SNOWFLAKE,
            name: 'k',
            keyHash: 'dup-hash',
            prefix: 'aaaa0000',
            mode: 'READ',
          },
        }),
      );
    });

    it('ScheduledMessage (guildId, seq)', async () => {
      const guildId = await newGuild();
      await duplicate(() =>
        database.prisma.scheduledMessage.create({
          data: {
            ...tick,
            guildId,
            seq: 1,
            kind: 'SEND',
            content: 'hi',
            runAt: new Date(Date.now() + DAY),
          },
        }),
      );
    });

    it('ScheduledMessage.pgBossJobId', async () => {
      const guildId = await newGuild();
      const jobId = '0198a000-0000-7000-8000-000000000001';
      let seq = 0;
      await duplicate(() => {
        seq += 1;
        return database.prisma.scheduledMessage.create({
          data: {
            ...tick,
            guildId,
            seq,
            kind: 'SEND',
            content: 'hi',
            runAt: new Date(Date.now() + DAY),
            pgBossJobId: jobId,
          },
        });
      });
    });

    it('NoteEntry (guildId, roleId, topic)', async () => {
      const guildId = await newGuild();
      await duplicate(() =>
        database.prisma.noteEntry.create({
          data: { guildId, roleId: SNOWFLAKE, topic: 't', content: 'c' },
        }),
      );
    });

    it('BirthdayWishUsage (guildId, wishIndex)', async () => {
      const guildId = await newGuild();
      await duplicate(() =>
        database.prisma.birthdayWishUsage.create({ data: { guildId, wishIndex: 3 } }),
      );
    });

    it('GuildConfig.guildId', async () => {
      const guildId = await newGuild();
      await duplicate(() => database.prisma.guildConfig.create({ data: { guildId } }));
    });

    it('WordGameState.guildId', async () => {
      const guildId = await newGuild();
      await duplicate(() => database.prisma.wordGameState.create({ data: { guildId } }));
    });
  });

  describe('negative counters and snowflake columns', () => {
    it('rejects a negative WordGameState.count', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.wordGameState.create({ data: { guildId, count: -1 } }),
      ).rejects.toThrow(CHECK_VIOLATION);
    });

    it('rejects negative ScheduledMessage.attempts', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.scheduledMessage.create({
          data: {
            guildId,
            seq: 1,
            kind: 'SEND',
            content: 'hi',
            channelId: SNOWFLAKE,
            runAt: new Date(Date.now() + DAY),
            source: 'DISCORD',
            createdByUserId: SNOWFLAKE,
            attempts: -1,
          },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
    });

    it.each([
      'introChannelId',
      'logChannelId',
      'birthdayChannelId',
      'activityCategoryId',
      'wordChannelId',
    ] as const)('GuildConfig.%s must be NULL or 17-20 digits', async (column) => {
      for (const bad of [
        '',
        '<#123456789012345678>',
        '1234567890123456',
        '123456789012345678901',
      ]) {
        const guildId = await newGuild();
        await expect(
          database.prisma.guildConfig.create({ data: { guildId, [column]: bad } }),
        ).rejects.toThrow(CHECK_VIOLATION);
      }
      for (const good of [null, '12345678901234567', '12345678901234567890']) {
        const guildId = await newGuild();
        await expect(
          database.prisma.guildConfig.create({ data: { guildId, [column]: good } }),
        ).resolves.toMatchObject({ [column]: good });
      }
    });
  });

  describe('birthday calendar', () => {
    const entry = (guildId: string, month: number, day: number) =>
      database.prisma.birthdayEntry.create({
        data: {
          guildId,
          studentId: `S-${month}-${day}`,
          name: 'N',
          discordId: SNOWFLAKE,
          month,
          day,
        },
      });

    it.each([
      [13, 1],
      [0, 1],
      [2, 30],
      [2, 31],
      [4, 31],
      [6, 31],
      [9, 31],
      [11, 31],
      [1, 32],
      [1, 0],
    ])('rejects %i/%i', async (month, day) => {
      const guildId = await newGuild();
      await expect(entry(guildId, month, day)).rejects.toThrow(CHECK_VIOLATION);
    });

    it.each([
      [2, 29],
      [1, 31],
      [4, 30],
      [12, 31],
    ])('accepts %i/%i', async (month, day) => {
      const guildId = await newGuild();
      await expect(entry(guildId, month, day)).resolves.toMatchObject({ month, day });
    });
  });

  describe('other CHECKs', () => {
    it('rejects an unsupported locale', async () => {
      await expect(
        database.prisma.guild.create({ data: { discordId: '600000000000000000', locale: 'fr' } }),
      ).rejects.toThrow(CHECK_VIOLATION);
    });

    it('rejects a word limit under 200 and a channel that is not a snowflake', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.guildConfig.create({ data: { guildId, wordMaxWords: 100 } }),
      ).rejects.toThrow(CHECK_VIOLATION);

      const other = await newGuild();
      await expect(
        database.prisma.guildConfig.create({ data: { guildId: other, logChannelId: '<#123>' } }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.guildConfig.create({ data: { guildId: other, logChannelId: SNOWFLAKE } }),
      ).resolves.toMatchObject({ wordMaxWords: 3000 });
    });

    it('requires a lease on every SENDING birthday run', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.birthdayCompletedDate.create({
          data: { guildId, date: new Date('2026-10-14'), status: 'SENDING' },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.birthdayCompletedDate.create({
          data: {
            guildId,
            date: new Date('2026-10-14'),
            status: 'SENDING',
            leaseUntil: new Date(Date.now() + 60_000),
          },
        }),
      ).resolves.toMatchObject({ sentDiscordIds: [] });
    });

    it('rejects empty notes, upper-case words and a negative wish index', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.noteEntry.create({
          data: { guildId, roleId: SNOWFLAKE, topic: '', content: 'c' },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.noteEntry.create({
          data: { guildId, roleId: SNOWFLAKE, topic: 't', content: '' },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);

      const state = await database.prisma.wordGameState.create({ data: { guildId } });
      await expect(
        database.prisma.wordGameUsedWord.create({ data: { stateId: state.id, word: 'Xin' } }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.birthdayWishUsage.create({ data: { guildId, wishIndex: -1 } }),
      ).rejects.toThrow(CHECK_VIOLATION);
    });

    it('rejects an empty AppState key', async () => {
      await expect(
        database.prisma.appState.create({ data: { key: '', value: 'v' } }),
      ).rejects.toThrow(CHECK_VIOLATION);
    });
  });

  describe('scheduled messages', () => {
    const base = (guildId: string, seq: number) => ({
      guildId,
      seq,
      channelId: SNOWFLAKE,
      runAt: new Date(Date.now() + DAY),
      source: 'DISCORD' as const,
      createdByUserId: SNOWFLAKE,
    });

    it('requires the fields its kind needs', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.scheduledMessage.create({ data: { ...base(guildId, 1), kind: 'SEND' } }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.scheduledMessage.create({
          data: { ...base(guildId, 1), kind: 'SEND', content: 'hi', sourceMessageId: SNOWFLAKE },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.scheduledMessage.create({ data: { ...base(guildId, 1), kind: 'COPY' } }),
      ).rejects.toThrow(CHECK_VIOLATION);

      const send = await database.prisma.scheduledMessage.create({
        data: { ...base(guildId, 1), kind: 'SEND', content: 'hi' },
      });
      expect(send.allowedMentions).toEqual({ parse: [] });
      await expect(
        database.prisma.scheduledMessage.create({
          data: {
            ...base(guildId, 2),
            kind: 'COPY',
            sourceChannelId: SNOWFLAKE,
            sourceMessageId: SNOWFLAKE,
          },
        }),
      ).resolves.toMatchObject({ kind: 'COPY' });
    });

    it('rejects seq 0 and a SENDING row without a lease', async () => {
      const guildId = await newGuild();
      await expect(
        database.prisma.scheduledMessage.create({
          data: { ...base(guildId, 0), kind: 'SEND', content: 'hi' },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.scheduledMessage.create({
          data: { ...base(guildId, 1), kind: 'SEND', content: 'hi', status: 'SENDING' },
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.scheduledMessage.create({
          data: {
            ...base(guildId, 1),
            kind: 'SEND',
            content: 'hi',
            status: 'SENDING',
            leaseUntil: new Date(Date.now() + 60_000),
          },
        }),
      ).resolves.toMatchObject({ status: 'SENDING' });
    });
  });

  describe('API keys', () => {
    const createdAt = new Date('2026-10-01T00:00:00.000Z');
    const key = (
      suffix: string,
      extra: { mode: 'READ' | 'WRITE'; expiresAt?: Date; prefix?: string },
    ) => ({
      discordUserId: SNOWFLAKE,
      name: 'ci',
      keyHash: `hash-${suffix}`,
      prefix: extra.prefix ?? 'abcd1234',
      createdAt,
      mode: extra.mode,
      expiresAt: extra.expiresAt ?? null,
    });

    it('lets a WRITE key live at most 30 days and never without an expiry', async () => {
      await expect(
        database.prisma.apiKey.create({
          data: key('w31', { mode: 'WRITE', expiresAt: new Date(createdAt.getTime() + 31 * DAY) }),
        }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.apiKey.create({ data: key('wnull', { mode: 'WRITE' }) }),
      ).rejects.toThrow(CHECK_VIOLATION);
      await expect(
        database.prisma.apiKey.create({
          data: key('w30', { mode: 'WRITE', expiresAt: new Date(createdAt.getTime() + 30 * DAY) }),
        }),
      ).resolves.toMatchObject({ mode: 'WRITE' });
    });

    it('lets a READ key live 90 days or forever', async () => {
      await expect(
        database.prisma.apiKey.create({
          data: key('r90', { mode: 'READ', expiresAt: new Date(createdAt.getTime() + 90 * DAY) }),
        }),
      ).resolves.toMatchObject({ mode: 'READ' });
      await expect(
        database.prisma.apiKey.create({ data: key('rnull', { mode: 'READ' }) }),
      ).resolves.toMatchObject({ expiresAt: null });
    });

    it('requires an 8-character prefix', async () => {
      await expect(
        database.prisma.apiKey.create({ data: key('p7', { mode: 'READ', prefix: 'abcd123' }) }),
      ).rejects.toThrow(CHECK_VIOLATION);
    });
  });

  describe('deleting a guild', () => {
    it('removes every child row, keeps the audit trail and leaves the API key', async () => {
      const guildId = await newGuild();
      const prisma = database.prisma;
      const apiKey = await prisma.apiKey.create({
        data: {
          discordUserId: SNOWFLAKE,
          name: 'k',
          keyHash: 'hash-cascade',
          prefix: 'zzzz9999',
          mode: 'READ',
        },
      });

      await prisma.guildConfig.create({ data: { guildId } });
      await prisma.birthdayEntry.create({
        data: { guildId, studentId: 'S', name: 'N', discordId: SNOWFLAKE, month: 1, day: 1 },
      });
      await prisma.birthdayCompletedDate.create({
        data: { guildId, date: new Date('2026-10-13'), status: 'DONE' },
      });
      await prisma.birthdayWishUsage.create({ data: { guildId, wishIndex: 0 } });
      await prisma.noteEntry.create({
        data: { guildId, roleId: SNOWFLAKE, topic: 't', content: 'c' },
      });
      const state = await prisma.wordGameState.create({ data: { guildId } });
      await prisma.wordGameUsedWord.create({ data: { stateId: state.id, word: 'a' } });
      const scheduled = await prisma.scheduledMessage.create({
        data: {
          guildId,
          seq: 1,
          kind: 'SEND',
          content: 'hi',
          channelId: SNOWFLAKE,
          runAt: new Date(Date.now() + DAY),
          source: 'MCP',
          createdByUserId: SNOWFLAKE,
          apiKeyId: apiKey.id,
        },
      });
      const audit = await prisma.auditLog.create({
        data: { guildId, source: 'SYSTEM', action: 'test', ok: true },
      });

      await prisma.guild.delete({ where: { id: guildId } });

      await expect(prisma.guildConfig.count({ where: { guildId } })).resolves.toBe(0);
      await expect(prisma.birthdayEntry.count({ where: { guildId } })).resolves.toBe(0);
      await expect(prisma.birthdayCompletedDate.count({ where: { guildId } })).resolves.toBe(0);
      await expect(prisma.birthdayWishUsage.count({ where: { guildId } })).resolves.toBe(0);
      await expect(prisma.noteEntry.count({ where: { guildId } })).resolves.toBe(0);
      await expect(prisma.wordGameState.count({ where: { guildId } })).resolves.toBe(0);
      await expect(prisma.wordGameUsedWord.count({ where: { stateId: state.id } })).resolves.toBe(
        0,
      );
      await expect(prisma.scheduledMessage.count({ where: { id: scheduled.id } })).resolves.toBe(0);
      await expect(prisma.apiKey.count({ where: { id: apiKey.id } })).resolves.toBe(1);
      await expect(
        prisma.auditLog.findUniqueOrThrow({ where: { id: audit.id } }),
      ).resolves.toMatchObject({
        guildId: null,
      });
    });

    it('detaches a scheduled message from a deleted API key instead of deleting it', async () => {
      const guildId = await newGuild();
      const apiKey = await database.prisma.apiKey.create({
        data: {
          discordUserId: SNOWFLAKE,
          name: 'k',
          keyHash: 'hash-detach',
          prefix: 'yyyy8888',
          mode: 'READ',
        },
      });
      const scheduled = await database.prisma.scheduledMessage.create({
        data: {
          guildId,
          seq: 1,
          kind: 'SEND',
          content: 'hi',
          channelId: SNOWFLAKE,
          runAt: new Date(Date.now() + DAY),
          source: 'HTTP',
          createdByUserId: SNOWFLAKE,
          apiKeyId: apiKey.id,
        },
      });

      await database.prisma.apiKey.delete({ where: { id: apiKey.id } });

      await expect(
        database.prisma.scheduledMessage.findUniqueOrThrow({ where: { id: scheduled.id } }),
      ).resolves.toMatchObject({ apiKeyId: null });
    });
  });
});
