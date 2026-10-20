import { Injectable, Logger } from '@nestjs/common';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { failureLabel } from '../../discord/helpers/discord-failure.js';

/** What the tracker remembers of one invite. */
type InviteState = {
  uses: number;
  /** 0 for an invite that never runs out. */
  maxUses: number;
  /** When the invite was seen deleted, while it may still turn out to be the one just used up. */
  deletedAt?: number;
};

export type InviteSnapshot = ReadonlyMap<string, InviteState>;

/** The slice of a discord.js invite the tracker reads. */
export type InviteLike = {
  readonly code: string;
  readonly uses?: number | null;
  readonly maxUses?: number | null;
};

/** The slice of a server the tracker reads. */
export type InviteGuild = {
  readonly id: string;
  /** A discord.js `Collection`: a map of invites by code. */
  readonly invites: { fetch(): Promise<{ values(): Iterable<InviteLike> }> };
};

/** Missing Access, Missing Permissions: the bot may not list the server's invites. */
const NO_ACCESS_CODES: ReadonlySet<number> = new Set([50001, 50013]);

/** How long a server whose invites cannot be listed is left alone before asking again. */
const BLIND_MS = 10 * 60_000;

/**
 * How long a deleted invite still counts as the one that was just used up. An
 * invite with a use limit is deleted by Discord with its last use, and the
 * deletion may be seen before or after the member joining.
 */
const DELETED_GRACE_MS = 30_000;

function snapshotOf(invites: Iterable<InviteLike>): Map<string, InviteState> {
  const snapshot = new Map<string, InviteState>();
  for (const invite of invites) {
    snapshot.set(invite.code, { uses: invite.uses ?? 0, maxUses: invite.maxUses ?? 0 });
  }
  return snapshot;
}

/**
 * The invite a member joined with, by comparing the invites before and after:
 * the one whose use count went up, or one that is gone and had one use left
 * (a use-limited invite is deleted with its last use). `null` when no invite
 * explains the join (vanity link, a bot, a widget) or when several do, which
 * only happens when events were missed: guessing would grant someone else's
 * roles.
 */
export function usedInvite(
  before: InviteSnapshot,
  after: InviteSnapshot,
  now: number = Date.now(),
): string | null {
  const candidates: string[] = [];
  for (const [code, state] of after) {
    const previous = before.get(code)?.uses ?? 0;
    if (state.uses > previous) candidates.push(code);
  }
  for (const [code, state] of before) {
    if (after.has(code)) continue;
    const fresh = state.deletedAt === undefined || now - state.deletedAt <= DELETED_GRACE_MS;
    if (fresh && state.maxUses > 0 && state.uses + 1 >= state.maxUses) candidates.push(code);
  }
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

/**
 * Remembers each server's invites and their use counts, so a member who just
 * joined can be matched to the invite they used (Discord does not say). Needs
 * the Manage Server permission and the GuildInvites intent; a server where the
 * bot may not list invites is left alone for a while. In memory only: after a
 * restart the first join of each server only takes the baseline.
 */
@Injectable()
export class EmailVerifyInviteTracker {
  private readonly logger = new Logger(EmailVerifyInviteTracker.name);
  private readonly snapshots = new Map<string, Map<string, InviteState>>();
  private readonly blindUntil = new Map<string, number>();

  /** Takes (or refreshes) the baseline of a server without matching anyone. */
  async prime(guild: InviteGuild): Promise<void> {
    const fetched = await this.fetch(guild);
    if (fetched !== null) this.snapshots.set(guild.id, fetched);
  }

  /**
   * The code of the invite a member just joined with, `null` when it cannot be
   * told. The baseline is replaced either way. Call it for every join of a
   * server one at a time, or two joins would claim the same use.
   */
  async claimJoin(guild: InviteGuild): Promise<string | null> {
    const before = this.snapshots.get(guild.id);
    const after = await this.fetch(guild);
    if (after === null) return null;
    this.snapshots.set(guild.id, after);
    return before === undefined ? null : usedInvite(before, after);
  }

  /** A new invite has no uses yet; it only matters once the server has a baseline. */
  onInviteCreate(guildId: string, invite: InviteLike): void {
    this.snapshots.get(guildId)?.set(invite.code, {
      uses: invite.uses ?? 0,
      maxUses: invite.maxUses ?? 0,
    });
  }

  /**
   * A deleted invite is dropped at once unless it could be the one just used
   * up; that one is kept for a moment so the join that used it can be matched.
   */
  onInviteDelete(guildId: string, invite: InviteLike): void {
    const snapshot = this.snapshots.get(guildId);
    const state = snapshot?.get(invite.code);
    if (snapshot === undefined || state === undefined) return;
    if (state.maxUses > 0 && state.uses + 1 >= state.maxUses) {
      state.deletedAt = Date.now();
    } else {
      snapshot.delete(invite.code);
    }
  }

  private async fetch(guild: InviteGuild): Promise<Map<string, InviteState> | null> {
    const blind = this.blindUntil.get(guild.id);
    if (blind !== undefined && blind > Date.now()) return null;
    try {
      const invites = await guild.invites.fetch();
      this.blindUntil.delete(guild.id);
      return snapshotOf(invites.values());
    } catch (error) {
      const code = discordErrorCode(error);
      if (code !== undefined && NO_ACCESS_CODES.has(code)) {
        this.blindUntil.set(guild.id, Date.now() + BLIND_MS);
        this.snapshots.delete(guild.id);
        return null;
      }
      this.logger.warn(`Could not list the invites of a server (${failureLabel(error)})`);
      return null;
    }
  }
}
