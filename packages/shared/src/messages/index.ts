import { z } from 'zod';
import type { Locale } from '../utils/locale.js';
import enCommands from './en/commands.json';
import enCommon from './en/common.json';
import enErrors from './en/errors.json';
import enGuildConfig from './en/guild-config.json';
import enSystem from './en/system.json';
import viCommands from './vi/commands.json';
import viCommon from './vi/common.json';
import viErrors from './vi/errors.json';
import viGuildConfig from './vi/guild-config.json';
import viSystem from './vi/system.json';

/** Discord rejects a command or option description longer than this. */
export const COMMAND_DESCRIPTION_MAX_LENGTH = 100;

/** One JSON file per language holds one namespace; the file name is the namespace. */
export const MessageNamespaceSchema = z.enum([
  'common',
  'commands',
  'errors',
  'system',
  'guild-config',
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
  },
  en: {
    common: enCommon,
    commands: enCommands,
    errors: enErrors,
    system: enSystem,
    'guild-config': enGuildConfig,
  },
} satisfies Record<Locale, Record<MessageNamespace, object>>;
