import { EMAIL_VERIFY_MESSAGE_MAX, ROLES_MAX, type EmailVerifyConfigPatch } from '@sab/shared';
import {
  AttachmentBuilder,
  ChannelType,
  type ApplicationCommandOptionAllowedChannelType,
} from 'discord.js';
import {
  BooleanOption,
  ChannelOption,
  Context,
  RoleOption,
  StringOption,
  Subcommand,
  UserOption,
  type SlashCommandContext,
} from 'necord';
import { EmailVerifyGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { Options } from '../../discord/decorators/options.decorator.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { showResult } from '../../discord/helpers/confirm-buttons.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import {
  NO_PING,
  PRIVATE,
  actorOf,
  confirmed,
  guildOf,
  optionMeta,
  roleMentions,
  subcommandMeta,
} from './email-verify.command-support.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyDiscordService } from './email-verify-discord.service.js';
import { EmailVerifyMembersService } from './email-verify-members.service.js';
import { maskEmail } from './email-mask.js';
import { EmailVerifyService } from './email-verify.service.js';

const POST_CHANNEL_TYPES: ApplicationCommandOptionAllowedChannelType[] = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
];

const LOG_CHANNEL_TYPES = POST_CHANNEL_TYPES;

type Ref = { readonly id: string };

class ButtonOptions {
  @ChannelOption({
    name: 'channel',
    ...optionMeta('channel'),
    channel_types: POST_CHANNEL_TYPES,
    required: true,
  })
  readonly channel!: Ref;

  @StringOption({ name: 'title', ...optionMeta('title'), required: false, max_length: 256 })
  readonly title?: string;

  @StringOption({ name: 'message', ...optionMeta('message'), required: false, max_length: 2000 })
  readonly message?: string;

  @StringOption({
    name: 'button-text',
    ...optionMeta('buttonText'),
    required: false,
    max_length: 80,
  })
  readonly buttonText?: string;
}

class ManualOptions {
  @UserOption({ name: 'user', ...optionMeta('user'), required: true })
  readonly user!: Ref;

  @StringOption({ name: 'email', ...optionMeta('email'), required: true, max_length: 254 })
  readonly email!: string;
}

class UnverifyOptions {
  @UserOption({ name: 'user', ...optionMeta('user'), required: true })
  readonly user!: Ref;

  @BooleanOption({ name: 'remove-roles', ...optionMeta('removeRoles'), required: false })
  readonly removeRoles?: boolean;
}

class TestMailOptions {
  @StringOption({ name: 'email', ...optionMeta('email'), required: true, max_length: 254 })
  readonly email!: string;
}

class ConfigOptions {
  @BooleanOption({ name: 'enabled', ...optionMeta('enabled'), required: false })
  readonly enabled?: boolean;

  @RoleOption({ name: 'unverified-role', ...optionMeta('unverifiedRole'), required: false })
  readonly unverifiedRole?: Ref;

  @ChannelOption({
    name: 'log-channel',
    ...optionMeta('logChannel'),
    channel_types: LOG_CHANNEL_TYPES,
    required: false,
  })
  readonly logChannel?: Ref;

  @BooleanOption({ name: 'auto-verify', ...optionMeta('autoVerify'), required: false })
  readonly autoVerify?: boolean;

  @BooleanOption({ name: 'auto-unverified', ...optionMeta('autoUnverified'), required: false })
  readonly autoUnverified?: boolean;

  @StringOption({
    name: 'verify-message',
    ...optionMeta('verifyMessage'),
    required: false,
    min_length: 1,
    max_length: EMAIL_VERIFY_MESSAGE_MAX,
  })
  readonly verifyMessage?: string;
}

class RoleOptions {
  @RoleOption({ name: 'role', ...optionMeta('role'), required: true })
  readonly role!: Ref;
}

/**
 * `/email-verify status|button|manual|unverify|test-mail|config|role-add|role-remove|export`.
 * Who may run them is decided by the group's default permission in Discord;
 * nothing is checked here. Every answer is private, and none shows an address
 * in full or a code.
 */
@DiscordCommands()
@EmailVerifyGroup()
export class EmailVerifyCommands {
  constructor(
    private readonly verify: EmailVerifyService,
    private readonly config: EmailVerifyConfigService,
    private readonly members: EmailVerifyMembersService,
    private readonly discord: EmailVerifyDiscordService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand(subcommandMeta('emailVerify.status', 'status'))
  async onStatus(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const [status, config, locale] = await Promise.all([
      this.verify.status(guildId),
      this.config.get(guildId),
      this.locales.resolve(guildId, interaction),
    ]);
    const t = translatorFor(locale);
    const lines = [
      `**${t('email-verify.status.title')}**`,
      `${t('email-verify.status.enabled')}: ${t(status.enabled ? 'email-verify.status.on' : 'email-verify.status.off')}`,
      `${t('email-verify.status.smtp')}: ${t(status.smtpReady ? 'email-verify.status.smtpReady' : 'email-verify.status.smtpNotReady')}`,
      `${t('email-verify.status.verified')}: ${status.verified}`,
      `${t('email-verify.status.pending')}: ${status.pending}`,
      `${t('email-verify.status.rules')}: ${status.rules}`,
      `${t('email-verify.status.lists')}: ${status.lists}`,
      `${t('email-verify.status.sentToday')}: ${t('email-verify.status.sentTodayValue', { count: status.sentToday, cap: status.dailyCap })}`,
      `${t('email-verify.status.defaultRoles')}: ${roleMentions(config.defaultRoleIds, t('email-verify.status.none'))}`,
    ];
    await replyInChunks(interaction, lines.join('\n'), {
      ephemeral: true,
      allowedMentions: NO_PING,
    });
  }

  @Subcommand(subcommandMeta('emailVerify.button', 'button'))
  async onButton(
    @Context() [interaction]: SlashCommandContext,
    @Options() { channel, title, message, buttonText }: ButtonOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    await this.discord.postButton(
      guildId,
      {
        channelId: channel.id,
        ...(title === undefined ? {} : { title }),
        ...(message === undefined ? {} : { message }),
        ...(buttonText === undefined ? {} : { buttonText }),
      },
      actorOf(interaction),
    );
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await replyInChunks(
      interaction,
      t('email-verify.verify.buttonPosted', { channel: `<#${channel.id}>` }),
      { ephemeral: true, allowedMentions: NO_PING },
    );
  }

  @Subcommand(subcommandMeta('emailVerify.manual', 'manual'))
  async onManual(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, email }: ManualOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const { grant } = await this.members.manualVerify(
      guildId,
      { userId: user.id, email },
      actorOf(interaction),
    );
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const mention = `<@${user.id}>`;
    const lines = [t('email-verify.verify.manualDone', { user: mention })];
    if (grant?.failure != null) {
      lines.push(t('email-verify.log.roleFailed', { user: mention, reason: grant.failure }));
    }
    await replyInChunks(interaction, lines.join('\n'), {
      ephemeral: true,
      allowedMentions: NO_PING,
    });
  }

  @Subcommand(subcommandMeta('emailVerify.unverify', 'unverify'))
  async onUnverify(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, removeRoles }: UnverifyOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const actor = actorOf(interaction);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const mention = `<@${user.id}>`;
    const options = { removeRoles: removeRoles === true };

    const preview = await this.members.revoke(guildId, user.id, actor, {
      ...options,
      dryRun: true,
    });
    if (!preview.removed) {
      await showResult(interaction, t('email-verify.verify.notVerified', { user: mention }));
      return;
    }
    const prompt = t(
      options.removeRoles ? 'email-verify.confirm.unverifyRoles' : 'email-verify.confirm.unverify',
      { user: mention },
    );
    if (!(await confirmed(interaction, t, prompt))) return;

    const result = await this.members.revoke(guildId, user.id, actor, options);
    const lines = [t('email-verify.verify.unverified', { user: mention })];
    if (result.grant?.failure != null) {
      lines.push(t('email-verify.log.roleFailed', { user: mention, reason: result.grant.failure }));
    }
    await showResult(interaction, lines.join('\n'));
  }

  @Subcommand(subcommandMeta('emailVerify.testMail', 'test-mail'))
  async onTestMail(
    @Context() [interaction]: SlashCommandContext,
    @Options() { email }: TestMailOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const locale = await this.locales.resolve(guildId, interaction);
    await this.verify.testMail(guildId, { email }, actorOf(interaction), locale);
    await replyInChunks(
      interaction,
      translatorFor(locale)('email-verify.verify.testMailSent', {
        email: maskEmail(email.trim().toLowerCase()),
      }),
      { ephemeral: true },
    );
  }

  @Subcommand(subcommandMeta('emailVerify.config', 'config'))
  async onConfig(
    @Context() [interaction]: SlashCommandContext,
    @Options()
    {
      enabled,
      unverifiedRole,
      logChannel,
      autoVerify,
      autoUnverified,
      verifyMessage,
    }: ConfigOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const patch: EmailVerifyConfigPatch = {
      ...(enabled === undefined ? {} : { enabled }),
      ...(unverifiedRole === undefined ? {} : { unverifiedRoleId: unverifiedRole.id }),
      ...(logChannel === undefined ? {} : { logChannelId: logChannel.id }),
      ...(autoVerify === undefined ? {} : { autoVerifyOnJoin: autoVerify }),
      ...(autoUnverified === undefined ? {} : { autoUnverifiedOnJoin: autoUnverified }),
      ...(verifyMessage === undefined ? {} : { verifyMessage }),
    };
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    if (Object.keys(patch).length === 0) {
      await replyInChunks(interaction, t('email-verify.config.nothing'), { ephemeral: true });
      return;
    }
    await this.config.patch(guildId, patch, actorOf(interaction));
    await replyInChunks(interaction, t('email-verify.config.saved'), { ephemeral: true });
  }

  @Subcommand(subcommandMeta('emailVerify.roleAdd', 'role-add'))
  async onRoleAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role }: RoleOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { defaultRoleIds } = await this.config.get(guildId);
    if (!defaultRoleIds.includes(role.id)) {
      if (defaultRoleIds.length >= ROLES_MAX) {
        await replyInChunks(interaction, t('email-verify.config.roleFull', { max: ROLES_MAX }), {
          ephemeral: true,
        });
        return;
      }
      await this.config.patch(
        guildId,
        { defaultRoleIds: [...defaultRoleIds, role.id] },
        actorOf(interaction),
      );
    }
    await replyInChunks(
      interaction,
      t('email-verify.config.roleAdded', { role: `<@&${role.id}>` }),
      {
        ephemeral: true,
        allowedMentions: NO_PING,
      },
    );
  }

  @Subcommand(subcommandMeta('emailVerify.roleRemove', 'role-remove'))
  async onRoleRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { role }: RoleOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { defaultRoleIds } = await this.config.get(guildId);
    if (defaultRoleIds.includes(role.id)) {
      await this.config.patch(
        guildId,
        { defaultRoleIds: defaultRoleIds.filter((id) => id !== role.id) },
        actorOf(interaction),
      );
    }
    await replyInChunks(
      interaction,
      t('email-verify.config.roleRemoved', { role: `<@&${role.id}>` }),
      { ephemeral: true, allowedMentions: NO_PING },
    );
  }

  @Subcommand(subcommandMeta('emailVerify.export', 'export'))
  async onExport(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const file = await this.members.exportXlsx(guildId, actorOf(interaction));
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    if (file.count === 0) {
      await replyInChunks(interaction, t('email-verify.export.empty'), { ephemeral: true });
      return;
    }
    const sent = t('email-verify.export.sent', { count: file.count });
    await interaction.editReply({
      content:
        file.unresolved === 0
          ? sent
          : `${sent}\n${t('email-verify.export.unresolved', { count: file.unresolved })}`,
      files: [new AttachmentBuilder(file.buffer, { name: file.fileName })],
    });
  }
}
