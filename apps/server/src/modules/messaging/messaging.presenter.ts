import { Logger } from '@nestjs/common';
import { ErrorCode, type ActorContext, type EditBotMessageResult } from '@sab/shared';
import { replyInChunks } from '../../discord/helpers/reply.js';
import type { MessageResolution } from '../../discord/services/message-resolver.service.js';
import type { translatorFor } from '../../i18n/translator.js';
import { errorLabel } from '../../prisma/pool-factory.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { discordReasonOf } from './messaging.errors.js';

export type Translator = ReturnType<typeof translatorFor>;

type Answerable = Parameters<typeof replyInChunks>[0];

/** The failures of a failed write that a command words itself, as the old bot did. */
type Verb = 'send' | 'copy' | 'edit' | 'react' | 'poll';

const logger = new Logger('Messaging');

export function slashActor(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/** The channel a command ran in; a command always has one. */
export function channelOf(interaction: { readonly channelId: string | null }): string {
  if (interaction.channelId === null) throw new ServiceError(ErrorCode.DISCORD_CHANNEL_NOT_FOUND);
  return interaction.channelId;
}

/** Why a message could not be found from what the person typed, in their words. */
export function resolutionProblem(
  t: Translator,
  resolution: Exclude<MessageResolution, { status: 'OK' }>,
): string {
  switch (resolution.status) {
    case 'INVALID_LINK':
      return t(`errors.invalidLink.${resolution.reason}`);
    case 'NOT_FOUND':
      return t('errors.DISCORD_MESSAGE_NOT_FOUND');
    case 'NO_ACCESS':
      return t('errors.DISCORD_MISSING_PERMISSIONS', { permission: 'view' });
  }
}

/** The answer to an edit; `NOTHING_TO_COPY` only comes from editing with another message's content. */
export function describeEdit(t: Translator, status: EditBotMessageResult['status']): string {
  switch (status) {
    case 'EDITED':
      return t('messaging.done');
    case 'NOT_BOT_MESSAGE':
      return t('messaging.notBotMessage');
    case 'NOTHING_TO_COPY':
      return t('messaging.nothingToCopy.new');
  }
}

/**
 * Runs `work` and answers (privately) with the text it returns. When Discord
 * itself refused, the answer is "Cannot <verb>: <Discord's reason>" like the
 * old bot's; any other failure goes on to the exception filter.
 */
export async function answerPrivately(
  interaction: Answerable,
  t: Translator,
  verb: Verb,
  work: () => Promise<string>,
  placeholders: Record<string, string> = {},
): Promise<void> {
  let text: string;
  try {
    text = await work();
  } catch (error) {
    const reason = discordReasonOf(error);
    if (reason === undefined) throw error;
    logger.warn(`${verb} refused by Discord (${errorLabel(error)})`);
    text = t(`messaging.cannot.${verb}`, { ...placeholders, reason });
  }
  await replyInChunks(interaction, text, { ephemeral: true });
}
