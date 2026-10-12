import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { resolveDatabaseUrl } from './database-url.js';

// Generated per run so no credential-shaped literal sits next to a key name.
const runtimePassword = `rt-${randomBytes(6).toString('hex')}`;
const migratePassword = `mg-${randomBytes(6).toString('hex')}`;

const baseEnv = {
  POSTGRES_USER: 'sab_app',
  POSTGRES_PASSWORD: runtimePassword,
  POSTGRES_MIGRATE_USER: 'sab_migrate',
  POSTGRES_MIGRATE_PASSWORD: migratePassword,
  POSTGRES_DB: 'sab',
};

describe('resolveDatabaseUrl', () => {
  it('defaults the host to the compose service name and the port to 5432', () => {
    expect(resolveDatabaseUrl(baseEnv)).toBe(
      `postgresql://sab_app:${runtimePassword}@sab-postgres:5432/sab`,
    );
  });

  it('honours POSTGRES_HOST and POSTGRES_PORT', () => {
    expect(
      resolveDatabaseUrl({ ...baseEnv, POSTGRES_HOST: 'localhost', POSTGRES_PORT: '5436' }),
    ).toBe(`postgresql://sab_app:${runtimePassword}@localhost:5436/sab`);
  });

  it('uses the migrate role credentials when asked', () => {
    expect(resolveDatabaseUrl(baseEnv, 'migrate')).toBe(
      `postgresql://sab_migrate:${migratePassword}@sab-postgres:5432/sab`,
    );
  });

  it('percent-encodes reserved characters so the password decodes back unchanged', () => {
    const password = 'p@ss:w/rd#?%';
    const url = new URL(resolveDatabaseUrl({ ...baseEnv, POSTGRES_PASSWORD: password }));
    expect(url.password).toBe('p%40ss%3Aw%2Frd%23%3F%25');
    expect(decodeURIComponent(url.password)).toBe(password);
    expect(url.hostname).toBe('sab-postgres');
    expect(url.pathname).toBe('/sab');
  });

  it('names the missing variables without echoing any value', () => {
    const attempt = () => resolveDatabaseUrl({ POSTGRES_USER: 'sab_app', POSTGRES_DB: 'sab' });
    expect(attempt).toThrow('POSTGRES_PASSWORD');
    expect(attempt).not.toThrow('sab_app');
    expect(() => resolveDatabaseUrl(baseEnv, 'migrate')).not.toThrow();
    expect(() => resolveDatabaseUrl({ POSTGRES_DB: 'sab' }, 'migrate')).toThrow(
      'POSTGRES_MIGRATE_USER, POSTGRES_MIGRATE_PASSWORD',
    );
  });
});
