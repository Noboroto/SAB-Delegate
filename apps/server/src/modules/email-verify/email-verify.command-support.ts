import { ErrorCode, type ActorContext, type MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { confirmWithButtons } from '../../discord/helpers/confirm-buttons.js';
import { localizations } from '../../i18n/localizations.js';
import type { translatorFor } from '../../i18n/translator.js';

export type Translate = ReturnType<typeof translatorFor>;

type CommandCatalog = (typeof MESSAGES)['en']['email-verify']['commands'];
type OptionName = keyof CommandCatalog['options'];
type Group = Exclude<keyof CommandCatalog, 'options'>;
/** `group.subcommand`, e.g. `emailRule.roleAdd`, the way the message catalog nests them. */
type SubcommandKey = {
  [G in Group]: `${G}.${Extract<keyof CommandCatalog[G], string>}`;
}[Group];

/** Name and localised descriptions of a subcommand, ready to spread into `@Subcommand`. */
export function subcommandMeta(key: SubcommandKey, name: string) {
  const text = localizations(`email-verify.commands.${key}.description`);
  return { name, description: text['en-US'], descriptionLocalizations: text };
}

/** Name-less description fields of an option, ready to spread into an option decorator. */
export function optionMeta(key: OptionName) {
  const text = localizations(`email-verify.commands.options.${key}.description`);
  return { description: text['en-US'], description_localizations: text };
}

/** Ephemeral: every answer of these commands is for the person who asked. */
export const PRIVATE = MessageFlags.Ephemeral;

/** Nothing in an answer may notify anybody: role and user mentions are only shown. */
export const NO_PING = { parse: [] } as const;

/** The email commands are offered in direct messages too (see AGENTS.md); there is no server there. */
export function guildOf(interaction: { readonly guildId: string | null }): string {
  if (interaction.guildId === null) throw new ServiceError(ErrorCode.GUILD_NOT_FOUND);
  return interaction.guildId;
}

export function actorOf(interaction: { readonly user: { readonly id: string } }): ActorContext {
  return { source: 'DISCORD', userId: interaction.user.id };
}

/** `<@&1> <@&2>`, or `none` for no role at all. */
export function roleMentions(roleIds: readonly string[], none: string): string {
  return roleIds.length === 0 ? none : roleIds.map((id) => `<@&${id}>`).join(' ');
}

/** The role ids given as options, left to right, without gaps or repeats. */
export function roleIdsOf(...roles: readonly ({ readonly id: string } | undefined)[]): string[] {
  const ids = roles.flatMap((role) => (role === undefined ? [] : [role.id]));
  return [...new Set(ids)];
}

type ConfirmTarget = Parameters<typeof confirmWithButtons>[0];

/**
 * Asks the person to confirm a destructive step with two buttons. `true` only
 * when they pressed the confirm one; the cancelled and expired answers are
 * already shown. The interaction must be deferred.
 */
export async function confirmed(
  interaction: ConfirmTarget,
  t: Translate,
  prompt: string,
): Promise<boolean> {
  const outcome = await confirmWithButtons(interaction, {
    prompt,
    confirmLabel: t('email-verify.confirm.confirm'),
    cancelLabel: t('email-verify.confirm.cancel'),
    working: t('email-verify.confirm.working'),
    cancelled: t('email-verify.confirm.cancelled'),
    expired: t('email-verify.confirm.expired'),
  });
  return outcome === 'confirmed';
}

/** Items of a pasted list: split at commas, spaces and line breaks, empty pieces dropped. */
export function splitItems(text: string, separator: RegExp = /[\s,;]+/): string[] {
  return text.split(separator).filter((item) => item !== '');
}
