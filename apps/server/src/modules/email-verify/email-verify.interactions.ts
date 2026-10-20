import { EMAIL_CODE_TTL_MINUTES, ErrorCode, SnowflakeSchema } from '@sab/shared';
import {
  Button,
  ComponentParam,
  Context,
  Modal,
  ModalParam,
  type ButtonContext,
  type ModalContext,
} from 'necord';
import { ServiceError } from '../../common/errors/service-error.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { showModalFirst } from '../../discord/helpers/modal.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { NO_PING, PRIVATE, roleMentions } from './email-verify.command-support.js';
import {
  CODE_INPUT,
  EMAIL_INPUT,
  buildCodeModal,
  buildEmailModal,
  codeButtons,
  serverTextOf,
} from './email-verify.forms.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';
import { EmailVerifyService, type RequestCodeResult } from './email-verify.service.js';

type CodeSent = Extract<RequestCodeResult, { status: 'SENT' }>;
type AlreadyVerified = Extract<RequestCodeResult, { status: 'ALREADY_VERIFIED' }>;

/**
 * The server a verify button or form is for: the id at the end of its custom
 * id, which a person can pick by hand with a crafted interaction, so it is
 * checked like any other input.
 */
function serverOf(raw: string): string {
  const parsed = SnowflakeSchema.safeParse(raw);
  if (!parsed.success) throw new ServiceError(ErrorCode.VALIDATION_FAILED);
  return parsed.data;
}

/**
 * The verify button and its two forms: `ev/start|code|resend/<server>` buttons
 * and `ev/email|code/<server>` forms. They work in a server and in a direct
 * message (the welcome button), so the server comes from the custom id, never
 * from the interaction. Answers are private. An error is a `ServiceError` and
 * is answered privately by the exception filter.
 */
@DiscordCommands()
export class EmailVerifyInteractions {
  constructor(
    private readonly verify: EmailVerifyService,
    private readonly config: EmailVerifyConfigService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Button('ev/start/:guildId')
  async onStart(
    @Context() [interaction]: ButtonContext,
    @ComponentParam('guildId') rawGuildId: string,
  ): Promise<void> {
    const guildId = serverOf(rawGuildId);
    const text = await serverTextOf(this.config, guildId);
    await showModalFirst(interaction, buildEmailModal(interaction.locale, guildId, text));
  }

  @Modal('ev/email/:guildId')
  async onEmailForm(
    @Context() [interaction]: ModalContext,
    @ModalParam('guildId') rawGuildId: string,
  ): Promise<void> {
    const guildId = serverOf(rawGuildId);
    const email = interaction.fields.getTextInputValue(EMAIL_INPUT);
    await interaction.deferReply({ flags: PRIVATE });

    const locale = await this.locales.resolve(guildId, interaction);
    const result = await this.verify.requestCode(guildId, interaction.user.id, email, locale);
    const t = translatorFor(locale);
    if (result.status === 'ALREADY_VERIFIED') {
      await interaction.editReply({
        content: await this.alreadyVerifiedText(guildId, interaction.user.id, t, result),
        allowedMentions: NO_PING,
      });
      return;
    }
    await interaction.editReply({
      content: this.sentText(locale, result),
      components: [codeButtons(locale, guildId)],
    });
  }

  @Button('ev/code/:guildId')
  async onCode(
    @Context() [interaction]: ButtonContext,
    @ComponentParam('guildId') rawGuildId: string,
  ): Promise<void> {
    await showModalFirst(interaction, buildCodeModal(interaction.locale, serverOf(rawGuildId)));
  }

  @Modal('ev/code/:guildId')
  async onCodeForm(
    @Context() [interaction]: ModalContext,
    @ModalParam('guildId') rawGuildId: string,
  ): Promise<void> {
    const guildId = serverOf(rawGuildId);
    const code = interaction.fields.getTextInputValue(CODE_INPUT);
    await interaction.deferReply({ flags: PRIVATE });

    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const userId = interaction.user.id;
    const result = await this.verify.confirmCode(guildId, userId, code);
    if (result.status === 'ALREADY_VERIFIED') {
      await interaction.editReply({
        content: await this.alreadyVerifiedText(guildId, userId, t, result),
        allowedMentions: NO_PING,
      });
      return;
    }
    if (result.status === 'NO_PENDING') {
      await interaction.editReply({ content: t('email-verify.verify.notStarted') });
      return;
    }

    const granted = await this.verify.applyVerified(guildId, userId, result);
    let content: string;
    if (granted.failure !== null) {
      content = t('email-verify.verify.roleFailed', { reason: granted.failure });
    } else if (result.addRoleIds.length > 0) {
      content = t('email-verify.verify.verifiedRoles', {
        roles: roleMentions(result.addRoleIds, t('email-verify.status.none')),
      });
    } else {
      content = t('email-verify.verify.verified');
    }
    await interaction.editReply({ content, allowedMentions: NO_PING });
  }

  @Button('ev/resend/:guildId')
  async onResend(
    @Context() [interaction]: ButtonContext,
    @ComponentParam('guildId') rawGuildId: string,
  ): Promise<void> {
    const guildId = serverOf(rawGuildId);
    await interaction.deferReply({ flags: PRIVATE });

    const locale = await this.locales.resolve(guildId, interaction);
    const result = await this.verify.resendCode(guildId, interaction.user.id, locale);
    const t = translatorFor(locale);
    if (result.status === 'NO_PENDING') {
      await interaction.editReply({ content: t('email-verify.verify.notStarted') });
      return;
    }
    await interaction.editReply({
      content: t('email-verify.verify.resent', { email: result.maskedEmail }),
      components: [codeButtons(locale, guildId)],
    });
  }

  /**
   * A member who is verified already asks again when a role went missing, so
   * what their verification gives is given again; the answer says so only when
   * something changed.
   */
  private async alreadyVerifiedText(
    guildId: string,
    userId: string,
    t: ReturnType<typeof translatorFor>,
    already: AlreadyVerified,
  ): Promise<string> {
    if (already.verified === null) return t('email-verify.verify.alreadyVerified');
    const granted = await this.verify.applyVerified(guildId, userId, already.verified, {
      rerun: true,
    });
    if (granted.failure !== null) {
      return t('email-verify.verify.roleFailed', { reason: granted.failure });
    }
    if (granted.added.length === 0) return t('email-verify.verify.alreadyVerified');
    return t('email-verify.verify.verifiedRoles', {
      roles: roleMentions(granted.added, t('email-verify.status.none')),
    });
  }

  private sentText(locale: string, sent: CodeSent): string {
    return translatorFor(locale)('email-verify.verify.codeSent', {
      email: sent.maskedEmail,
      minutes: EMAIL_CODE_TTL_MINUTES,
    });
  }
}
