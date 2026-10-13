import {
  MESSAGE_MAX_LENGTH,
  SCHEDULE_DESCRIPTION_MAX_LENGTH,
  ScheduleFailureSchema,
  formatDiscordTimestamp,
  type ScheduleCancelResult,
  type ScheduledMessageView,
} from '@sab/shared';
import type { translatorFor } from '../../i18n/translator.js';

type Translator = ReturnType<typeof translatorFor>;

/** The name `/scheduler get` has always printed in brackets. */
const COMMAND_OF_KIND = { SEND: 'schedule-send', COPY: 'schedule-copy' } as const;

/** One line of plain words; a newline in the text would break the entry's layout. */
function singleLine(text: string): string {
  return text.replaceAll(/\s+/g, ' ').trim();
}

function describe(t: Translator, view: ScheduledMessageView): string {
  const channel = `<#${view.channelId}>`;
  const text =
    view.kind === 'SEND'
      ? t('schedule.list.descriptionSend', {
          channel,
          content: singleLine(view.content ?? ''),
        })
      : t('schedule.list.descriptionCopy', {
          channel,
          source: `<#${view.sourceChannelId ?? ''}> ${view.sourceMessageId ?? ''}`.trim(),
        });
  return text.slice(0, SCHEDULE_DESCRIPTION_MAX_LENGTH);
}

/** The reason a message did not go out, in words; an unknown label is shown as stored. */
function reasonOf(t: Translator, lastError: string): string {
  const failure = ScheduleFailureSchema.safeParse(lastError);
  return failure.success ? t(`schedule.failure.${failure.data}`) : lastError;
}

/** A scheduled message that ended shows a tag in front of its title. */
function stateTag(t: Translator, status: ScheduledMessageView['status']): string {
  switch (status) {
    case 'CANCELED':
      return `${t('schedule.list.state.CANCELED')} `;
    case 'SENT':
      return `${t('schedule.list.state.SENT')} `;
    case 'FAILED':
      return `${t('schedule.list.state.FAILED')} `;
    default:
      return '';
  }
}

/**
 * One scheduled message as `/scheduler get` prints it:
 *
 *     ## (End) [schedule-send] - 3
 *     **Author**: ...
 *
 * A canceled one carries the `(End)` tag the command always used; a sent or
 * failed one carries its own. The author is a mention, which shows the name
 * and, with the client's no-ping default, notifies nobody.
 */
export function formatScheduleEntry(t: Translator, view: ScheduledMessageView): string {
  const entry = t('schedule.list.entry', {
    state: stateTag(t, view.status),
    command: COMMAND_OF_KIND[view.kind],
    seq: view.seq,
    author: `<@${view.createdByUserId}>`,
    description: describe(t, view),
    time: formatDiscordTimestamp(view.runAt),
    created: formatDiscordTimestamp(view.createdAt),
  });
  return view.lastError === null
    ? entry
    : entry + t('schedule.list.error', { error: reasonOf(t, view.lastError) });
}

/**
 * Packs entries into messages of at most `max` characters without cutting an
 * entry in two, so each message reads on its own. An entry longer than `max`
 * (it cannot be, with the description capped) is sent on its own and left to
 * the caller's chunking.
 */
export function packEntries(
  entries: readonly string[],
  max: number = MESSAGE_MAX_LENGTH,
): string[] {
  const messages: string[] = [];
  let current = '';
  for (const entry of entries) {
    if (current !== '' && current.length + 1 + entry.length > max) {
      messages.push(current);
      current = entry;
    } else {
      current = current === '' ? entry : `${current}\n${entry}`;
    }
  }
  if (current !== '') messages.push(current);
  return messages;
}

/** The sentence `/scheduler cancel` answers with. */
export function describeCancel(t: Translator, result: ScheduleCancelResult): string {
  switch (result.code) {
    case 'CANCELED':
      return t('schedule.canceled', { seq: result.seq });
    case 'ALREADY_CANCELED':
      return t('schedule.alreadyCanceled', { seq: result.seq });
    case 'NOT_FOUND':
      return t('schedule.notFound', { seq: result.seq });
    case 'NOT_PENDING':
      if (result.status === 'SENT') return t('schedule.notPending.SENT', { seq: result.seq });
      if (result.status === 'FAILED') return t('schedule.notPending.FAILED', { seq: result.seq });
      return t('schedule.notPending.SENDING', { seq: result.seq });
  }
}
