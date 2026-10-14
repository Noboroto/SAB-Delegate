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
    // Built at run time around a random core so no password literal sits in the source.
    const core = randomBytes(4).toString('hex');
    const password = `${core}@:/#?%`;
    const url = new URL(resolveDatabaseUrl({ ...baseEnv, POSTGRES_PASSWORD: password }));
    expect(url.password).toBe(`${core}%40%3A%2F%23%3F%25`);
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

  it('trims whitespace around every input', () => {
    expect(
      resolveDatabaseUrl({
        POSTGRES_USER: ' sab_app\n',
        POSTGRES_PASSWORD: runtimePassword,
        POSTGRES_DB: ' sab ',
        POSTGRES_HOST: ' localhost ',
        POSTGRES_PORT: ' 5436 ',
      }),
    ).toBe(`postgresql://sab_app:${runtimePassword}@localhost:5436/sab`);
  });

  it('keeps surrounding whitespace in a password, which is opaque', () => {
    const url = new URL(resolveDatabaseUrl({ ...baseEnv, POSTGRES_PASSWORD: ' pw ' }));
    expect(decodeURIComponent(url.password)).toBe(' pw ');
  });

  it('treats a blank host or port as unset and a blank credential as missing', () => {
    expect(resolveDatabaseUrl({ ...baseEnv, POSTGRES_HOST: ' ', POSTGRES_PORT: '' })).toBe(
      `postgresql://sab_app:${runtimePassword}@sab-postgres:5432/sab`,
    );
    expect(() => resolveDatabaseUrl({ ...baseEnv, POSTGRES_PASSWORD: '   ' })).toThrow(
      'POSTGRES_PASSWORD',
    );
  });

  it.each(['0', '65536', '-1', '54.32', '5432a', 'abc', '1e3'])('rejects the port %s', (port) => {
    expect(() => resolveDatabaseUrl({ ...baseEnv, POSTGRES_PORT: port })).toThrow('POSTGRES_PORT');
  });

  it.each(['1', '65535'])('accepts the boundary port %s', (port) => {
    expect(new URL(resolveDatabaseUrl({ ...baseEnv, POSTGRES_PORT: port })).port).toBe(port);
  });

  it('brackets an IPv6 host so the port stays separable', () => {
    const url = new URL(
      resolveDatabaseUrl({ ...baseEnv, POSTGRES_HOST: '::1', POSTGRES_PORT: '5436' }),
    );
    expect(url.hostname).toBe('[::1]');
    expect(url.port).toBe('5436');
  });

  it('leaves an already bracketed IPv6 host alone', () => {
    const url = new URL(resolveDatabaseUrl({ ...baseEnv, POSTGRES_HOST: '[::1]' }));
    expect(url.hostname).toBe('[::1]');
    expect(url.port).toBe('5432');
  });
});
