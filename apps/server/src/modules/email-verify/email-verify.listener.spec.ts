import 'reflect-metadata';
import { MESSAGES } from '@sab/shared';
import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DiscordReadyService } from '../../discord/discord-ready.service.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import type { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import type { InviteGuild } from './email-verify-invites.js';
import { EmailVerifyInviteTracker } from './email-verify-invites.js';
import { EmailVerifyListener } from './email-verify.listener.js';
import type { EmailVerifyService } from './email-verify.service.js';

const GUILD = '100000000000000001';
const MEMBER = '100000000000000002';
const ROLE = '300000000000000001';
const UNVERIFIED = '300000000000000002';
const VERIFIED_GRANT = {
  status: 'VERIFIED',
  domain: 'lab.edu.test',
  addRoleIds: [ROLE],
  removeRoleId: UNVERIFIED,
} as const;

afterEach(() => vi.restoreAllMocks());

type Setup = {
  config?: Partial<{
    enabled: boolean;
    autoVerifyOnJoin: boolean;
    autoUnverifiedOnJoin: boolean;
    unverifiedRoleId: string | null;
  }>;
  /** What the server's invites say after the join: code -> uses. */
  invitesAfter?: Record<string, number>;
  joinRoles?: string[];
  verified?: boolean;
  stopping?: boolean;
  grantFailure?: string | null;
  canManage?: boolean;
  send?: () => Promise<unknown>;
};

async function build(setup: Setup = {}) {
  const tracker = new EmailVerifyInviteTracker();
  const config = {
    get: vi.fn().mockResolvedValue({
      enabled: true,
      autoVerifyOnJoin: false,
      autoUnverifiedOnJoin: false,
      unverifiedRoleId: null,
      ...setup.config,
    }),
  };
  const verify = {
    recordJoinInvite: vi.fn().mockResolvedValue(undefined),
    rolesForJoin: vi.fn().mockResolvedValue(setup.joinRoles ?? []),
    verifiedGrant: vi.fn().mockResolvedValue(setup.verified === true ? VERIFIED_GRANT : null),
    applyVerified: vi.fn().mockResolvedValue({ failure: null }),
  };
  const discord = {
    grantRoles: vi.fn().mockResolvedValue({
      added: [],
      removed: [],
      failure: setup.grantFailure ?? null,
      memberGone: false,
    }),
    postLog: vi.fn().mockResolvedValue(undefined),
  };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const ready = { isStopping: () => setup.stopping ?? false };
  const listener = new EmailVerifyListener(
    tracker,
    config as unknown as EmailVerifyConfigService,
    verify as unknown as EmailVerifyService,
    discord as unknown as EmailVerifyDiscordService,
    ready as unknown as DiscordReadyService,
    locales as unknown as GuildLocaleService,
  );

  const rounds: Array<Record<string, number>> = [{ abc: 1, other: 4 }];
  const fetch = vi.fn().mockImplementation(() => {
    const round = rounds.shift() ?? setup.invitesAfter ?? { abc: 1, other: 4 };
    return Promise.resolve(
      new Map(Object.entries(round).map(([code, uses]) => [code, { code, uses, maxUses: 0 }])),
    );
  });
  const send = vi.fn((_options: unknown) => (setup.send ?? (() => Promise.resolve(undefined)))());
  const guild = {
    id: GUILD,
    name: 'School',
    preferredLocale: 'en-US',
    invites: { fetch },
    members: {
      me: { permissions: { has: () => setup.canManage ?? true } },
    },
  } as unknown as InviteGuild & {
    id: string;
    name: string;
    preferredLocale: string;
    members: unknown;
  };
  const member = { id: MEMBER, user: { bot: false }, guild, send };
  // The baseline the join is compared with, taken before anybody joins.
  await listener.onClientReady([{ guilds: { cache: new Map([[GUILD, guild]]) } }] as never);
  return { listener, discord, verify, config, send, member, fetch };
}

const join = (listener: EmailVerifyListener, member: unknown) =>
  listener.onMemberAdd([member] as never);

describe('EmailVerifyListener: a member joins', () => {
  it('gives the roles of the rules for the invite they used, and logs it', async () => {
    const { listener, discord, verify, member } = await build({
      invitesAfter: { abc: 2, other: 4 },
      joinRoles: [ROLE],
    });
    await join(listener, member);

    expect(verify.recordJoinInvite).toHaveBeenCalledWith(GUILD, MEMBER, 'abc');
    expect(verify.rolesForJoin).toHaveBeenCalledWith(GUILD, 'abc');
    expect(discord.grantRoles).toHaveBeenCalledWith(GUILD, MEMBER, { add: [ROLE] });
    expect(discord.postLog).toHaveBeenCalledWith(
      GUILD,
      MESSAGES.en['email-verify'].log.inviteGranted
        .replace('{user}', `<@${MEMBER}>`)
        .replace('{code}', 'abc')
        .replace('{roles}', `<@&${ROLE}>`),
    );
  });

  it('records nothing when no invite explains the join (vanity link)', async () => {
    const { listener, verify, member } = await build({ joinRoles: [] });
    await join(listener, member);
    expect(verify.recordJoinInvite).not.toHaveBeenCalled();
    expect(verify.rolesForJoin).toHaveBeenCalledWith(GUILD, null);
  });

  it('gives the unverified role and sends the verify button when the server asked for both', async () => {
    const { listener, discord, send, member } = await build({
      invitesAfter: { abc: 2, other: 4 },
      config: { autoUnverifiedOnJoin: true, unverifiedRoleId: UNVERIFIED, autoVerifyOnJoin: true },
      joinRoles: [ROLE],
    });
    await join(listener, member);

    expect(discord.grantRoles).toHaveBeenCalledWith(GUILD, MEMBER, { add: [ROLE, UNVERIFIED] });
    const message = send.mock.calls[0]?.[0] as {
      content: string;
      allowedMentions: unknown;
      components: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }>;
    };
    expect(message.content).toBe(
      MESSAGES.en['email-verify'].verify.panel.dm.replace('{server}', 'School'),
    );
    expect(message.components[0]?.toJSON().components[0]?.custom_id).toBe(`ev/start/${GUILD}`);
    expect(message.allowedMentions).toEqual({ parse: [] });
  });

  it('still gives the roles of an invite when verification is off, but nothing that needs it', async () => {
    const { listener, discord, verify, send, member, fetch } = await build({
      invitesAfter: { abc: 2, other: 4 },
      joinRoles: [ROLE],
      config: {
        enabled: false,
        autoUnverifiedOnJoin: true,
        unverifiedRoleId: UNVERIFIED,
        autoVerifyOnJoin: true,
      },
    });
    await join(listener, member);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(verify.recordJoinInvite).toHaveBeenCalledWith(GUILD, MEMBER, 'abc');
    expect(discord.grantRoles).toHaveBeenCalledWith(GUILD, MEMBER, { add: [ROLE] });
    expect(send).not.toHaveBeenCalled();
  });

  it('gives a member who verified before and rejoined their roles back, with no button', async () => {
    const { listener, discord, verify, send, member } = await build({
      verified: true,
      config: { autoUnverifiedOnJoin: true, unverifiedRoleId: UNVERIFIED, autoVerifyOnJoin: true },
    });
    await join(listener, member);
    expect(verify.applyVerified).toHaveBeenCalledWith(GUILD, MEMBER, VERIFIED_GRANT, {
      rerun: true,
    });
    expect(discord.grantRoles).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('ignores bots', async () => {
    const { listener, config, member } = await build();
    await join(listener, { ...member, user: { bot: true } });
    expect(config.get).not.toHaveBeenCalled();
  });

  it('reports a refused role in the log channel instead of saying the invite granted it', async () => {
    const { listener, discord, member } = await build({
      invitesAfter: { abc: 2, other: 4 },
      joinRoles: [ROLE],
      grantFailure: 'Missing Permissions',
    });
    await join(listener, member);
    expect(discord.postLog).toHaveBeenCalledTimes(1);
    expect(discord.postLog.mock.calls[0]?.[1]).toContain('Missing Permissions');
  });

  it('treats a member who closed their direct messages as no problem', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { listener, member } = await build({
      config: { autoVerifyOnJoin: true },
      send: () =>
        Promise.reject(
          Object.assign(new Error('Cannot send messages to this user'), { code: 50007 }),
        ),
    });
    await expect(join(listener, member)).resolves.toBeUndefined();
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('verify button'));
    expect(error).not.toHaveBeenCalled();
  });

  it('never throws out of the handler: a failure is logged', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { listener, config, member } = await build();
    config.get.mockRejectedValue(new Error('db down'));
    await expect(join(listener, member)).resolves.toBeUndefined();
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Handling a join failed'));
  });

  it('does nothing once shutdown began', async () => {
    const { listener, config, member } = await build({ stopping: true });
    await join(listener, member);
    expect(config.get).not.toHaveBeenCalled();
  });

  it('does not list invites of a server where the bot cannot manage it', async () => {
    const { listener, fetch, member } = await build({ canManage: false });
    await join(listener, member);
    expect(fetch).not.toHaveBeenCalled();
  });
});
