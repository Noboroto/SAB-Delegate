import 'reflect-metadata';
import { ErrorCode, type RoleAssignResult } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import type {
  MessageResolution,
  MessageResolver,
} from '../../discord/services/message-resolver.service.js';
import { RoleAssignCommands } from './role-assign.commands.js';
import type { RoleAssignService } from './role-assign.service.js';

const GUILD = '100000000000000001';
const CHANNEL = '100000000000000011';
const MESSAGE = '100000000000000021';
const ROLE = { id: '100000000000000041' };
const SOURCE_ROLE = { id: '100000000000000042' };
const ASKER = '100000000000000031';
const user = (n: number) => String(200000000000000000n + BigInt(n));

const t = translatorFor('en');
const ephemeral = { flags: MessageFlags.Ephemeral };

const result = (over: Partial<RoleAssignResult> = {}): RoleAssignResult => ({
  dryRun: false,
  status: 'OK',
  planned: 2,
  done: 2,
  skipped: 0,
  sample: [],
  failures: [],
  ...over,
});

function build(
  resolution: MessageResolution = {
    status: 'OK',
    message: { id: MESSAGE, channelId: CHANNEL } as never,
  },
) {
  const roles = {
    applyToMembers: vi.fn().mockResolvedValue(result()),
    applyToReactors: vi.fn().mockResolvedValue(result()),
  };
  const resolver = { fetch: vi.fn().mockResolvedValue(resolution) };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const commands = new RoleAssignCommands(
    roles as unknown as RoleAssignService,
    resolver as unknown as MessageResolver,
    locales as unknown as GuildLocaleService,
  );
  const calls: string[] = [];
  const interaction = (guildId: string | null = GUILD) => {
    let deferred = false;
    return {
      guildId,
      channelId: CHANNEL,
      locale: 'en-US',
      user: { id: ASKER },
      replied: false,
      get deferred() {
        return deferred;
      },
      deferReply: vi.fn().mockImplementation(() => {
        calls.push('deferReply');
        deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockImplementation(() => {
        calls.push('editReply');
        return Promise.resolve();
      }),
      followUp: vi.fn().mockResolvedValue(undefined),
      reply: vi.fn().mockResolvedValue(undefined),
    };
  };
  return { commands, roles, resolver, interaction, calls };
}

const textOf = (mock: { mock: { calls: unknown[][] } }, call = 0) =>
  (mock.mock.calls[call]?.[0] as { content: string }).content;

describe('/bulk-assign list', () => {
  it('defers privately, then reads only the member ids out of whatever was typed', async () => {
    const { commands, roles, interaction, calls } = build();
    const target = interaction();
    const typed = `<@${user(1)}>, ${user(2)}; <@&${SOURCE_ROLE.id}> <#${user(3)}> 12345 ${user(1)}`;
    await commands.onList([target] as never, { role: ROLE, ids: typed });

    expect(calls).toEqual(['deferReply', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith(ephemeral);
    expect(roles.applyToMembers).toHaveBeenCalledWith(
      GUILD,
      { roleId: ROLE.id, userIds: [user(1), user(2)], membersOfRoleId: undefined, remove: false },
      { source: 'DISCORD', userId: ASKER },
    );
  });

  it('passes the role to take members from, and the removal flag', async () => {
    const { commands, roles, interaction } = build();
    await commands.onList([interaction()] as never, {
      role: ROLE,
      membersOfRole: SOURCE_ROLE,
      isRemove: true,
    });
    expect(roles.applyToMembers).toHaveBeenCalledWith(
      GUILD,
      { roleId: ROLE.id, userIds: [], membersOfRoleId: SOURCE_ROLE.id, remove: true },
      expect.anything(),
    );
  });

  it('asks for a target instead of doing nothing when the text holds no member id', async () => {
    const { commands, roles, interaction } = build();
    const target = interaction();
    await commands.onList([target] as never, { role: ROLE, ids: `<@&${SOURCE_ROLE.id}> hello` });

    expect(roles.applyToMembers).not.toHaveBeenCalled();
    expect(target.editReply).toHaveBeenCalledWith({ content: t('role-assign.noTargets') });
  });

  it('reports the total, what was left out and each failure', async () => {
    const { commands, roles, interaction } = build();
    roles.applyToMembers.mockResolvedValue(
      result({
        done: 1,
        skipped: 2,
        failures: [{ userId: user(2), name: 'ann', reason: 'Missing Permissions' }],
      }),
    );
    const target = interaction();
    await commands.onList([target] as never, { role: ROLE, ids: user(1) });

    const text = textOf(target.editReply);
    expect(text).toContain(t('role-assign.done', { count: 1 }));
    expect(text).toContain(t('role-assign.skipped', { count: 2 }));
    expect(text).toContain('ann: Missing Permissions');
  });

  it('splits an answer that would not fit in one message', async () => {
    const { commands, roles, interaction } = build();
    roles.applyToMembers.mockResolvedValue(
      result({
        failures: Array.from({ length: 200 }, (_, n) => ({
          userId: user(n),
          name: `member-${n}`,
          reason: 'Missing Permissions and some more words to make the line longer',
        })),
      }),
    );
    const target = interaction();
    await commands.onList([target] as never, { role: ROLE, ids: user(1) });

    expect(target.followUp.mock.calls.length).toBeGreaterThan(0);
    for (const [options] of [
      ...target.editReply.mock.calls,
      ...target.followUp.mock.calls,
    ] as Array<[{ content: string }]>) {
      expect(options.content.length).toBeLessThanOrEqual(2000);
    }
  });

  it('needs a server', async () => {
    const { commands, interaction } = build();
    await expect(
      commands.onList([interaction(null)] as never, { role: ROLE, ids: user(1) }),
    ).rejects.toMatchObject({ code: ErrorCode.GUILD_NOT_FOUND });
  });
});

describe('/bulk-assign by-reaction', () => {
  const options = { messageLink: 'link', emoji: '✅', role: ROLE };

  it('resolves the link, then asks the service to read this server’s role and the message’s reactors', async () => {
    const { commands, roles, interaction } = build();
    const target = interaction();
    await commands.onByReaction([target] as never, { ...options, isRemove: true });

    expect(target.deferReply).toHaveBeenCalledWith(ephemeral);
    expect(roles.applyToReactors).toHaveBeenCalledWith(
      GUILD,
      { roleId: ROLE.id, channelId: CHANNEL, messageId: MESSAGE, emoji: '✅', remove: true },
      { source: 'DISCORD', userId: ASKER },
      { crossGuild: true },
    );
    expect(textOf(target.editReply)).toBe(t('role-assign.done', { count: 2 }));
  });

  it('says nobody reacted instead of "done 0"', async () => {
    const { commands, roles, interaction } = build();
    roles.applyToReactors.mockResolvedValue(result({ status: 'NO_REACTORS', planned: 0, done: 0 }));
    const target = interaction();
    await commands.onByReaction([target] as never, options);
    expect(textOf(target.editReply)).toBe(t('role-assign.noReactors'));
  });

  it.each([
    [{ status: 'INVALID_LINK', reason: 'MALFORMED' } as const, t('errors.invalidLink.MALFORMED')],
    [{ status: 'NOT_FOUND' } as const, t('errors.DISCORD_MESSAGE_NOT_FOUND')],
    [
      { status: 'NO_ACCESS' } as const,
      t('errors.DISCORD_MISSING_PERMISSIONS', { permission: 'view' }),
    ],
  ])('explains a link that does not lead to a message (%o)', async (resolution, expected) => {
    const { commands, roles, interaction } = build(resolution);
    const target = interaction();
    await commands.onByReaction([target] as never, options);

    expect(target.editReply).toHaveBeenCalledWith({ content: expected });
    expect(roles.applyToReactors).not.toHaveBeenCalled();
  });
});
