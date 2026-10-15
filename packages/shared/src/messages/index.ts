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
import enLogin from './en/login.json';
import enMention from './en/mention.json';
import enMessaging from './en/messaging.json';
import enNote from './en/note.json';
import enPurge from './en/purge.json';
import enRoleAssign from './en/role-assign.json';
import enSchedule from './en/schedule.json';
import enServers from './en/servers.json';
import enSystem from './en/system.json';
import enThread from './en/thread.json';
import enWeb from './en/web.json';
import enWordGame from './en/word-game.json';
import enMiniGame from './en/mini-game.json';
import enWebCommon from './en/web-common.json';
import enWebOverview from './en/web-overview.json';
import enWebSettings from './en/web-settings.json';
import enWebBirthday from './en/web-birthday.json';
import enWebNote from './en/web-note.json';
import enWebWordGame from './en/web-word-game.json';
import enWebApiKeys from './en/web-api-keys.json';
import enWebMessaging from './en/web-messaging.json';
import enWebSchedule from './en/web-schedule.json';
import enWebTools from './en/web-tools.json';
import enWebCommands from './en/web-commands.json';
import enWebAuditLog from './en/web-audit-log.json';
import viActivity from './vi/activity.json';
import viAttendance from './vi/attendance.json';
import viBirthday from './vi/birthday.json';
import viCommands from './vi/commands.json';
import viCommon from './vi/common.json';
import viErrors from './vi/errors.json';
import viGuildConfig from './vi/guild-config.json';
import viInfo from './vi/info.json';
import viLogin from './vi/login.json';
import viMention from './vi/mention.json';
import viMessaging from './vi/messaging.json';
import viNote from './vi/note.json';
import viPurge from './vi/purge.json';
import viRoleAssign from './vi/role-assign.json';
import viSchedule from './vi/schedule.json';
import viServers from './vi/servers.json';
import viSystem from './vi/system.json';
import viThread from './vi/thread.json';
import viWeb from './vi/web.json';
import viWordGame from './vi/word-game.json';
import viMiniGame from './vi/mini-game.json';
import viWebCommon from './vi/web-common.json';
import viWebOverview from './vi/web-overview.json';
import viWebSettings from './vi/web-settings.json';
import viWebBirthday from './vi/web-birthday.json';
import viWebNote from './vi/web-note.json';
import viWebWordGame from './vi/web-word-game.json';
import viWebApiKeys from './vi/web-api-keys.json';
import viWebMessaging from './vi/web-messaging.json';
import viWebSchedule from './vi/web-schedule.json';
import viWebTools from './vi/web-tools.json';
import viWebCommands from './vi/web-commands.json';
import viWebAuditLog from './vi/web-audit-log.json';

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
  'mini-game',
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
  'login',
  'servers',
  'web-common',
  'web-overview',
  'web-settings',
  'web-birthday',
  'web-note',
  'web-word-game',
  'web-messaging',
  'web-schedule',
  'web-tools',
  'web-commands',
  'web-audit-log',
  'web-api-keys',
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
    'mini-game': viMiniGame,
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
    login: viLogin,
    servers: viServers,
    'web-common': viWebCommon,
    'web-overview': viWebOverview,
    'web-settings': viWebSettings,
    'web-birthday': viWebBirthday,
    'web-note': viWebNote,
    'web-word-game': viWebWordGame,
    'web-messaging': viWebMessaging,
    'web-schedule': viWebSchedule,
    'web-tools': viWebTools,
    'web-commands': viWebCommands,
    'web-audit-log': viWebAuditLog,
    'web-api-keys': viWebApiKeys,
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
    'mini-game': enMiniGame,
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
    login: enLogin,
    servers: enServers,
    'web-common': enWebCommon,
    'web-overview': enWebOverview,
    'web-settings': enWebSettings,
    'web-birthday': enWebBirthday,
    'web-note': enWebNote,
    'web-word-game': enWebWordGame,
    'web-messaging': enWebMessaging,
    'web-schedule': enWebSchedule,
    'web-tools': enWebTools,
    'web-commands': enWebCommands,
    'web-audit-log': enWebAuditLog,
    'web-api-keys': enWebApiKeys,
  },
} satisfies Record<Locale, Record<MessageNamespace, object>>;
