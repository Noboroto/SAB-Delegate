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
  });

type Env = z.infer<typeof envSchema>;

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
