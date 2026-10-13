import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from '../../common/audit/audit.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { GuildConfigService } from '../guild-config/guild-config.service.js';
import { NoteService } from './note.service.js';

const GUILD = '100000000000000001';
const ROLE = '300000000000000001';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000002' };
const GUILD_ROW = { id: 'guild-uuid' };

type UpsertArgs = {
  where: { guildId_roleId_topic: { topic: string } };
  update: { content: string };
};

const failsWith = (code: ErrorCode): unknown =>
  expect.objectContaining({ name: 'ServiceError', code });

function build() {
  const noteEntry = {
    upsert: vi
      .fn()
      .mockImplementation(({ create }: { create: Record<string, unknown> }) =>
        Promise.resolve({ ...create, updatedAt: new Date(0) }),
      ),
    findFirst: vi.fn().mockResolvedValue(null),
    findMany: vi.fn().mockResolvedValue([]),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  };
  const prisma = { noteEntry, $transaction: vi.fn() };
  prisma.$transaction.mockImplementation((work: (tx: typeof prisma) => unknown) => work(prisma));
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const guilds = { ensureGuild: vi.fn().mockResolvedValue(GUILD_ROW) };
  const service = new NoteService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditService,
    guilds as unknown as GuildConfigService,
  );
  return { service, prisma, noteEntry, audit, guilds };
}

describe('NoteService.upsert', () => {
  it('saves under the (server, role, topic) key and audits in the same transaction', async () => {
    const { service, prisma, noteEntry, audit, guilds } = build();
    const note = await service.upsert(
      GUILD,
      { roleId: ROLE, topic: 'Rules', content: 'Be kind' },
      ACTOR,
    );

    expect(guilds.ensureGuild).toHaveBeenCalledWith(GUILD, undefined, prisma);
    expect(noteEntry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guildId_roleId_topic: { guildId: 'guild-uuid', roleId: ROLE, topic: 'Rules' } },
        create: { guildId: 'guild-uuid', roleId: ROLE, topic: 'Rules', content: 'Be kind' },
        update: { content: 'Be kind' },
      }),
    );
    expect(note).toMatchObject({ roleId: ROLE, topic: 'Rules', content: 'Be kind' });
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.noteUpsert,
        params: { roleId: ROLE, topic: 'Rules' },
      },
      prisma,
    );
  });

  it('never puts the text of the note in the audit row', async () => {
    const { service, audit } = build();
    await service.upsert(GUILD, { roleId: ROLE, topic: 't', content: 'secret text' }, ACTOR);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('secret text');
  });

  it('replaces the content when the same topic is saved again', async () => {
    const { service, noteEntry } = build();
    await service.upsert(GUILD, { roleId: ROLE, topic: 'Rules', content: 'first' }, ACTOR);
    await service.upsert(GUILD, { roleId: ROLE, topic: 'Rules', content: 'second' }, ACTOR);

    const [firstCall, secondCall] = noteEntry.upsert.mock.calls as Array<[UpsertArgs]>;
    expect(secondCall?.[0].where).toEqual(firstCall?.[0].where);
    expect(secondCall?.[0].update).toEqual({ content: 'second' });
  });

  it('keeps topics that differ only in case apart', async () => {
    const { service, noteEntry } = build();
    await service.upsert(GUILD, { roleId: ROLE, topic: 'Rules', content: 'a' }, ACTOR);
    await service.upsert(GUILD, { roleId: ROLE, topic: 'rules', content: 'b' }, ACTOR);

    const keys = noteEntry.upsert.mock.calls.map(
      ([args]) =>
        (args as { where: { guildId_roleId_topic: { topic: string } } }).where.guildId_roleId_topic
          .topic,
    );
    expect(keys).toEqual(['Rules', 'rules']);
  });

  it('refuses blank content, a blank topic and a bad role before touching the database', async () => {
    const { service, prisma } = build();
    for (const input of [
      { roleId: ROLE, topic: 't', content: '   ' },
      { roleId: ROLE, topic: 't', content: '' },
      { roleId: ROLE, topic: ' ', content: 'c' },
      { roleId: '<@&1>', topic: 't', content: 'c' },
      { roleId: ROLE, topic: 't' },
      null,
    ]) {
      await expect(service.upsert(GUILD, input, ACTOR)).rejects.toEqual(
        failsWith(ErrorCode.VALIDATION_FAILED),
      );
    }
    await expect(
      service.upsert('not-an-id', { roleId: ROLE, topic: 't', content: 'c' }, ACTOR),
    ).rejects.toEqual(failsWith(ErrorCode.VALIDATION_FAILED));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('lets a failing audit write fail the save, as both run on the transaction client', async () => {
    const failing = build();
    failing.audit.record.mockRejectedValue(new Error('audit down'));
    await expect(
      failing.service.upsert(GUILD, { roleId: ROLE, topic: 't', content: 'c' }, ACTOR),
    ).rejects.toThrow('audit down');
    expect(failing.audit.record.mock.calls[0]?.[1]).toBe(failing.prisma);
  });
});

describe('NoteService reads', () => {
  it('lists a role in the order the notes were first saved', async () => {
    const { service, noteEntry } = build();
    await service.listByRole(GUILD, ROLE);
    expect(noteEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guild: { discordId: GUILD }, roleId: ROLE },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('selects only the public columns', async () => {
    const { service, noteEntry } = build();
    await service.listAll(GUILD);
    expect(noteEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { roleId: true, topic: true, content: true, updatedAt: true },
      }),
    );
  });

  it('returns null for a topic the role does not have', async () => {
    const { service, noteEntry } = build();
    await expect(service.get(GUILD, ROLE, 'missing')).resolves.toBeNull();
    expect(noteEntry.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guild: { discordId: GUILD }, roleId: ROLE, topic: 'missing' },
      }),
    );
  });

  it('rejects ids that are not snowflakes', async () => {
    const { service } = build();
    await expect(service.listByRole('x', ROLE)).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
    await expect(service.listAll('x')).rejects.toEqual(failsWith(ErrorCode.VALIDATION_FAILED));
    await expect(service.listTopics(GUILD, 'role')).rejects.toEqual(
      failsWith(ErrorCode.VALIDATION_FAILED),
    );
  });
});

describe('NoteService.listTopics', () => {
  it('asks for at most 25 topics of the chosen role, ordered', async () => {
    const { service, noteEntry } = build();
    noteEntry.findMany.mockResolvedValue([{ topic: 'a' }, { topic: 'b' }]);
    await expect(service.listTopics(GUILD, ROLE, '', 500)).resolves.toEqual(['a', 'b']);
    expect(noteEntry.findMany).toHaveBeenCalledWith({
      where: { guild: { discordId: GUILD }, roleId: ROLE },
      select: { topic: true },
      orderBy: [{ topic: 'asc' }],
      take: 25,
    });
  });

  it('filters in the database, ignoring case, with the typed text escaped', async () => {
    const { service, noteEntry } = build();
    await service.listTopics(GUILD, ROLE, ' 50%_off ');
    const args = noteEntry.findMany.mock.calls[0]?.[0] as { where: { topic: unknown } };
    expect(args.where.topic).toEqual({ contains: '50\\%\\_off', mode: 'insensitive' });
  });

  it('never asks for fewer than one row', async () => {
    const { service, noteEntry } = build();
    await service.listTopics(GUILD, ROLE, '', 0);
    expect((noteEntry.findMany.mock.calls[0]?.[0] as { take: number }).take).toBe(1);
  });
});

describe('NoteService.remove', () => {
  const key = { roleId: ROLE, topic: 'Rules' };
  const planned = [{ id: 'row-1', ...key }];

  it('previews without writing, auditing or opening a transaction', async () => {
    const { service, prisma, noteEntry, audit } = build();
    noteEntry.findMany.mockResolvedValue(planned);

    await expect(service.remove(GUILD, key, ACTOR, { dryRun: true })).resolves.toEqual({
      count: 1,
      sample: [key],
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(noteEntry.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('deletes exactly the rows the plan found and audits them in the transaction', async () => {
    const { service, prisma, noteEntry, audit } = build();
    noteEntry.findMany.mockResolvedValue(planned);

    await expect(service.remove(GUILD, key, ACTOR, { dryRun: false })).resolves.toEqual({
      count: 1,
    });
    expect(noteEntry.deleteMany).toHaveBeenCalledWith({ where: { id: { in: ['row-1'] } } });
    expect(audit.record).toHaveBeenCalledWith(
      {
        guildId: GUILD,
        actor: ACTOR,
        action: AUDIT_ACTIONS.noteRemove,
        params: { roleId: ROLE, topic: 'Rules', count: 1 },
      },
      prisma,
    );
  });

  it('plans and executes against the same key', async () => {
    const { service, noteEntry } = build();
    noteEntry.findMany.mockResolvedValue(planned);
    await service.remove(GUILD, key, ACTOR, { dryRun: true });
    await service.remove(GUILD, key, ACTOR);
    const [preview, real] = noteEntry.findMany.mock.calls.map((call: unknown[]) => call[0]);
    expect(real).toEqual(preview);
  });

  it('says nothing and audits nothing when the topic does not exist', async () => {
    const { service, noteEntry, audit } = build();
    noteEntry.findMany.mockResolvedValue([]);

    await expect(service.remove(GUILD, key, ACTOR)).resolves.toEqual({ count: 0 });
    await expect(service.remove(GUILD, key, ACTOR, { dryRun: true })).resolves.toEqual({
      count: 0,
      sample: [],
    });
    expect(noteEntry.deleteMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('matches the topic exactly, so another case is another note', async () => {
    const { service, noteEntry } = build();
    await service.remove(GUILD, { roleId: ROLE, topic: 'rules' }, ACTOR, { dryRun: true });
    expect(noteEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { guild: { discordId: GUILD }, roleId: ROLE, topic: 'rules' },
      }),
    );
  });

  it('refuses a malformed key', async () => {
    const { service } = build();
    await expect(service.remove(GUILD, { roleId: ROLE, topic: '' }, ACTOR)).rejects.toBeInstanceOf(
      ServiceError,
    );
  });
});

describe('NoteService wiring', () => {
  it('is built by the container from its three collaborators', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        NoteService,
        { provide: PrismaService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: GuildConfigService, useValue: {} },
      ],
    }).compile();
    expect(moduleRef.get(NoteService)).toBeInstanceOf(NoteService);
    await moduleRef.close();
  });
});
