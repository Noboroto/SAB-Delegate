import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import {
  EmailVerifyInviteTracker,
  usedInvite,
  type InviteGuild,
  type InviteLike,
} from './email-verify-invites.js';

const snapshot = (entries: Record<string, { uses: number; maxUses: number; deletedAt?: number }>) =>
  new Map(Object.entries(entries));

describe('usedInvite', () => {
  it('names the invite whose use count went up', () => {
    const before = snapshot({ abc: { uses: 2, maxUses: 0 }, xyz: { uses: 5, maxUses: 0 } });
    const after = snapshot({ abc: { uses: 3, maxUses: 0 }, xyz: { uses: 5, maxUses: 0 } });
    expect(usedInvite(before, after)).toBe('abc');
  });

  it('names an invite created and used between two looks', () => {
    const after = snapshot({ fresh: { uses: 1, maxUses: 0 } });
    expect(usedInvite(snapshot({}), after)).toBe('fresh');
  });

  it('names a single-use invite that is gone, as Discord deletes it with its last use', () => {
    const before = snapshot({ once: { uses: 0, maxUses: 1 }, other: { uses: 4, maxUses: 0 } });
    const after = snapshot({ other: { uses: 4, maxUses: 0 } });
    expect(usedInvite(before, after)).toBe('once');
  });

  it('does not blame a vanished invite that still had uses left', () => {
    const before = snapshot({ many: { uses: 1, maxUses: 10 } });
    expect(usedInvite(before, snapshot({}))).toBeNull();
  });

  it('does not blame a use-limited invite deleted by hand long before the join', () => {
    const before = snapshot({ once: { uses: 0, maxUses: 1, deletedAt: 1_000 } });
    expect(usedInvite(before, snapshot({}), 1_000 + 60_000)).toBeNull();
    expect(usedInvite(before, snapshot({}), 1_000 + 5_000)).toBe('once');
  });

  it('answers null when nothing changed (vanity link, widget, a bot)', () => {
    const same = snapshot({ abc: { uses: 2, maxUses: 0 } });
    expect(usedInvite(same, same)).toBeNull();
  });

  it('answers null rather than guess when several invites could explain the join', () => {
    const before = snapshot({ a: { uses: 0, maxUses: 0 }, b: { uses: 0, maxUses: 0 } });
    const after = snapshot({ a: { uses: 1, maxUses: 0 }, b: { uses: 1, maxUses: 0 } });
    expect(usedInvite(before, after)).toBeNull();
  });
});

function guildWith(
  ...rounds: Array<InviteLike[] | Error>
): InviteGuild & { fetch: ReturnType<typeof vi.fn> } {
  const fetch = vi.fn();
  for (const round of rounds) {
    if (round instanceof Error) fetch.mockRejectedValueOnce(round);
    else fetch.mockResolvedValueOnce(new Map(round.map((invite) => [invite.code, invite])));
  }
  return { id: '100000000000000001', invites: { fetch }, fetch };
}

describe('EmailVerifyInviteTracker', () => {
  it('takes a baseline first and then names the invite a join used', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith(
      [{ code: 'abc', uses: 1, maxUses: 0 }],
      [{ code: 'abc', uses: 2, maxUses: 0 }],
    );
    await tracker.prime(guild);
    expect(await tracker.claimJoin(guild)).toBe('abc');
  });

  it('cannot name an invite before it has a baseline', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith([{ code: 'abc', uses: 1, maxUses: 0 }]);
    expect(await tracker.claimJoin(guild)).toBeNull();
  });

  it('counts each use once: the next join starts from the new baseline', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith(
      [{ code: 'abc', uses: 0, maxUses: 0 }],
      [{ code: 'abc', uses: 1, maxUses: 0 }],
      [{ code: 'abc', uses: 1, maxUses: 0 }],
    );
    await tracker.prime(guild);
    expect(await tracker.claimJoin(guild)).toBe('abc');
    expect(await tracker.claimJoin(guild)).toBeNull();
  });

  it('follows an invite created after the baseline', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith([], [{ code: 'new', uses: 1, maxUses: 0 }]);
    await tracker.prime(guild);
    tracker.onInviteCreate(guild.id, { code: 'new', uses: 0, maxUses: 0 });
    expect(await tracker.claimJoin(guild)).toBe('new');
  });

  it('finds a last-use invite whose deletion was seen before the join', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith([{ code: 'once', uses: 0, maxUses: 1 }], []);
    await tracker.prime(guild);
    tracker.onInviteDelete(guild.id, { code: 'once' });
    expect(await tracker.claimJoin(guild)).toBe('once');
  });

  it('forgets a deleted invite that could not have been used up', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith([{ code: 'many', uses: 1, maxUses: 10 }], []);
    await tracker.prime(guild);
    tracker.onInviteDelete(guild.id, { code: 'many' });
    expect(await tracker.claimJoin(guild)).toBeNull();
  });

  it('leaves a server alone for a while once Discord says the bot may not list invites', async () => {
    const tracker = new EmailVerifyInviteTracker();
    const guild = guildWith(Object.assign(new Error('Missing Permissions'), { code: 50013 }));
    await tracker.prime(guild);
    expect(await tracker.claimJoin(guild)).toBeNull();
    expect(guild.fetch).toHaveBeenCalledTimes(1);
  });
});
