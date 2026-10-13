import 'reflect-metadata';
import { AUDIT_ACTIONS, ErrorCode, type ActorContext } from '@sab/shared';
import { Collection, type Client } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../common/audit/audit.service.js';
import type { DiscordReactionService } from '../../discord/services/discord-reaction.service.js';
import type {
  MessageResolution,
  MessageResolver,
} from '../../discord/services/message-resolver.service.js';
import { RoleAssignService } from './role-assign.service.js';

const GUILD = '100000000000000001';
const OTHER_GUILD = '100000000000000009';
const CHANNEL = '100000000000000011';
const MESSAGE = '100000000000000021';
const ROLE = '100000000000000041';
const SOURCE_ROLE = '100000000000000042';
const ACTOR: ActorContext = { source: 'DISCORD', userId: '100000000000000031' };
/** `expect.objectContaining` is typed `any`; naming it `unknown` keeps the matcher usable inside other matchers. */
const containing = (expected: object): unknown => expect.objectContaining(expected);

const user = (n: number) => String(200000000000000000n + BigInt(n));

function discordFailure(message: string, code = 50013): Error {
  return Object.assign(new Error(message), { code });
}

type Behaviour = 'ok' | 'refuse' | 'crash';

function fakeMember(id: string, opts: { roles?: string[]; behaviour?: Behaviour } = {}) {
  const act = (): Promise<unknown> => {
    switch (opts.behaviour ?? 'ok') {
      case 'refuse':
        return Promise.reject(discordFailure('Missing Permissions'));
      case 'crash':
        return Promise.reject(new TypeError('boom'));
      case 'ok':
        return Promise.resolve();
    }
  };
  return {
    id,
    user: { username: `name-${id.slice(-3)}` },
    roles: {
      cache: new Set(opts.roles ?? []),
      add: vi.fn(act),
      remove: vi.fn(act),
    },
  };
}

function build(
  over: {
    members?: ReturnType<typeof fakeMember>[];
    reactors?: string[];
    roleExists?: boolean;
    guildFails?: Error;
    message?: { guildId: string | null };
  } = {},
) {
  const members = new Collection((over.members ?? []).map((m) => [m.id, m] as const));
  const role = { id: ROLE };
  const guild = {
    id: GUILD,
    members: { fetch: vi.fn().mockResolvedValue(members) },
    roles: {
      cache: new Map(over.roleExists === false ? [] : [[ROLE, role]]),
      fetch: vi.fn().mockResolvedValue(null),
    },
  };
  const client = {
    guilds: {
      fetch: over.guildFails
        ? vi.fn().mockRejectedValue(over.guildFails)
        : vi.fn().mockResolvedValue(guild),
    },
  };
  const message = { id: MESSAGE, channelId: CHANNEL, guildId: GUILD, ...over.message };
  const resolver = {
    fetch: vi.fn((): Promise<MessageResolution> =>
      Promise.resolve({ status: 'OK', message: message as never }),
    ),
  };
  const reactions = { fetchReactorIds: vi.fn().mockResolvedValue(over.reactors ?? []) };
  const audit = { record: vi.fn().mockResolvedValue(undefined) };
  const service = new RoleAssignService(
    client as unknown as Client,
    resolver as unknown as MessageResolver,
    reactions as unknown as DiscordReactionService,
    audit as unknown as AuditService,
  );
  return { service, guild, client, resolver, reactions, audit, role };
}

describe('applyToMembers', () => {
  it('gives the role to members, leaves non-members out without a word, and audits', async () => {
    const a = fakeMember(user(1));
    const b = fakeMember(user(2));
    const { service, audit, role } = build({ members: [a, b] });
    const result = await service.applyToMembers(
      GUILD,
      { roleId: ROLE, userIds: [user(1), user(2), user(9)] },
      ACTOR,
    );

    expect(result).toEqual({
      dryRun: false,
      status: 'OK',
      planned: 2,
      done: 2,
      skipped: 1,
      sample: [user(1), user(2)],
      failures: [],
    });
    expect(a.roles.add).toHaveBeenCalledWith(role);
    expect(b.roles.add).toHaveBeenCalledWith(role);
    expect(audit.record).toHaveBeenCalledWith({
      guildId: GUILD,
      actor: ACTOR,
      action: AUDIT_ACTIONS.roleAssignApply,
      params: { roleId: ROLE, mode: 'add', count: 2, total: 2, skipped: 1, failed: 0 },
    });
  });

  it('takes the role instead when asked', async () => {
    const a = fakeMember(user(1));
    const { service, audit } = build({ members: [a] });
    await service.applyToMembers(GUILD, { roleId: ROLE, userIds: [user(1)], remove: true }, ACTOR);

    expect(a.roles.remove).toHaveBeenCalledTimes(1);
    expect(a.roles.add).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ params: containing({ mode: 'remove' }) }),
    );
  });

  it('counts only the successes and reports each failure without hiding the others', async () => {
    const good = fakeMember(user(1));
    const refused = fakeMember(user(2), { behaviour: 'refuse' });
    const crashed = fakeMember(user(3), { behaviour: 'crash' });
    const { service, audit } = build({ members: [good, refused, crashed] });
    const result = await service.applyToMembers(
      GUILD,
      { roleId: ROLE, userIds: [user(1), user(2), user(3)] },
      ACTOR,
    );

    expect(result.done).toBe(1);
    expect(result.failures).toEqual([
      { userId: user(2), name: `name-${user(2).slice(-3)}`, reason: 'Missing Permissions' },
      { userId: user(3), name: `name-${user(3).slice(-3)}`, reason: 'Unknown error' },
    ]);
    expect(audit.record).toHaveBeenCalledWith(
      containing({ params: containing({ count: 1, failed: 2 }) }),
    );
  });

  it('audits an all-failed run as a failure', async () => {
    const refused = fakeMember(user(2), { behaviour: 'refuse' });
    const { service, audit } = build({ members: [refused] });
    await service.applyToMembers(GUILD, { roleId: ROLE, userIds: [user(2)] }, ACTOR);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ ok: false, error: 'DISCORD_API_ERROR' }),
    );
  });

  it('adds the holders of another role to the list, once each', async () => {
    const a = fakeMember(user(1), { roles: [SOURCE_ROLE] });
    const b = fakeMember(user(2), { roles: [SOURCE_ROLE] });
    const c = fakeMember(user(3));
    const { service, audit } = build({ members: [a, b, c] });
    const result = await service.applyToMembers(
      GUILD,
      { roleId: ROLE, userIds: [user(1)], membersOfRoleId: SOURCE_ROLE },
      ACTOR,
    );

    expect(result.sample).toEqual([user(1), user(2)]);
    expect(c.roles.add).not.toHaveBeenCalled();
    expect(audit.record).toHaveBeenCalledWith(
      containing({ params: containing({ targetId: SOURCE_ROLE }) }),
    );
  });

  it('pages through the member list once, not once for the holders and again for the edit', async () => {
    const a = fakeMember(user(1), { roles: [SOURCE_ROLE] });
    const { service, guild } = build({ members: [a] });
    await service.applyToMembers(GUILD, { roleId: ROLE, membersOfRoleId: SOURCE_ROLE }, ACTOR);
    expect(guild.members.fetch).toHaveBeenCalledTimes(1);
  });

  it('works from the role alone', async () => {
    const a = fakeMember(user(1), { roles: [SOURCE_ROLE] });
    const { service } = build({ members: [a] });
    const result = await service.applyToMembers(
      GUILD,
      { roleId: ROLE, membersOfRoleId: SOURCE_ROLE },
      ACTOR,
    );
    expect(result.done).toBe(1);
  });

  it('plans without editing or auditing when it is a dry run', async () => {
    const a = fakeMember(user(1));
    const { service, audit } = build({ members: [a] });
    const result = await service.applyToMembers(
      GUILD,
      { roleId: ROLE, userIds: [user(1), user(9)] },
      ACTOR,
      { dryRun: true },
    );

    expect(result).toMatchObject({ dryRun: true, planned: 1, done: 0, skipped: 1 });
    expect(a.roles.add).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('edits the real run exactly as the plan said', async () => {
    const members = [fakeMember(user(1)), fakeMember(user(2))];
    const { service } = build({ members });
    const input = { roleId: ROLE, userIds: [user(1), user(2), user(9)] };
    const plan = await service.applyToMembers(GUILD, input, ACTOR, { dryRun: true });
    const done = await service.applyToMembers(GUILD, input, ACTOR);

    expect(done.done).toBe(plan.planned);
    expect(done.sample).toEqual(plan.sample);
    expect(done.skipped).toBe(plan.skipped);
  });

  it('audits nothing when nobody was changed', async () => {
    const { service, audit } = build({ members: [] });
    const result = await service.applyToMembers(GUILD, { roleId: ROLE, userIds: [user(9)] }, ACTOR);
    expect(result).toMatchObject({ planned: 0, done: 0, skipped: 1 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('never has more than a handful of edits in flight', async () => {
    let running = 0;
    let peak = 0;
    const members = Array.from({ length: 30 }, (_, n) => {
      const member = fakeMember(user(n + 1));
      member.roles.add.mockImplementation(async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 1));
        running -= 1;
      });
      return member;
    });
    const { service } = build({ members });
    await service.applyToMembers(GUILD, { roleId: ROLE, userIds: members.map((m) => m.id) }, ACTOR);
    expect(peak).toBeGreaterThan(1);
    expect(peak).toBeLessThanOrEqual(5);
  });

  it('rejects input without a target, a mention in place of an id, and a role that is not there', async () => {
    const { service } = build({ members: [fakeMember(user(1))] });
    await expect(service.applyToMembers(GUILD, { roleId: ROLE }, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    await expect(
      service.applyToMembers(GUILD, { roleId: ROLE, userIds: [`<@${user(1)}>`] }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });

    const missingRole = build({ members: [fakeMember(user(1))], roleExists: false });
    await expect(
      missingRole.service.applyToMembers(GUILD, { roleId: ROLE, userIds: [user(1)] }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
  });

  it('says the bot is not in the server when Discord does not know it', async () => {
    const { service } = build({ guildFails: discordFailure('Unknown Guild', 10004) });
    await expect(
      service.applyToMembers(GUILD, { roleId: ROLE, userIds: [user(1)] }, ACTOR),
    ).rejects.toMatchObject({ code: ErrorCode.GUILD_BOT_MISSING });
  });
});

describe('applyToReactors', () => {
  const input = { roleId: ROLE, channelId: CHANNEL, messageId: MESSAGE, emoji: '✅' };

  it('gives the role to the people who reacted with that emoji', async () => {
    const a = fakeMember(user(1));
    const { service, reactions, audit } = build({ members: [a], reactors: [user(1)] });
    const result = await service.applyToReactors(GUILD, input, ACTOR);

    expect(reactions.fetchReactorIds).toHaveBeenCalledWith(expect.anything(), '✅');
    expect(result).toMatchObject({ status: 'OK', done: 1 });
    expect(audit.record).toHaveBeenCalledWith(
      containing({
        params: containing({ channelId: CHANNEL, messageId: MESSAGE, emoji: '✅' }),
      }),
    );
  });

  it('says nobody reacted instead of reporting "done 0"', async () => {
    const { service, audit } = build({ members: [], reactors: [] });
    const result = await service.applyToReactors(GUILD, input, ACTOR);
    expect(result).toMatchObject({ status: 'NO_REACTORS', done: 0, planned: 0 });
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('plans without editing when it is a dry run', async () => {
    const a = fakeMember(user(1));
    const { service, audit } = build({ members: [a], reactors: [user(1)] });
    const result = await service.applyToReactors(GUILD, input, ACTOR, { dryRun: true });
    expect(result).toMatchObject({ dryRun: true, planned: 1, done: 0 });
    expect(a.roles.add).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('refuses a message from another server unless the caller allows it', async () => {
    const a = fakeMember(user(1));
    const strict = build({ members: [a], reactors: [user(1)], message: { guildId: OTHER_GUILD } });
    await expect(strict.service.applyToReactors(GUILD, input, ACTOR)).rejects.toMatchObject({
      code: ErrorCode.DISCORD_CHANNEL_NOT_FOUND,
    });

    const lenient = build({ members: [a], reactors: [user(1)], message: { guildId: OTHER_GUILD } });
    await expect(
      lenient.service.applyToReactors(GUILD, input, ACTOR, { crossGuild: true }),
    ).resolves.toMatchObject({ done: 1 });
  });
});
