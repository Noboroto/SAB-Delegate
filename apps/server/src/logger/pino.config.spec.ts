import { randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import pino from 'pino';
import type { Options } from 'pino-http';
import { describe, expect, it } from 'vitest';
import {
  NESTING_PREFIXES,
  REDACTION,
  SENSITIVE_KEYS,
  buildPinoParams,
  redactAuthQuery,
} from './pino.config.js';

const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

function logged(entry: Record<string, unknown>): string {
  const lines: string[] = [];
  const logger = pino(
    { redact: REDACTION, level: 'info' },
    {
      write(chunk: string) {
        lines.push(chunk);
      },
    },
  );
  logger.info(entry);
  return lines.join('');
}

function nested(depth: number, leaf: Record<string, unknown>): Record<string, unknown> {
  return depth === 0 ? leaf : { context: nested(depth - 1, leaf) };
}

const depths = NESTING_PREFIXES.map((_prefix, depth) => depth);

describe('log redaction', () => {
  it.each(SENSITIVE_KEYS.flatMap((key) => depths.map((depth) => [key, depth] as const)))(
    'hides %s at nesting depth %i',
    (key, depth) => {
      const value = marker(key);
      expect(logged(nested(depth, { [key]: value }))).not.toContain(value);
    },
  );

  it('covers every nesting level the prefixes declare', () => {
    expect(depths).toEqual([0, 1, 2, 3]);
  });

  it('never uses a recursive wildcard, which pino accepts and then ignores', () => {
    expect(REDACTION.paths.filter((path) => path.includes('**'))).toEqual([]);
  });

  it('hides request and response credentials by their full path', () => {
    const headers = {
      authorization: marker('auth'),
      cookie: marker('cookie'),
      'proxy-authorization': marker('proxy-auth'),
      'x-api-key': marker('api-key'),
    };
    const setCookie = marker('set-cookie');
    const line = logged({ req: { headers }, res: { headers: { 'set-cookie': setCookie } } });
    for (const value of [...Object.values(headers), setCookie]) expect(line).not.toContain(value);
  });

  it('keeps ordinary fields readable', () => {
    const guildId = marker('guild');
    expect(logged({ guildId })).toContain(guildId);
  });

  it('installs the same redaction on the http logger', () => {
    expect(buildPinoParams('warn').pinoHttp).toMatchObject({ level: 'warn', redact: REDACTION });
  });
});

describe('request url in the log', () => {
  it('drops the query of Better Auth routes and keeps the path', () => {
    expect(redactAuthQuery('/api/auth/callback/discord?code=abc&state=xyz')).toBe(
      '/api/auth/callback/discord',
    );
    expect(redactAuthQuery('/api/auth?x=1')).toBe('/api/auth');
  });

  it('leaves every other url untouched', () => {
    expect(redactAuthQuery('/api/guilds/1/audit-logs?limit=20')).toBe(
      '/api/guilds/1/audit-logs?limit=20',
    );
    expect(redactAuthQuery('/api/authors?q=1')).toBe('/api/authors?q=1');
    expect(redactAuthQuery('/api/auth/get-session')).toBe('/api/auth/get-session');
  });

  it('is applied by the serializer pino-http uses', () => {
    const req = (buildPinoParams('info').pinoHttp as Options).serializers?.req;
    const code = marker('code');
    const incoming = {
      method: 'GET',
      url: `/api/auth/callback/discord?code=${code}&state=s`,
      headers: {},
    } as unknown as IncomingMessage;
    const out: unknown = req?.(incoming);
    expect(out).toMatchObject({ url: '/api/auth/callback/discord' });
    expect(JSON.stringify(out)).not.toContain(code);
  });
});
