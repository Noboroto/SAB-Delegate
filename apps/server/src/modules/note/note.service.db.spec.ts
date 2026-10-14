import { AUDIT_ACTIONS, type ActorContext } from '@sab/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { requireDatabaseUrl } from '../../../../../vitest-test-database.mjs';
import { AuditService } from '../../common/audit/audit.service.js';
import type { ChannelAccessService } from '../../discord/services/channel-access.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { NoteService } from './note.service.js';

const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const ROLE = '300000000000000001';
const OTHER_ROLE = '300000000000000002';

describe('NoteService against Postgres', () => {
  let database: TestDatabase;
  let prisma: PrismaService;
  let service: NoteService;
  let nextGuild = 100000000000001000n;

  // Every test works on its own server so none depends on the others' rows.
  const newGuild = () => String((nextGuild += 1n));

  const auditRows = (guildId: string, action: string) =>
    prisma.auditLog.findMany({ where: { guild: { discordId: guildId }, action } });

  beforeAll(async () => {
    database = await createTestDatabase(requireDatabaseUrl());
    prisma = database.prisma as unknown as PrismaService;
    const audit = new AuditService(prisma);
    const access = { check: vi.fn().mockResolvedValue('ok') } as unknown as ChannelAccessService;
    service = new NoteService(prisma, audit, new GuildConfigService(prisma, audit, access));
  });

  afterAll(async () => {
    await database.dispose();
  });

  it('creates the server row for a server the bot has not recorded yet', async () => {
    const guildId = newGuild();
    await service.upsert(guildId, { roleId: ROLE, topic: 'Rules', content: 'Be kind' }, ACTOR);
    await expect(prisma.guild.count({ where: { discordId: guildId } })).resolves.toBe(1);
    await expect(service.listByRole(guildId, ROLE)).resolves.toMatchObject([
      { roleId: ROLE, topic: 'Rules', content: 'Be kind' },
    ]);
  });

  it('replaces the content of a topic that exists and keeps one row', async () => {
    const guildId = newGuild();
    await service.upsert(guildId, { roleId: ROLE, topic: 'Rules', content: 'first' }, ACTOR);
    await service.upsert(guildId, { roleId: ROLE, topic: 'Rules', content: 'second' }, ACTOR);
    const notes = await service.listByRole(guildId, ROLE);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toBe('second');
  });

  it('treats topics that differ in case as different notes', async () => {
    const guildId = newGuild();
    await service.upsert(guildId, { roleId: ROLE, topic: 'Rules', content: 'upper' }, ACTOR);
    await service.upsert(guildId, { roleId: ROLE, topic: 'rules', content: 'lower' }, ACTOR);
    await expect(service.listByRole(guildId, ROLE)).resolves.toHaveLength(2);
    await expect(service.get(guildId, ROLE, 'Rules')).resolves.toMatchObject({ content: 'upper' });
    await expect(service.get(guildId, ROLE, 'rules')).resolves.toMatchObject({ content: 'lower' });
    await expect(service.get(guildId, ROLE, 'RULES')).resolves.toBeNull();
  });

  it('survives the same topic being saved concurrently, the last write winning', async () => {
    const guildId = newGuild();
    await Promise.all(
      Array.from({ length: 8 }, (_, index) =>
        service.upsert(guildId, { roleId: ROLE, topic: 'Race', content: `write ${index}` }, ACTOR),
      ),
    );
    const notes = await service.listByRole(guildId, ROLE);
    expect(notes).toHaveLength(1);
    expect(notes[0]?.content).toMatch(/^write \d$/);
  });

  it('keeps the notes of two servers and two roles apart', async () => {
    const first = newGuild();
    const second = newGuild();
    await service.upsert(first, { roleId: ROLE, topic: 'Same', content: 'first' }, ACTOR);
    await service.upsert(second, { roleId: ROLE, topic: 'Same', content: 'second' }, ACTOR);
    await service.upsert(first, { roleId: OTHER_ROLE, topic: 'Same', content: 'other' }, ACTOR);

    await expect(service.get(first, ROLE, 'Same')).resolves.toMatchObject({ content: 'first' });
    await expect(service.get(second, ROLE, 'Same')).resolves.toMatchObject({ content: 'second' });
    await expect(service.listAll(first)).resolves.toHaveLength(2);
    await expect(service.listAll(second)).resolves.toHaveLength(1);
  });

  it('lists a role in the order the topics were first saved, a replaced topic keeping its place', async () => {
    const guildId = newGuild();
    for (const topic of ['zeta', 'alpha', 'mid']) {
      await service.upsert(guildId, { roleId: ROLE, topic, content: topic }, ACTOR);
    }
    await service.upsert(guildId, { roleId: ROLE, topic: 'zeta', content: 'again' }, ACTOR);
    const notes = await service.listByRole(guildId, ROLE);
    expect(notes.map((note) => note.topic)).toEqual(['zeta', 'alpha', 'mid']);
    expect(notes[0]?.content).toBe('again');
  });

  it('suggests topics of the role only, ignoring case, and treats % and _ literally', async () => {
    const guildId = newGuild();
    for (const topic of ['Quy tắc', 'quy định', '100% done', 'a_b', 'axb']) {
      await service.upsert(guildId, { roleId: ROLE, topic, content: 'x' }, ACTOR);
    }
    await service.upsert(guildId, { roleId: OTHER_ROLE, topic: 'quy khác', content: 'x' }, ACTOR);

    // Order follows the database collation, so only the members are asserted.
    const quy = await service.listTopics(guildId, ROLE, 'QUY');
    expect(quy).toHaveLength(2);
    expect(quy).toEqual(expect.arrayContaining(['quy định', 'Quy tắc']));
    await expect(service.listTopics(guildId, ROLE, '%')).resolves.toEqual(['100% done']);
    await expect(service.listTopics(guildId, ROLE, 'a_b')).resolves.toEqual(['a_b']);
    await expect(service.listTopics(guildId, ROLE, 'nothing matches')).resolves.toEqual([]);
  });

  it('pages and searches notes in the database, with the total and a literal search', async () => {
    const guildId = newGuild();
    for (const [roleId, topic, content] of [
      [ROLE, 'Rules', 'Be kind'],
      [ROLE, 'Links', '100% DOCS'],
      [ROLE, 'Rota', 'weekly'],
      [OTHER_ROLE, 'Docs', 'wiki'],
    ] as const) {
      await service.upsert(guildId, { roleId, topic, content }, ACTOR);
    }
    const first = await service.listPage(guildId, { page: 1, limit: 3 });
    expect(first.total).toBe(4);
    expect(first.items).toHaveLength(3);
    const second = await service.listPage(guildId, { page: 2, limit: 3 });
    expect(second.items).toHaveLength(1);
    expect([...first.items, ...second.items].map((note) => note.topic).sort()).toEqual([
      'Docs',
      'Links',
      'Rota',
      'Rules',
    ]);

    const docs = await service.listPage(guildId, { q: 'docs', page: 1, limit: 10 });
    expect(docs.items.map((note) => note.topic).sort()).toEqual(['Docs', 'Links']);
    const inRole = await service.listPage(guildId, { roleId: ROLE, q: 'docs', page: 1, limit: 10 });
    expect(inRole).toMatchObject({ total: 1, items: [{ topic: 'Links' }] });
    await expect(service.listPage(guildId, { q: '%', page: 1, limit: 10 })).resolves.toMatchObject({
      total: 1,
      items: [{ topic: 'Links' }],
    });
    await expect(service.listPage(newGuild(), { page: 1, limit: 10 })).resolves.toEqual({
      items: [],
      total: 0,
    });
  });

  it('previews a save as CREATE or REPLACE without a row or an audit entry', async () => {
    const guildId = newGuild();
    const input = { roleId: ROLE, topic: 'Rules', content: 'text' };
    await expect(service.upsert(guildId, input, ACTOR, { dryRun: true })).resolves.toMatchObject({
      action: 'CREATE',
    });
    await expect(prisma.guild.count({ where: { discordId: guildId } })).resolves.toBe(0);
    await service.upsert(guildId, input, ACTOR);
    await expect(
      service.upsert(guildId, { ...input, content: 'other' }, ACTOR, { dryRun: true }),
    ).resolves.toMatchObject({ action: 'REPLACE' });
    expect((await service.get(guildId, ROLE, 'Rules'))?.content).toBe('text');
    expect(await auditRows(guildId, AUDIT_ACTIONS.noteUpsert)).toHaveLength(1);
  });

  it('returns at most 25 suggestions', async () => {
    const guildId = newGuild();
    for (let index = 0; index < 30; index += 1) {
      await service.upsert(
        guildId,
        { roleId: ROLE, topic: `topic ${String(index).padStart(2, '0')}`, content: 'x' },
        ACTOR,
      );
    }
    await expect(service.listTopics(guildId, ROLE)).resolves.toHaveLength(25);
  });

  it('writes one audit row per save and per removal, without the text', async () => {
    const guildId = newGuild();
    await service.upsert(
      guildId,
      { roleId: ROLE, topic: 'Rules', content: 'private words' },
      ACTOR,
    );
    await service.remove(guildId, { roleId: ROLE, topic: 'Rules' }, ACTOR);

    const saved = await auditRows(guildId, AUDIT_ACTIONS.noteUpsert);
    const removed = await auditRows(guildId, AUDIT_ACTIONS.noteRemove);
    expect(saved).toHaveLength(1);
    expect(removed).toHaveLength(1);
    expect(saved[0]).toMatchObject({ actorDiscordId: ACTOR.userId, source: 'DISCORD' });
    expect(JSON.stringify([saved, removed])).not.toContain('private words');
  });

  it('previews a removal without changing a row or auditing', async () => {
    const guildId = newGuild();
    await service.upsert(guildId, { roleId: ROLE, topic: 'Keep', content: 'x' }, ACTOR);

    await expect(
      service.remove(guildId, { roleId: ROLE, topic: 'Keep' }, ACTOR, { dryRun: true }),
    ).resolves.toEqual({ count: 1, sample: [{ roleId: ROLE, topic: 'Keep' }] });
    await expect(service.listByRole(guildId, ROLE)).resolves.toHaveLength(1);
    await expect(auditRows(guildId, AUDIT_ACTIONS.noteRemove)).resolves.toHaveLength(0);
  });

  it('removes only the exact topic and stays silent for one that does not exist', async () => {
    const guildId = newGuild();
    await service.upsert(guildId, { roleId: ROLE, topic: 'Rules', content: 'x' }, ACTOR);

    await expect(service.remove(guildId, { roleId: ROLE, topic: 'rules' }, ACTOR)).resolves.toEqual(
      {
        count: 0,
      },
    );
    await expect(
      service.remove(guildId, { roleId: OTHER_ROLE, topic: 'Rules' }, ACTOR),
    ).resolves.toEqual({ count: 0 });
    await expect(service.listByRole(guildId, ROLE)).resolves.toHaveLength(1);
    await expect(auditRows(guildId, AUDIT_ACTIONS.noteRemove)).resolves.toHaveLength(0);

    await expect(service.remove(guildId, { roleId: ROLE, topic: 'Rules' }, ACTOR)).resolves.toEqual(
      {
        count: 1,
      },
    );
    await expect(service.listByRole(guildId, ROLE)).resolves.toHaveLength(0);
  });

  it('rejects blank content at the database too', async () => {
    const guildId = newGuild();
    const guild = await prisma.guild.create({ data: { discordId: guildId } });
    await expect(
      prisma.noteEntry.create({
        data: { guildId: guild.id, roleId: ROLE, topic: 't', content: '' },
      }),
    ).rejects.toThrow();
  });

  it('returns nothing for a server the bot has never seen', async () => {
    const guildId = newGuild();
    await expect(service.listByRole(guildId, ROLE)).resolves.toEqual([]);
    await expect(service.listAll(guildId)).resolves.toEqual([]);
    await expect(service.listTopics(guildId, ROLE)).resolves.toEqual([]);
    await expect(service.remove(guildId, { roleId: ROLE, topic: 't' }, ACTOR)).resolves.toEqual({
      count: 0,
    });
    await expect(prisma.guild.count({ where: { discordId: guildId } })).resolves.toBe(0);
  });
});
