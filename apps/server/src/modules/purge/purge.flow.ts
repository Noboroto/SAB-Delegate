import { Injectable } from '@nestjs/common';
import {
  ErrorCode,
  PURGE_RANGE_MAX,
  parseMessageRef,
  type ActorContext,
  type PurgePlan,
  type PurgeResult,
} from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import { confirmWithButtons, showResult } from '../../discord/helpers/confirm-buttons.js';
import { PurgeService } from './purge.service.js';

type PurgeSelection =
  | { kind: 'range'; channelId: string; untilMessageId: string; fromMessageId?: string }
  | { kind: 'last'; channelId: string; count: number; fromMessageId?: string };

/** What `/purge any` was given, before any of it is checked. */
type PurgeCommandInput = {
  untilLink?: string;
  fromLink?: string;
  count?: number;
};

/** An interaction that has been deferred privately and is answered through its own reply. */
type PurgeInteraction = Parameters<typeof confirmWithButtons>[0] &
  Parameters<typeof showResult>[0] & {
    readonly guildId: string | null;
    readonly channelId: string;
    readonly locale: string;
    readonly guildLocale?: string | null;
  };

type Translate = ReturnType<typeof translatorFor>;

type Parsed = { ok: true; selection: PurgeSelection } | { ok: false; text: string };

/**
 * The conversation behind `/purge any` and "Purge up to here": check what was
 * asked, show how many messages that is, ask for confirmation, delete. The
 * deletion calls the same service method the preview came from, anchored at the
 * newest message the preview saw, so messages posted while the question was
 * open are not swept up. Both entry points defer the reply as private first.
 */
@Injectable()
export class PurgeFlow {
  constructor(
    private readonly purge: PurgeService,
    private readonly locales: GuildLocaleService,
  ) {}

  /** `/purge any`: `until-link` xor `count`, with an optional `from-link` next to `until-link`. */
  async runCommand(interaction: PurgeInteraction, input: PurgeCommandInput): Promise<void> {
    const guildId = this.guildOf(interaction);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const parsed = parseCommandInput(t, interaction.channelId, input);
    if (!parsed.ok) {
      await showResult(interaction, parsed.text);
      return;
    }
    await this.confirmAndRun(interaction, guildId, t, parsed.selection);
  }

  /** The context menu: everything newer than the chosen message, which stays. */
  async run(interaction: PurgeInteraction, selection: PurgeSelection): Promise<void> {
    const guildId = this.guildOf(interaction);
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    await this.confirmAndRun(interaction, guildId, t, selection);
  }

  private async confirmAndRun(
    interaction: PurgeInteraction,
    guildId: string,
    t: Translate,
    selection: PurgeSelection,
  ): Promise<void> {
    const actor: ActorContext = { source: 'DISCORD', userId: interaction.user.id };

    const plan = await this.call(guildId, selection, actor, true);
    if (plan.status !== 'OK') {
      await showResult(interaction, refusalText(t, plan.status));
      return;
    }
    if (plan.count === 0) {
      await showResult(interaction, t('purge.nothing'));
      return;
    }

    const question = t(
      selection.kind === 'range' ? 'purge.confirm.promptRange' : 'purge.confirm.promptLast',
      { count: plan.count },
    );
    const outcome = await confirmWithButtons(interaction, {
      prompt:
        plan.olderCount > 0
          ? `${question}\n${t('purge.confirm.olderNote', { older: plan.olderCount })}`
          : question,
      confirmLabel: t('purge.confirm.confirmButton'),
      cancelLabel: t('purge.confirm.cancelButton'),
      working: t('purge.confirm.working'),
      cancelled: t('purge.confirm.cancelled'),
      expired: t('purge.confirm.expired'),
    });
    if (outcome !== 'confirmed') return;

    const result = await this.call(guildId, anchored(selection, plan), actor, false);
    await showResult(interaction, resultText(t, result));
  }

  private call(
    guildId: string,
    selection: PurgeSelection,
    actor: ActorContext,
    dryRun: true,
  ): Promise<PurgePlan>;
  private call(
    guildId: string,
    selection: PurgeSelection,
    actor: ActorContext,
    dryRun: false,
  ): Promise<PurgeResult>;
  private call(
    guildId: string,
    selection: PurgeSelection,
    actor: ActorContext,
    dryRun: boolean,
  ): Promise<PurgePlan | PurgeResult> {
    return selection.kind === 'range'
      ? this.purge.purgeRange(guildId, selection, actor, { dryRun })
      : this.purge.purgeLast(guildId, selection, actor, { dryRun });
  }

  /** The commands are offered in direct messages too (see AGENTS.md); a purge needs a server. */
  private guildOf(interaction: PurgeInteraction): string {
    if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
    return interaction.guildId;
  }
}

/** The selection with its start pinned to the newest message the preview saw. */
function anchored(selection: PurgeSelection, plan: PurgePlan): PurgeSelection {
  if (plan.fromMessageId === null) return selection;
  if (selection.kind === 'range') {
    return { ...selection, fromMessageId: selection.fromMessageId ?? plan.fromMessageId };
  }
  return { ...selection, fromMessageId: plan.fromMessageId };
}

function parseCommandInput(t: Translate, channelId: string, input: PurgeCommandInput): Parsed {
  const { untilLink, fromLink, count } = input;
  if (count !== undefined && untilLink !== undefined) {
    return { ok: false, text: t('purge.untilAndCountConflict') };
  }
  if (count !== undefined && fromLink !== undefined) {
    return { ok: false, text: t('purge.fromWithCount') };
  }
  if (count !== undefined) return { ok: true, selection: { kind: 'last', channelId, count } };
  if (untilLink === undefined) return { ok: false, text: t('purge.needsUntilOrCount') };

  const until = messageInChannel(t, untilLink, channelId);
  if (!until.ok) return until;
  if (fromLink === undefined) {
    return {
      ok: true,
      selection: { kind: 'range', channelId, untilMessageId: until.messageId },
    };
  }
  const from = messageInChannel(t, fromLink, channelId);
  if (!from.ok) return from;
  return {
    ok: true,
    selection: {
      kind: 'range',
      channelId,
      untilMessageId: until.messageId,
      fromMessageId: from.messageId,
    },
  };
}

/** Deleting is destructive and the link is typed by a person: only this channel is touched. */
function messageInChannel(
  t: Translate,
  link: string,
  channelId: string,
): { ok: true; messageId: string } | { ok: false; text: string } {
  const ref = parseMessageRef(link, { channelId });
  if (!ref.ok) return { ok: false, text: t(`errors.invalidLink.${ref.reason}`) };
  if (ref.channelId !== channelId) return { ok: false, text: t('purge.wrongChannel') };
  return { ok: true, messageId: ref.messageId };
}

function refusalText(t: Translate, status: Exclude<PurgePlan['status'], 'OK'>): string {
  return t(`purge.${status}`, { max: PURGE_RANGE_MAX });
}

function resultText(t: Translate, result: PurgeResult): string {
  if (result.status !== 'OK') return refusalText(t, result.status);
  if (result.count === 0) return t('purge.nothing');
  return (
    t('purge.done', { deleted: result.deleted }) +
    (result.failed > 0 ? t('purge.failedSuffix', { failed: result.failed }) : '')
  );
}
