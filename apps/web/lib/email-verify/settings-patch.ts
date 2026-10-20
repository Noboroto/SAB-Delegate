import type { EmailVerifyConfig, EmailVerifyConfigPatch } from '@sab/shared';

/** The settings form's fields; a cleared picker reads `undefined` or `null`. */
export interface SettingsValues {
  enabled: boolean;
  defaultRoleIds: string[];
  unverifiedRoleId: string | null | undefined;
  logChannelId: string | null | undefined;
  verifyMessage: string;
  autoVerifyOnJoin: boolean;
  autoUnverifiedOnJoin: boolean;
}

export function settingsFromConfig(config: EmailVerifyConfig): SettingsValues {
  return {
    enabled: config.enabled,
    defaultRoleIds: config.defaultRoleIds,
    unverifiedRoleId: config.unverifiedRoleId,
    logChannelId: config.logChannelId,
    verifyMessage: config.verifyMessage ?? '',
    autoVerifyOnJoin: config.autoVerifyOnJoin,
    autoUnverifiedOnJoin: config.autoUnverifiedOnJoin,
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',');

/**
 * Only the fields that differ from what the server holds. Sending the rest
 * would re-check them (a log channel that was deleted since, say) and write
 * them back for nothing; an empty patch means there is nothing to save.
 */
export function settingsPatch(
  values: SettingsValues,
  config: EmailVerifyConfig,
): EmailVerifyConfigPatch {
  const patch: EmailVerifyConfigPatch = {};
  if (values.enabled !== config.enabled) patch.enabled = values.enabled;
  if (!sameSet(values.defaultRoleIds, config.defaultRoleIds)) {
    patch.defaultRoleIds = values.defaultRoleIds;
  }
  const unverifiedRoleId = values.unverifiedRoleId ?? null;
  if (unverifiedRoleId !== config.unverifiedRoleId) patch.unverifiedRoleId = unverifiedRoleId;
  const logChannelId = values.logChannelId ?? null;
  if (logChannelId !== config.logChannelId) patch.logChannelId = logChannelId;
  const verifyMessage = values.verifyMessage.trim() === '' ? null : values.verifyMessage.trim();
  if (verifyMessage !== config.verifyMessage) patch.verifyMessage = verifyMessage;
  if (values.autoVerifyOnJoin !== config.autoVerifyOnJoin) {
    patch.autoVerifyOnJoin = values.autoVerifyOnJoin;
  }
  if (values.autoUnverifiedOnJoin !== config.autoUnverifiedOnJoin) {
    patch.autoUnverifiedOnJoin = values.autoUnverifiedOnJoin;
  }
  return patch;
}
