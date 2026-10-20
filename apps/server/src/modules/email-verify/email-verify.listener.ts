import { Logger } from '@nestjs/common';
import { PermissionFlagsBits, type ActionRowBuilder, type ButtonBuilder } from 'discord.js';
import { Context, On, Once, type ContextOf } from 'necord';
import { DiscordReadyService } from '../../discord/discord-ready.service.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { ChannelQueue } from '../../discord/helpers/channel-queue.js';
import { failureLabel } from '../../discord/helpers/discord-failure.js';
import { discordErrorCode } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { roleMentions } from './email-verify.command-support.js';
import { startButton } from './email-verify.forms.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import { EmailVerifyInviteTracker, type InviteGuild } from './email-verify-invites.js';
import { EmailVerifyService } from './email-verify.service.js';

/** Cannot send messages to this user. */
const CANNOT_DM = 50007;

/** Longest one server's join handling may hold the queue (a listing and a few writes). */
const JOIN_TIMEOUT_MS = 30_000;

type GuildWithMe = InviteGuild & {
  readonly members: { readonly me: { readonly permissions: { has(bit: bigint): boolean } } | null };
};

/**
 * The slice of a member that joined which is read. Structural for the reason
 * given in `discord/helpers/reply.ts`: the member a Necord handler receives is
 * the same object at runtime but a separate declaration for the compiler.
 */
type JoinedMember = {
  readonly id: string;
  readonly user: { readonly bot: boolean };
  readonly guild: GuildWithMe & { readonly name: string; readonly preferredLocale: string };
  send(options: {
    content: string;
    components: ActionRowBuilder<ButtonBuilder>[];
    allowedMentions: { parse: [] };
  }): Promise<unknown>;
};

/** The bot may list this server's invites; a missing member entry is tried anyway. */
function mayListInvites(guild: GuildWithMe): boolean {
  return guild.members.me?.permissions.has(PermissionFlagsBits.ManageGuild) ?? true;
}

/**
 * What email verification does around joining a server: it follows the
 * server's invites to know which one a new member used, then gives the roles
 * of the rules for that invite, the "unverified" role, and sends the verify
 * button by direct message, as the server set up. Nothing here throws out of
 * a handler: a failure is logged and the member simply joins unchanged.
 */
@DiscordCommands()
export class EmailVerifyListener {
  private readonly logger = new Logger(EmailVerifyListener.name);
  /** One join at a time per server: two joins would otherwise claim the same invite use. */
  private readonly joins = new ChannelQueue(JOIN_TIMEOUT_MS, 'Handling a join');

  constructor(
    private readonly tracker: EmailVerifyInviteTracker,
    private readonly config: EmailVerifyConfigService,
    private readonly verify: EmailVerifyService,
    private readonly discord: EmailVerifyDiscordService,
    private readonly ready: DiscordReadyService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Once('clientReady')
  async onClientReady(@Context() [client]: ContextOf<'clientReady'>): Promise<void> {
    for (const guild of client.guilds.cache.values()) {
      // A long server list can still be running when shutdown begins.
      if (this.ready.isStopping()) return;
      await this.prime(guild);
    }
  }

  @On('guildCreate')
  async onGuildCreate(@Context() [guild]: ContextOf<'guildCreate'>): Promise<void> {
    await this.prime(guild);
  }

  @On('inviteCreate')
  onInviteCreate(@Context() [invite]: ContextOf<'inviteCreate'>): void {
    if (invite.guild !== null) this.tracker.onInviteCreate(invite.guild.id, invite);
  }

  @On('inviteDelete')
  onInviteDelete(@Context() [invite]: ContextOf<'inviteDelete'>): void {
    if (invite.guild !== null) this.tracker.onInviteDelete(invite.guild.id, invite);
  }

  @On('guildMemberAdd')
  async onMemberAdd(@Context() [member]: ContextOf<'guildMemberAdd'>): Promise<void> {
    if (this.ready.isStopping()) return;
    try {
      await this.joins.run(member.guild.id, () => this.handleJoin(member));
    } catch (error) {
      this.logger.error(`Handling a join failed (${errorLabel(error)})`);
    }
  }

  private async prime(guild: GuildWithMe): Promise<void> {
    if (!mayListInvites(guild)) return;
    try {
      await this.tracker.prime(guild);
    } catch (error) {
      this.logger.warn(`Could not follow the invites of a server (${errorLabel(error)})`);
    }
  }

  private async handleJoin(member: JoinedMember): Promise<void> {
    const { guild } = member;
    // The invite is claimed for every join, even when verification is off or
    // the member is a bot: the use counts must stay current.
    const code = mayListInvites(guild) ? await this.tracker.claimJoin(guild) : null;
    if (member.user.bot) return;

    // The rules of an invite do not depend on the verification switch: only
    // what needs a member to verify (the button, the unverified role) does.
    if (code !== null) await this.verify.recordJoinInvite(guild.id, member.id, code);
    const locale = await this.locales.resolve(guild.id, { guild });

    // Someone who verified before and came back gets their roles again, and
    // has nothing left to verify.
    const verified = await this.verify.verifiedGrant(guild.id, member.id);
    if (verified !== null) {
      await this.verify.applyVerified(guild.id, member.id, verified, { rerun: true });
      return;
    }

    const config = await this.config.get(guild.id);
    const joinRoles = await this.verify.rolesForJoin(guild.id, code);
    const add = [...joinRoles];
    if (config.enabled && config.autoUnverifiedOnJoin && config.unverifiedRoleId !== null) {
      add.push(config.unverifiedRoleId);
    }

    const t = translatorFor(locale);
    if (add.length > 0) {
      const granted = await this.discord.grantRoles(guild.id, member.id, { add });
      if (granted.failure !== null) {
        await this.discord.postLog(
          guild.id,
          t('email-verify.log.roleFailed', { user: `<@${member.id}>`, reason: granted.failure }),
        );
      } else if (code !== null && joinRoles.length > 0) {
        await this.discord.postLog(
          guild.id,
          t('email-verify.log.inviteGranted', {
            user: `<@${member.id}>`,
            code,
            roles: roleMentions(joinRoles, t('email-verify.status.none')),
          }),
        );
      }
    }

    if (config.enabled && config.autoVerifyOnJoin) await this.sendButton(member, locale);
  }

  /** A member who closed their direct messages simply does not get the button. */
  private async sendButton(member: JoinedMember, locale: string): Promise<void> {
    try {
      await member.send({
        content: translatorFor(locale)('email-verify.verify.panel.dm', {
          server: member.guild.name,
        }),
        components: [startButton(locale, member.guild.id)],
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      if (discordErrorCode(error) === CANNOT_DM) return;
      this.logger.warn(`Could not send the verify button (${failureLabel(error)})`);
    }
  }
}
