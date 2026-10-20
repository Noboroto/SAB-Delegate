import { Logger } from '@nestjs/common';
import { EMAIL_ADDRESS_MAX, EMAIL_CODE_LENGTH } from '@sab/shared';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  LabelBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import { emailVerifyCustomId } from './email-verify.ids.js';

const logger = new Logger('EmailVerifyForms');

export const EMAIL_INPUT = 'email';
export const CODE_INPUT = 'code';

/** A label's description may hold this many characters. */
const LABEL_DESCRIPTION_MAX = 100;

/** The server's own text, cut to what a form label can show. */
function shortened(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= LABEL_DESCRIPTION_MAX
    ? flat
    : `${flat.slice(0, LABEL_DESCRIPTION_MAX - 1)}…`;
}

/**
 * The form that asks for the address. `serverText` is the server's own message
 * for the form (the description line under the label), if it has one. The
 * language is the person's own: a form must open without a lookup.
 */
export function buildEmailModal(
  locale: string,
  guildId: string,
  serverText: string | null,
): ModalBuilder {
  const t = translatorFor(locale);
  const input = new TextInputBuilder()
    .setCustomId(EMAIL_INPUT)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(3)
    .setMaxLength(EMAIL_ADDRESS_MAX)
    .setPlaceholder(t('email-verify.verify.modal.emailPlaceholder'));
  const label = new LabelBuilder()
    .setLabel(t('email-verify.verify.modal.emailLabel'))
    .setTextInputComponent(input);
  if (serverText !== null && shortened(serverText) !== '') {
    label.setDescription(shortened(serverText));
  }
  return new ModalBuilder()
    .setCustomId(emailVerifyCustomId('email', guildId))
    .setTitle(t('email-verify.verify.modal.emailTitle'))
    .addLabelComponents(label);
}

/** The form that asks for the code from the email. */
export function buildCodeModal(locale: string, guildId: string): ModalBuilder {
  const t = translatorFor(locale);
  const input = new TextInputBuilder()
    .setCustomId(CODE_INPUT)
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(EMAIL_CODE_LENGTH)
    .setMaxLength(EMAIL_CODE_LENGTH)
    .setPlaceholder(t('email-verify.verify.modal.codePlaceholder'));
  return new ModalBuilder()
    .setCustomId(emailVerifyCustomId('code', guildId))
    .setTitle(t('email-verify.verify.modal.codeTitle'))
    .addLabelComponents(
      new LabelBuilder()
        .setLabel(t('email-verify.verify.modal.codeLabel'))
        .setTextInputComponent(input),
    );
}

/** The buttons under "a code was sent": enter it, or ask for another. */
export function codeButtons(locale: string, guildId: string): ActionRowBuilder<ButtonBuilder> {
  const t = translatorFor(locale);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(emailVerifyCustomId('code', guildId))
      .setLabel(t('email-verify.verify.button.enterCode'))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(emailVerifyCustomId('resend', guildId))
      .setLabel(t('email-verify.verify.button.resend'))
      .setStyle(ButtonStyle.Secondary),
  );
}

/** The button of the welcome message sent by direct message. */
export function startButton(locale: string, guildId: string): ActionRowBuilder<ButtonBuilder> {
  const t = translatorFor(locale);
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(emailVerifyCustomId('start', guildId))
      .setLabel(t('email-verify.verify.panel.button'))
      .setStyle(ButtonStyle.Primary),
  );
}

/**
 * The server's own message for the address form, `null` when it has none or
 * the lookup failed: the form opens without it rather than not at all.
 */
export async function serverTextOf(
  config: Pick<EmailVerifyConfigService, 'get'>,
  guildId: string,
): Promise<string | null> {
  try {
    return (await config.get(guildId)).verifyMessage;
  } catch (error) {
    logger.warn(`Could not read the verify message of a server (${errorLabel(error)})`);
    return null;
  }
}
