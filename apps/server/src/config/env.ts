import { isIP } from 'node:net';
import { z } from '@sab/shared';

const snowflake = z.string().regex(/^\d{17,20}$/, 'must be a Discord snowflake');

const flag = z.enum(['true', 'false']).transform((value) => value === 'true');

const integerInRange = (min: number, max: number) =>
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(min).max(max));

const csvOfSnowflakes = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )
  .pipe(z.array(snowflake).min(1));

function isIpOrCidr(value: string): boolean {
  const [address, prefix, ...rest] = value.split('/');
  if (address === undefined || rest.length > 0) return false;
  const family = isIP(address);
  if (family === 0) return false;
  if (prefix === undefined) return true;
  return /^\d{1,3}$/.test(prefix) && Number(prefix) <= (family === 4 ? 32 : 128);
}

// A bare origin: the value becomes the OAuth redirect base, the cookie scope
// and the only Origin accepted on writes, so a path, query or credentials in it
// would be silently dropped and mean something different from what was typed.
function isBareHttpOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.pathname === '/' &&
      url.search === '' &&
      url.hash === '' &&
      url.username === '' &&
      url.password === ''
    );
  } catch {
    return false;
  }
}

const appOrigin = z
  .string()
  .trim()
  .refine(isBareHttpOrigin, 'must be an http(s) origin without a path')
  .transform((value) => new URL(value).origin);

// Better Auth silently ignores an entry it cannot parse, which would leave every
// request in one rate-limit bucket; refusing it at boot is the safe direction.
const csvOfIpOrCidr = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== ''),
  )
  .pipe(z.array(z.string().refine(isIpOrCidr, 'must be an IP address or CIDR')).min(1));

export const envSchema = z
  .object({
    APP_ENV: z.enum(['development', 'production']),
    // Trimmed: a token pasted with a trailing newline would fail the gateway
    // login with an error that looks like a bad token.
    DISCORD_TOKEN: z.string().trim().min(1),
    DISCORD_CLIENT_ID: snowflake,
    DISCORD_ALLOWED_APP_IDS: csvOfSnowflakes,
    DISCORD_DEV_GUILD_ID: snowflake.optional(),
    ADMIN_GUILD_ID: snowflake,
    MIGRATION_PENDING: flag.default(false),
    // One-shot: wipe this environment's slash commands and register them again
    // at the next boot. Read once; it has to be unset afterwards or every boot
    // wipes.
    COMMANDS_FORCE_RESET: flag.default(false),
    POSTGRES_HOST: z.string().min(1).optional(),
    POSTGRES_PORT: integerInRange(1, 65535).optional(),
    POSTGRES_DB: z.string().min(1),
    POSTGRES_USER: z.string().min(1),
    POSTGRES_PASSWORD: z.string().min(1),
    DB_POOL_MAX: integerInRange(1, 100).default(10),
    PGBOSS_POOL_MAX: integerInRange(1, 100).default(4),
    PGBOSS_WORKERS_ENABLED: flag.default(true),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    // The REST API and dashboard login are on exactly when APP_URL is set, so
    // the bot-only release boots without any of the four variables below.
    APP_URL: appOrigin.optional(),
    DISCORD_CLIENT_SECRET: z.string().trim().min(1).optional(),
    // Signs and encrypts every session cookie; shorter secrets are guessable.
    BETTER_AUTH_SECRET: z.string().trim().min(32).optional(),
    // Encrypts the stored LLM API key. Unset: the LLM settings cannot be saved
    // and words are only explained from the bundled dictionaries.
    LLM_KEY_SECRET: z.string().trim().min(32).optional(),
    TRUSTED_PROXY_IPS: csvOfIpOrCidr.optional(),
    // The MCP endpoint (/mcp) is mounted when the REST API is on; false removes the route only.
    // Production needs TRUSTED_PROXY_IPS for it like the rest of the API (see the proxy rule below).
    MCP_ENABLED: flag.default(true),
  })
  // The dev guild scopes slash commands to one test server. Present in
  // production it would silently pull every command out of the real guilds;
  // absent in development there is nowhere safe to register them.
  .refine((env) => env.APP_ENV !== 'development' || env.DISCORD_DEV_GUILD_ID !== undefined, {
    path: ['DISCORD_DEV_GUILD_ID'],
    error: 'required when APP_ENV is development',
  })
  .refine((env) => env.APP_ENV !== 'production' || env.DISCORD_DEV_GUILD_ID === undefined, {
    path: ['DISCORD_DEV_GUILD_ID'],
    error: 'forbidden when APP_ENV is production',
  })
  // A secret without APP_URL means the operator meant to enable login and
  // forgot the switch; booting with login silently off would hide that.
  .refine(
    (env) =>
      env.APP_URL !== undefined ||
      (env.DISCORD_CLIENT_SECRET === undefined && env.BETTER_AUTH_SECRET === undefined),
    { path: ['APP_URL'], error: 'required when a login secret is set' },
  )
  .refine((env) => env.APP_URL === undefined || env.DISCORD_CLIENT_SECRET !== undefined, {
    path: ['DISCORD_CLIENT_SECRET'],
    error: 'required when APP_URL is set',
  })
  .refine((env) => env.APP_URL === undefined || env.BETTER_AUTH_SECRET !== undefined, {
    path: ['BETTER_AUTH_SECRET'],
    error: 'required when APP_URL is set',
  })
  // Behind the reverse proxy every request arrives from the proxy's address.
  // Without the hop list the rate limiter puts the whole site in one bucket,
  // and trusting the header without it lets a client choose its own address.
  .refine(
    (env) =>
      env.APP_ENV !== 'production' ||
      env.APP_URL === undefined ||
      env.TRUSTED_PROXY_IPS !== undefined,
    { path: ['TRUSTED_PROXY_IPS'], error: 'required in production when APP_URL is set' },
  )
  .refine(
    (env) =>
      env.APP_ENV !== 'production' || env.APP_URL === undefined || env.APP_URL.startsWith('https:'),
    { path: ['APP_URL'], error: 'must be https in production' },
  );

type Env = z.infer<typeof envSchema>;

/**
 * Variables whose values must never reach a log or a channel. Anything that
 * echoes text from outside the process (error reports) redacts exactly these.
 * A new secret in the schema has to be added here; the env spec fails otherwise.
 */
export const SECRET_ENV_NAMES = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_SECRET',
  'BETTER_AUTH_SECRET',
  'LLM_KEY_SECRET',
  'POSTGRES_PASSWORD',
] as const satisfies ReadonlyArray<keyof Env>;

/** Carries only variable NAMES: values can be secrets and end up in logs. */
export class InvalidEnvError extends Error {
  constructor(readonly names: readonly string[]) {
    super(`Invalid or missing environment variables: ${names.join(', ')}`);
    this.name = 'InvalidEnvError';
  }
}

/**
 * An issue without a variable in its path comes from a root-level refinement;
 * it is reported as `(root)` instead of being dropped, so the error is never
 * empty.
 */
export function variableNames(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey> }>,
): string[] {
  const names = new Set<string>();
  for (const issue of issues) {
    const name = issue.path[0];
    names.add(typeof name === 'string' ? name : '(root)');
  }
  return [...names];
}

/**
 * Validates the process environment once at boot. An unset variable and an
 * empty one (`NAME=` in a compose file) are the same thing, so the schema sees
 * both as absent. Unknown variables are dropped.
 */
export function loadEnv(source: Readonly<Record<string, string | undefined>> = process.env): Env {
  const present = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ''),
  );
  const result = envSchema.safeParse(present);
  if (result.success) return result.data;

  throw new InvalidEnvError(variableNames(result.error.issues));
}

/**
 * What the REST API and the login need, or `undefined` while it is switched
 * off. `loadEnv` already refused every combination that would leave a field
 * missing, so the guard below only narrows the types; it cannot be reached
 * with a validated environment.
 */
export function restSettingsOf(env: ReturnType<typeof loadEnv>) {
  if (env.APP_URL === undefined) return undefined;
  const { DISCORD_CLIENT_SECRET: clientSecret, BETTER_AUTH_SECRET: authSecret } = env;
  if (clientSecret === undefined || authSecret === undefined) {
    throw new InvalidEnvError(['DISCORD_CLIENT_SECRET', 'BETTER_AUTH_SECRET']);
  }
  return {
    appUrl: env.APP_URL,
    discordClientId: env.DISCORD_CLIENT_ID,
    discordClientSecret: clientSecret,
    authSecret,
    trustedProxies: env.TRUSTED_PROXY_IPS ?? [],
  };
}

export type RestSettings = NonNullable<ReturnType<typeof restSettingsOf>>;
