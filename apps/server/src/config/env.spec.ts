import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { envSchema, InvalidEnvError, loadEnv } from './env.js';

// Generated per run: the values only need to be present and non-trivial.
const token = `tok-${randomBytes(8).toString('hex')}`;
const dbPassword = `pw-${randomBytes(8).toString('hex')}`;

const productionEnv: Record<string, string> = {
  APP_ENV: 'production',
  DISCORD_TOKEN: token,
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_ALLOWED_APP_IDS: '111111111111111111,222222222222222222',
  ADMIN_GUILD_ID: '333333333333333333',
  POSTGRES_DB: 'sab',
  POSTGRES_USER: 'sab_app',
  POSTGRES_PASSWORD: dbPassword,
};
const developmentEnv = {
  ...productionEnv,
  APP_ENV: 'development',
  DISCORD_DEV_GUILD_ID: '444444444444444444',
};

function failureOf(source: Record<string, string | undefined>): InvalidEnvError {
  try {
    loadEnv(source);
  } catch (error) {
    if (error instanceof InvalidEnvError) return error;
    throw error;
  }
  throw new Error('loadEnv accepted an invalid environment');
}

describe('loadEnv', () => {
  it('parses a production environment and fills the defaults', () => {
    const env = loadEnv(productionEnv);
    expect(env).toMatchObject({
      APP_ENV: 'production',
      DISCORD_ALLOWED_APP_IDS: ['111111111111111111', '222222222222222222'],
      MIGRATION_PENDING: false,
      PGBOSS_WORKERS_ENABLED: true,
      DB_POOL_MAX: 10,
      PGBOSS_POOL_MAX: 4,
      LOG_LEVEL: 'info',
    });
    expect(env.POSTGRES_HOST).toBeUndefined();
    expect(env.DISCORD_DEV_GUILD_ID).toBeUndefined();
  });

  it('parses explicit flags, integers and the optional host and port', () => {
    const env = loadEnv({
      ...productionEnv,
      MIGRATION_PENDING: 'true',
      PGBOSS_WORKERS_ENABLED: 'false',
      DB_POOL_MAX: '20',
      PGBOSS_POOL_MAX: '2',
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: '5436',
      LOG_LEVEL: 'debug',
    });
    expect(env).toMatchObject({
      MIGRATION_PENDING: true,
      PGBOSS_WORKERS_ENABLED: false,
      DB_POOL_MAX: 20,
      PGBOSS_POOL_MAX: 2,
      POSTGRES_HOST: 'localhost',
      POSTGRES_PORT: 5436,
      LOG_LEVEL: 'debug',
    });
  });

  it('strips variables the schema does not know', () => {
    const env = loadEnv({ ...productionEnv, TOKENS: 'legacy', PATH: '/usr/bin' });
    expect(Object.keys(env)).not.toContain('TOKENS');
    expect(Object.keys(env)).not.toContain('PATH');
  });

  it('treats an empty variable as unset', () => {
    const env = loadEnv({ ...productionEnv, DISCORD_DEV_GUILD_ID: '', MIGRATION_PENDING: ' ' });
    expect(env.DISCORD_DEV_GUILD_ID).toBeUndefined();
    expect(env.MIGRATION_PENDING).toBe(false);
    expect(failureOf({ ...productionEnv, DISCORD_TOKEN: '' }).names).toEqual(['DISCORD_TOKEN']);
  });

  it('lists every missing required variable by name', () => {
    expect(failureOf({}).names).toEqual(
      expect.arrayContaining([
        'APP_ENV',
        'DISCORD_TOKEN',
        'DISCORD_CLIENT_ID',
        'DISCORD_ALLOWED_APP_IDS',
        'ADMIN_GUILD_ID',
        'POSTGRES_DB',
        'POSTGRES_USER',
        'POSTGRES_PASSWORD',
      ]),
    );
  });

  it('rejects an APP_ENV outside the allowed values', () => {
    expect(failureOf({ ...productionEnv, APP_ENV: 'staging' }).names).toEqual(['APP_ENV']);
  });

  it.each([
    ['a snowflake with letters', { DISCORD_CLIENT_ID: '12ab' }, 'DISCORD_CLIENT_ID'],
    ['an empty allowed-app list', { DISCORD_ALLOWED_APP_IDS: ' , ' }, 'DISCORD_ALLOWED_APP_IDS'],
    [
      'a bad id inside the list',
      { DISCORD_ALLOWED_APP_IDS: '111111111111111111,x' },
      'DISCORD_ALLOWED_APP_IDS',
    ],
    ['a flag that is not true/false', { MIGRATION_PENDING: '1' }, 'MIGRATION_PENDING'],
    ['a pool size of zero', { DB_POOL_MAX: '0' }, 'DB_POOL_MAX'],
    ['a non-numeric pool size', { PGBOSS_POOL_MAX: 'many' }, 'PGBOSS_POOL_MAX'],
    ['an out-of-range port', { POSTGRES_PORT: '70000' }, 'POSTGRES_PORT'],
    ['an unknown log level', { LOG_LEVEL: 'verbose' }, 'LOG_LEVEL'],
  ])('rejects %s', (_label, override, name) => {
    expect(failureOf({ ...productionEnv, ...override }).names).toEqual([name]);
  });

  describe('DISCORD_DEV_GUILD_ID', () => {
    it('is required in development', () => {
      expect(loadEnv(developmentEnv).DISCORD_DEV_GUILD_ID).toBe('444444444444444444');
      expect(failureOf({ ...developmentEnv, DISCORD_DEV_GUILD_ID: undefined }).names).toEqual([
        'DISCORD_DEV_GUILD_ID',
      ]);
    });

    it('is forbidden in production', () => {
      expect(
        failureOf({ ...productionEnv, DISCORD_DEV_GUILD_ID: '444444444444444444' }).names,
      ).toEqual(['DISCORD_DEV_GUILD_ID']);
    });
  });

  it('never puts a value in the error', () => {
    const error = failureOf({
      ...productionEnv,
      DISCORD_CLIENT_ID: 'not-a-snowflake',
      DB_POOL_MAX: 'bad-pool-value',
    });
    expect(error.names).toEqual(['DISCORD_CLIENT_ID', 'DB_POOL_MAX']);
    const text = `${error.message} ${JSON.stringify(error.names)}`;
    for (const secret of [token, dbPassword, 'not-a-snowflake', 'bad-pool-value']) {
      expect(text).not.toContain(secret);
    }
  });
});

// `.env.example` documents every variable the repo's processes read, but the
// server's schema only owns the ones the server reads. Each name below belongs
// to another process, so it must not appear in the schema.
const NOT_READ_BY_SERVER: ReadonlyMap<string, string> = new Map([
  ['TOKENS', 'legacy bot in root/'],
  ['CREATE_CMD', 'legacy bot in root/'],
  ['POSTGRES_MIGRATE_USER', 'release job'],
  ['POSTGRES_MIGRATE_PASSWORD', 'release job'],
  ['POSTGRES_BACKUP_USER', 'backup job'],
  ['POSTGRES_BACKUP_PASSWORD', 'backup job'],
  ['BACKUP_ENABLED', 'backup and release jobs'],
  ['BACKUP_KEEP_DAILY', 'backup and release jobs'],
  ['BACKUP_KEEP_PRE_MIGRATE', 'backup and release jobs'],
  ['LEGACY_BOT_TOKEN', 'owner-machine cleanup script'],
  ['LEGACY_CLIENT_ID', 'owner-machine cleanup script'],
  ['TEST_REQUIRE_DB', 'test runner'],
  ['SAB_DEPS_READY', 'workspace tooling'],
]);
const LEGACY_DB_PATH = /_DB_PATH$/;

const ENV_EXAMPLE = join(__dirname, '..', '..', '..', '..', '.env.example');

function namesInEnvExample(): string[] {
  return readFileSync(ENV_EXAMPLE, 'utf8')
    .split('\n')
    .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
    .filter((name): name is string => name !== undefined);
}

describe('env contract between the schema and .env.example', () => {
  const schemaKeys = Object.keys(envSchema.shape);
  const exampleNames = namesInEnvExample();
  const serverNames = exampleNames.filter(
    (name) => !NOT_READ_BY_SERVER.has(name) && !LEGACY_DB_PATH.test(name),
  );

  it('reads real names from .env.example', () => {
    expect(exampleNames.length).toBeGreaterThan(schemaKeys.length);
  });

  it('documents every schema key in .env.example', () => {
    expect(schemaKeys.filter((key) => !exampleNames.includes(key))).toEqual([]);
  });

  it('has a schema key for every .env.example name that is not on the exclusion list', () => {
    expect(serverNames.filter((name) => !schemaKeys.includes(name))).toEqual([]);
  });

  it('keeps names of other processes out of the schema', () => {
    expect(
      schemaKeys.filter((key) => NOT_READ_BY_SERVER.has(key) || LEGACY_DB_PATH.test(key)),
    ).toEqual([]);
  });
});
