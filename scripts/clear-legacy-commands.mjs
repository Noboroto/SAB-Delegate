// TEMPORARY: owner-machine tool that removes the slash commands registered by
// the legacy bot application. Delete it (with its test) once the rollback
// window closes. It is not part of the compose stack: the legacy token must
// never reach the server.
//
// Usage (token and id come from the environment, never from argv):
//   LEGACY_BOT_TOKEN=... LEGACY_CLIENT_ID=... node scripts/clear-legacy-commands.mjs
//     [--dry-run | --apply] [--guild <guildId>]
//
// --dry-run (default) only lists the count and names of registered commands.
// --apply replaces them with an empty list (PUT []) and re-reads to prove the
// remaining count is 0. --guild targets one guild's commands instead of the
// global ones. Exit codes: 0 ok, 1 Discord/verification failure, 2 usage,
// missing env or a refused identity check.
//
// Identity checks (run before any request): LEGACY_CLIENT_ID must be the
// application id encoded in the first segment of LEGACY_BOT_TOKEN, and must not
// be the new bot's DISCORD_CLIENT_ID when that variable is set. Either mistake
// would wipe the new bot's global commands. Neither value is ever printed.
//
// The token is only ever printed as "[redacted]": REST errors can echo request
// details, so every message is scrubbed before it reaches the terminal.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const SNOWFLAKE = /^\d{17,20}$/;
const REQUIRED_ENV = ['LEGACY_BOT_TOKEN', 'LEGACY_CLIENT_ID'];

/**
 * @typedef {{ get(route: string): Promise<unknown>, put(route: string, options: { body: unknown[] }): Promise<unknown> }} RestLike
 * @typedef {{ applicationCommands(id: string): string, applicationGuildCommands(id: string, guildId: string): string }} RoutesLike
 */

/**
 * A bot token starts with the base64url of its application id.
 * @param {string} token
 * @returns {string | null}
 */
function applicationIdOf(token) {
  const first = token.split('.')[0] ?? '';
  if (!/^[A-Za-z0-9_-]+$/.test(first)) return null;
  const decoded = Buffer.from(first, 'base64url').toString('utf8');
  return SNOWFLAKE.test(decoded) ? decoded : null;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  let apply = false;
  let dryRun = false;
  /** @type {string | undefined} */
  let guildId;
  let guildGiven = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') apply = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--guild') {
      guildGiven = true;
      guildId = argv[i + 1];
      i += 1;
    } else return { error: `Unknown argument: ${arg}` };
  }
  if (apply && dryRun) return { error: '--apply and --dry-run are mutually exclusive.' };
  // A bare --guild must not fall through to the global scope.
  if (guildGiven && (guildId === undefined || !SNOWFLAKE.test(guildId))) {
    return { error: '--guild needs a numeric guild id.' };
  }
  return { apply, guildId };
}

/** @param {unknown} value */
function commandNames(value) {
  if (!Array.isArray(value)) throw new Error('Discord returned an unexpected command list.');
  return value.map((command) => String(command?.name ?? '?'));
}

/**
 * Core of the script; every side effect goes through the injected arguments.
 *
 * @param {{
 *   argv: string[],
 *   env: Record<string, string | undefined>,
 *   createRest: (token: string) => RestLike,
 *   routes: RoutesLike,
 *   log: (line: string) => void,
 *   logError: (line: string) => void,
 * }} deps
 * @returns {Promise<number>} process exit code
 */
export async function run({ argv, env, createRest, routes, log, logError }) {
  const token = env.LEGACY_BOT_TOKEN?.trim() ?? '';
  const clientId = env.LEGACY_CLIENT_ID?.trim() ?? '';
  /** @param {string} text */
  const scrub = (text) => (token ? text.split(token).join('[redacted]') : text);

  const missing = REQUIRED_ENV.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    logError(`Missing environment variables: ${missing.join(', ')}`);
    return 2;
  }
  if (!SNOWFLAKE.test(clientId)) {
    logError('LEGACY_CLIENT_ID must be a numeric snowflake.');
    return 2;
  }
  if (applicationIdOf(token) !== clientId) {
    logError('LEGACY_CLIENT_ID does not match the application id encoded in LEGACY_BOT_TOKEN.');
    return 2;
  }
  if (clientId === (env.DISCORD_CLIENT_ID?.trim() ?? '')) {
    logError('LEGACY_CLIENT_ID is the new bot (DISCORD_CLIENT_ID); refusing to clear its commands.');
    return 2;
  }
  const args = parseArgs(argv);
  if ('error' in args) {
    logError(args.error);
    return 2;
  }

  const route = args.guildId
    ? routes.applicationGuildCommands(clientId, args.guildId)
    : routes.applicationCommands(clientId);
  const scope = args.guildId ? `guild ${args.guildId}` : 'global';

  try {
    const rest = createRest(token);
    const before = commandNames(await rest.get(route));
    log(`${scope}: ${before.length} registered command(s)`);
    if (before.length > 0) log(before.join(', '));

    if (!args.apply) {
      log('Dry run: nothing changed. Re-run with --apply to clear them.');
      return 0;
    }

    await rest.put(route, { body: [] });
    // The PUT response is not trusted as proof: read the registry back.
    const remaining = commandNames(await rest.get(route)).length;
    log(`${scope}: ${remaining} command(s) remaining`);
    if (remaining !== 0) {
      logError('Verification failed: commands are still registered.');
      return 1;
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logError(`Discord request failed: ${scrub(message)}`);
    return 1;
  }
}

async function main() {
  // discord.js is a dependency of apps/server only, so resolve it from there
  // instead of adding it to the workspace root for a throwaway script.
  const requireFromServer = createRequire(new URL('../apps/server/package.json', import.meta.url));
  const { REST, Routes } = requireFromServer('discord.js');
  const code = await run({
    argv: process.argv.slice(2),
    env: process.env,
    createRest: (token) => new REST({ version: '10' }).setToken(token),
    routes: Routes,
    log: (line) => console.log(line),
    logError: (line) => console.error(line),
  });
  process.exit(code);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
