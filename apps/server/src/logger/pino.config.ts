import { RequestMethod } from '@nestjs/common';
import type { Params } from 'nestjs-pino';
import type { Options } from 'pino-http';

// Keys that carry credentials wherever they appear in a logged object. Header
// names are lower-case on the wire but arbitrary objects use any casing, and
// pino matches keys exactly, so both spellings are listed.
export const SENSITIVE_KEYS = [
  'token',
  'accessToken',
  'refreshToken',
  'access_token',
  'refresh_token',
  'id_token',
  'secret',
  'clientSecret',
  'client_secret',
  'authorization',
  'Authorization',
  'proxy-authorization',
  'x-api-key',
  'cookie',
  'set-cookie',
  'password',
  'DISCORD_TOKEN',
  'POSTGRES_PASSWORD',
] as const;

// pino's redact paths do not understand `**`: a `**.key` pattern is accepted
// silently and then redacts nothing at any depth. Every nesting level is
// therefore spelled out; a credential nested deeper than this is not covered.
export const NESTING_PREFIXES = ['', '*.', '*.*.', '*.*.*.'] as const;

// A key that is not a plain identifier (`set-cookie`) needs bracket notation,
// which attaches to the wildcard without a dot: `*["set-cookie"]`.
function redactPath(prefix: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key)
    ? `${prefix}${key}`
    : `${prefix.replace(/\.$/, '')}["${key}"]`;
}

export const REDACTION: { paths: string[]; censor: string } = {
  paths: [
    ...SENSITIVE_KEYS.flatMap((key) => NESTING_PREFIXES.map((prefix) => redactPath(prefix, key))),
    // pino-http's default request serializer logs every header, including the
    // session cookie and bearer token.
    'req.headers.authorization',
    'req.headers.cookie',
    'req.headers["proxy-authorization"]',
    'req.headers["x-api-key"]',
    'res.headers["set-cookie"]',
  ],
  censor: '[REDACTED]',
};

export function buildPinoParams(level: string): Params {
  const pinoHttp: Options = {
    level,
    redact: REDACTION,
    // Level as a label so log tooling can filter by severity.
    formatters: { level: (label: string) => ({ level: label }) },
  };
  return {
    pinoHttp,
    // Health probes fire every few seconds and would drown real traffic.
    exclude: [{ path: 'health', method: RequestMethod.ALL }],
  };
}
