import type { GuildSettings, GuildSettingsPatch } from '@sab/shared';

/** What the settings form holds: a cleared picker is `undefined`/`null`, an emptied number is `null`. */
export interface SettingsFormValues {
  locale: GuildSettings['locale'];
  introChannelId?: string | null;
  logChannelId?: string | null;
  birthdayChannelId?: string | null;
  wordChannelId?: string | null;
  activityCategoryId?: string | null;
  wordMaxWords?: number | null;
}

const CHANNEL_FIELDS = [
  'introChannelId',
  'logChannelId',
  'birthdayChannelId',
  'wordChannelId',
  'activityCategoryId',
] as const;

/** The form's starting values, taken from what the server stores. */
export function toFormValues(settings: GuildSettings): SettingsFormValues {
  return {
    locale: settings.locale,
    introChannelId: settings.introChannelId,
    logChannelId: settings.logChannelId,
    birthdayChannelId: settings.birthdayChannelId,
    wordChannelId: settings.wordChannelId,
    activityCategoryId: settings.activityCategoryId,
    wordMaxWords: settings.wordMaxWords,
  };
}

/**
 * Only the fields that differ from what the server holds. A field left out of
 * the patch is left alone by the server, and `null` clears a channel, so a
 * cleared picker must come out as `null`, not as a missing key.
 */
export function diffSettings(
  initial: GuildSettings,
  current: SettingsFormValues,
): GuildSettingsPatch {
  const patch: GuildSettingsPatch = {};
  if (current.locale !== initial.locale) patch.locale = current.locale;
  for (const field of CHANNEL_FIELDS) {
    const next = current[field] ?? null;
    if (next !== initial[field]) patch[field] = next;
  }
  const words = current.wordMaxWords;
  if (typeof words === 'number' && words !== initial.wordMaxWords) patch.wordMaxWords = words;
  return patch;
}
