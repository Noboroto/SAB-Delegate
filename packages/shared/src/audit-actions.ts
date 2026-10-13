import { z } from 'zod';

/**
 * Every action an audit row can record, one per write operation. The values
 * are stored, so they are never renamed for tidiness: a changed string would
 * orphan the rows already written under the old one.
 */
export const AUDIT_ACTIONS = {
  guildConfigUpdate: 'guild_config.update',
  botProfileUpdate: 'bot_profile.update',
  birthdayAdd: 'birthday.add',
  birthdayRemove: 'birthday.remove',
  birthdayImport: 'birthday.import',
  noteUpsert: 'note.upsert',
  noteRemove: 'note.remove',
  wordGameConfigure: 'word_game.configure',
  wordGameReset: 'word_game.reset',
  scheduleCreate: 'schedule.create',
  scheduleCancel: 'schedule.cancel',
  messageSend: 'message.send',
  messageCopy: 'message.copy',
  messageReact: 'message.react',
  messageEdit: 'message.edit',
  pollCreate: 'poll.create',
  mentionReactors: 'mention.reactors',
  mentionNonReactors: 'mention.non_reactors',
  mentionEveryone: 'mention.everyone',
  roleAssignApply: 'role_assign.apply',
  threadCreate: 'thread.create',
  threadRename: 'thread.rename',
  threadDelete: 'thread.delete',
  privateThreadCreate: 'private_thread.create',
  purgeMessages: 'purge.messages',
  activityCreate: 'activity.create',
  apiKeyMint: 'api_key.mint',
  apiKeyRevoke: 'api_key.revoke',
} as const;

export const AuditActionSchema = z.enum(AUDIT_ACTIONS);

export type AuditAction = z.infer<typeof AuditActionSchema>;
