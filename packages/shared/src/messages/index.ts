import { z } from 'zod';
import type { Locale } from '../utils/locale.js';
import enActivity from './en/activity.json';
import enAttendance from './en/attendance.json';
import enBirthday from './en/birthday.json';
import enCommands from './en/commands.json';
import enCommon from './en/common.json';
import enErrors from './en/errors.json';
import enGuildConfig from './en/guild-config.json';
import enInfo from './en/info.json';
import enMention from './en/mention.json';
import enMessaging from './en/messaging.json';
import enNote from './en/note.json';
import enPurge from './en/purge.json';
import enRoleAssign from './en/role-assign.json';
import enSchedule from './en/schedule.json';
import enSystem from './en/system.json';
import enThread from './en/thread.json';
import enWeb from './en/web.json';
import enWordGame from './en/word-game.json';
import viActivity from './vi/activity.json';
import viAttendance from './vi/attendance.json';
import viBirthday from './vi/birthday.json';
import viCommands from './vi/commands.json';
import viCommon from './vi/common.json';
import viErrors from './vi/errors.json';
import viGuildConfig from './vi/guild-config.json';
import viInfo from './vi/info.json';
import viMention from './vi/mention.json';
import viMessaging from './vi/messaging.json';
import viNote from './vi/note.json';
import viPurge from './vi/purge.json';
import viRoleAssign from './vi/role-assign.json';
import viSchedule from './vi/schedule.json';
import viSystem from './vi/system.json';
import viThread from './vi/thread.json';
import viWeb from './vi/web.json';
import viWordGame from './vi/word-game.json';

/** Discord rejects a command or option description longer than this. */
export const COMMAND_DESCRIPTION_MAX_LENGTH = 100;

/** One JSON file per language holds one namespace; the file name is the namespace. */
export const MessageNamespaceSchema = z.enum([
  'common',
  'commands',
  'errors',
  'system',
  'guild-config',
  'birthday',
  'note',
  'word-game',
  'schedule',
  'messaging',
  'mention',
  'role-assign',
  'thread',
  'purge',
  'activity',
  'attendance',
  'info',
  'web',
]);

export type MessageNamespace = z.infer<typeof MessageNamespaceSchema>;

/**
 * The whole catalog, shared by the bot and the web app. Typed per language so
 * a namespace missing from one of them fails to compile, not at runtime.
 */
export const MESSAGES = {
  vi: {
    common: viCommon,
    commands: viCommands,
    errors: viErrors,
    system: viSystem,
    'guild-config': viGuildConfig,
    birthday: viBirthday,
    note: viNote,
    'word-game': viWordGame,
    schedule: viSchedule,
    messaging: viMessaging,
    mention: viMention,
    'role-assign': viRoleAssign,
    thread: viThread,
    purge: viPurge,
    activity: viActivity,
    attendance: viAttendance,
    info: viInfo,
    web: viWeb,
  },
  en: {
    common: enCommon,
    commands: enCommands,
    errors: enErrors,
    system: enSystem,
    'guild-config': enGuildConfig,
    birthday: enBirthday,
    note: enNote,
    'word-game': enWordGame,
    schedule: enSchedule,
    messaging: enMessaging,
    mention: enMention,
    'role-assign': enRoleAssign,
    thread: enThread,
    purge: enPurge,
    activity: enActivity,
    attendance: enAttendance,
    info: enInfo,
    web: enWeb,
  },
} satisfies Record<Locale, Record<MessageNamespace, object>>;
