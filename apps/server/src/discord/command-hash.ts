import { createHash } from 'node:crypto';
import type { RESTPostAPIApplicationCommandsJSONBody } from 'discord.js';

export type CommandPayload = RESTPostAPIApplicationCommandsJSONBody;

const CHAT_INPUT = 1;

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Commands are keyed by type and name: a user command may share a chat command's name. */
function commandKey(command: Json): string {
  const type = typeof command['type'] === 'number' ? command['type'] : CHAT_INPUT;
  return `${String(type)}:${String(command['name'])}`;
}

function sortedByKey(commands: readonly Json[]): Json[] {
  return [...commands].sort((a, b) => commandKey(a).localeCompare(commandKey(b)));
}

/** Object keys sorted at every level, so equal data always serialises equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) {
    const entries = Object.keys(value)
      .sort()
      .flatMap((key) => {
        const entry = value[key];
        // JSON has no `undefined`; an unset optional field must not change the hash.
        return entry === undefined ? [] : [`${JSON.stringify(key)}:${canonicalJson(entry)}`];
      });
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * Fingerprint of what the bot wants registered, independent of command order
 * and key order. Array order inside a command (options, choices) is part of the
 * payload because Discord shows options in that order.
 */
export function commandHash(payload: readonly CommandPayload[]): string {
  return createHash('sha256')
    .update(canonicalJson(sortedByKey(payload as unknown as readonly Json[])))
    .digest('hex');
}

// Fields compared with what Discord reports. Everything else Discord adds
// (id, version, application_id, guild_id, dm_permission, ...) is not ours.
const COMMAND_KEYS = [
  'name',
  'description',
  'name_localizations',
  'description_localizations',
  'options',
  'default_member_permissions',
  'nsfw',
] as const;
// Discord fills these with its own defaults when a command does not set them,
// so they are compared only for a command that does.
const DEFAULTED_COMMAND_KEYS = ['contexts', 'integration_types'] as const;
const OPTION_KEYS = [
  'type',
  'name',
  'description',
  'name_localizations',
  'description_localizations',
  'required',
  'autocomplete',
  'choices',
  'channel_types',
  'min_value',
  'max_value',
  'min_length',
  'max_length',
] as const;

/**
 * Discord answers `null`, `false` and `[]` for fields a command never set, and
 * the builders leave them out: all of those mean "unset" and compare equal.
 */
function meaningful(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function cleaned(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cleaned);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, entry]) => [key, cleaned(entry)] as const)
      .filter(([, entry]) => meaningful(entry)),
  );
}

function projectOption(option: unknown): unknown {
  if (!isRecord(option)) return option;
  const out: Json = {};
  for (const key of OPTION_KEYS) {
    const value = cleaned(option[key]);
    if (meaningful(value)) out[key] = value;
  }
  const nested = option['options'];
  if (Array.isArray(nested) && nested.length > 0) out['options'] = nested.map(projectOption);
  return out;
}

function projectCommand(command: Json, wanted: Json | undefined): Json {
  const out: Json = { type: typeof command['type'] === 'number' ? command['type'] : CHAT_INPUT };
  for (const key of COMMAND_KEYS) {
    if (key === 'options') continue;
    const value = cleaned(command[key]);
    if (meaningful(value)) out[key] = value;
  }
  const options = command['options'];
  if (Array.isArray(options) && options.length > 0) out['options'] = options.map(projectOption);
  for (const key of DEFAULTED_COMMAND_KEYS) {
    if (wanted === undefined || meaningful(wanted[key])) {
      const value = cleaned(command[key]);
      if (meaningful(value)) out[key] = value;
    }
  }
  return out;
}

/**
 * Whether the commands Discord holds are what `wanted` describes: same set,
 * same names, descriptions, localisations, options and default permissions.
 * `remote` is the raw answer of `GET /applications/{id}/commands` (or the guild
 * route); anything that is not a list of commands counts as different.
 */
export function commandsInSync(wanted: readonly CommandPayload[], remote: unknown): boolean {
  if (!Array.isArray(remote) || !remote.every(isRecord)) return false;
  if (remote.length !== wanted.length) return false;

  const remoteByKey = new Map(remote.map((command) => [commandKey(command), command] as const));
  if (remoteByKey.size !== remote.length) return false;

  return (wanted as unknown as readonly Json[]).every((command) => {
    const counterpart = remoteByKey.get(commandKey(command));
    if (counterpart === undefined) return false;
    return (
      canonicalJson(projectCommand(command, undefined)) ===
      canonicalJson(projectCommand(counterpart, command))
    );
  });
}
