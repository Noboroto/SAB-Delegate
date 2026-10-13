import { ExportClaimsOptionsSchema, MigrateOptionsSchema, type CliOptions } from './types.js';

/** Messages carry flag names only, never a flag's value. */
export class ArgsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArgsError';
  }
}

export const USAGE = [
  'Usage:',
  '  migrate-quickdb [migrate] --source <dir> [--apply [--allow-non-empty]] [--dict-asset <file>]',
  '  migrate-quickdb export-claims --target <dir> [--days <1-7>]',
].join('\n');

const BOOLEAN_FLAGS = new Set(['--apply', '--allow-non-empty']);
const VALUE_FLAGS = new Set(['--source', '--target', '--dict-asset', '--days']);

type Parsed = { flags: Set<string>; values: Map<string, string> };

function scan(tokens: readonly string[]): Parsed {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index] as string;
    const equals = token.indexOf('=');
    const name = equals === -1 ? token : token.slice(0, equals);
    if (BOOLEAN_FLAGS.has(name) && equals === -1) {
      flags.add(name);
    } else if (VALUE_FLAGS.has(name)) {
      let value: string | undefined;
      if (equals === -1) {
        value = tokens[++index];
      } else {
        value = token.slice(equals + 1);
      }
      if (value === undefined || value === '' || value.startsWith('--')) {
        throw new ArgsError(`${name} needs a value`);
      }
      if (values.has(name)) throw new ArgsError(`${name} given more than once`);
      values.set(name, value);
    } else {
      throw new ArgsError(`Unknown argument ${name.startsWith('--') ? name : '(positional)'}`);
    }
  }
  return { flags, values };
}

function rejectUnused(parsed: Parsed, allowed: readonly string[]): void {
  for (const name of [...parsed.flags, ...parsed.values.keys()]) {
    if (!allowed.includes(name)) throw new ArgsError(`${name} does not apply to this command`);
  }
}

export function parseArgs(argv: readonly string[]): CliOptions {
  const first = argv[0];
  const named = first === 'migrate' || first === 'export-claims';
  const command = named ? first : 'migrate';
  const parsed = scan(named ? argv.slice(1) : argv);

  if (command === 'export-claims') {
    rejectUnused(parsed, ['--target', '--days']);
    const targetDir = parsed.values.get('--target');
    if (!targetDir) throw new ArgsError('--target is required');
    const rawDays = parsed.values.get('--days') ?? '2';
    const days = /^\d+$/.test(rawDays) ? Number(rawDays) : NaN;
    if (!Number.isInteger(days) || days < 1 || days > 7) {
      throw new ArgsError('--days must be an integer from 1 to 7');
    }
    return ExportClaimsOptionsSchema.parse({ command, targetDir, days });
  }

  rejectUnused(parsed, ['--source', '--apply', '--allow-non-empty', '--dict-asset']);
  const sourceDir = parsed.values.get('--source');
  if (!sourceDir) throw new ArgsError('--source is required');
  const apply = parsed.flags.has('--apply');
  const allowNonEmpty = parsed.flags.has('--allow-non-empty');
  if (allowNonEmpty && !apply) throw new ArgsError('--allow-non-empty only applies with --apply');
  return MigrateOptionsSchema.parse({
    command,
    sourceDir,
    apply,
    allowNonEmpty,
    dictAsset: parsed.values.get('--dict-asset') ?? null,
  });
}
