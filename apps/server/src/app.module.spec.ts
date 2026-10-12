import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Injectable, Optional, type Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import pino from 'pino';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { HealthController } from './health/health.controller.js';
import { HealthModule } from './health/health.module.js';
import { REDACTION, buildPinoParams } from './logger/pino.config.js';

const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

const testEnv: Record<string, string> = {
  APP_ENV: 'production',
  DISCORD_TOKEN: marker('discord'),
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_ALLOWED_APP_IDS: '111111111111111111',
  // Empty means unset: a developer's shell must not leak a dev guild in.
  DISCORD_DEV_GUILD_ID: '',
  ADMIN_GUILD_ID: '333333333333333333',
  POSTGRES_DB: 'sab',
  POSTGRES_USER: 'sab_app',
  POSTGRES_PASSWORD: marker('postgres'),
  LOG_LEVEL: 'silent',
};

// Constructor parameters Nest cannot resolve from their emitted type: an
// interface or type alias is emitted as `Object` and a missing import as
// `undefined`. A parameter with an explicit @Inject token is resolved by that
// token instead, and an alias is unresolvable even when marked @Optional, so
// that case is reported too.
function unresolvableParameters(target: Type): number[] {
  const types = (Reflect.getMetadata('design:paramtypes', target) ?? []) as unknown[];
  const injected = new Set(
    ((Reflect.getMetadata('self:paramtypes', target) ?? []) as Array<{ index: number }>).map(
      (entry) => entry.index,
    ),
  );
  return types.flatMap((type, index) =>
    (type === undefined || type === Object) && !injected.has(index) ? [index] : [],
  );
}

describe('AppModule', () => {
  let moduleRef: TestingModule;

  beforeAll(async () => {
    for (const [name, value] of Object.entries(testEnv)) vi.stubEnv(name, value);
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  });

  afterAll(async () => {
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  it('compiles and resolves its controller through the container', () => {
    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
  });

  it('gives every controller and provider constructor dependency a resolvable type', () => {
    const declared: Type[] = [AppModule, HealthModule].flatMap((module) => [
      ...((Reflect.getMetadata('controllers', module) ?? []) as Type[]),
      ...((Reflect.getMetadata('providers', module) ?? []) as Type[]),
    ]);
    expect(declared).toContain(HealthController);
    for (const target of declared) {
      expect(unresolvableParameters(target), `${target.name} constructor`).toEqual([]);
    }
  });

  it('refuses to compile when the environment is invalid, naming the variable only', async () => {
    vi.stubEnv('DISCORD_TOKEN', '');
    try {
      const attempt = Test.createTestingModule({ imports: [AppModule] }).compile();
      await expect(attempt).rejects.toThrow('DISCORD_TOKEN');
      await expect(attempt).rejects.not.toThrow(testEnv['POSTGRES_PASSWORD'] ?? '');
    } finally {
      vi.stubEnv('DISCORD_TOKEN', testEnv['DISCORD_TOKEN'] ?? '');
    }
  });
});

describe('dependency injection guard', () => {
  type Collaborator = { run(): void };

  @Injectable()
  class AliasTyped {
    constructor(readonly collaborator: Collaborator) {}
  }

  @Injectable()
  class AliasTypedOptional {
    constructor(@Optional() readonly collaborator?: Collaborator) {}
  }

  @Injectable()
  class ClassTyped {
    constructor(readonly health: HealthController) {}
  }

  it('reports a type-alias parameter, which the container cannot inject', async () => {
    expect(unresolvableParameters(AliasTyped)).toEqual([0]);
    await expect(Test.createTestingModule({ providers: [AliasTyped] }).compile()).rejects.toThrow(
      /can't resolve dependencies/i,
    );
  });

  it('reports a type-alias parameter even when it is marked optional', async () => {
    expect(unresolvableParameters(AliasTypedOptional)).toEqual([0]);
    const optional = await Test.createTestingModule({ providers: [AliasTypedOptional] }).compile();
    // Compiles, and the dependency is silently undefined at runtime.
    expect(optional.get(AliasTypedOptional).collaborator).toBeUndefined();
  });

  it('accepts a class-typed parameter', () => {
    expect(unresolvableParameters(ClassTyped)).toEqual([]);
  });
});

describe('log redaction', () => {
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

  const keys = ['token', 'secret', 'authorization', 'cookie', 'password'];

  it.each(keys.flatMap((key) => [0, 1, 2, 3].map((depth) => [key, depth] as const)))(
    'hides %s at nesting depth %i',
    (key, depth) => {
      const value = marker(key);
      expect(logged(nested(depth, { [key]: value }))).not.toContain(value);
    },
  );

  it('hides request and response credentials by their full path', () => {
    const auth = marker('auth');
    const cookie = marker('cookie');
    const setCookie = marker('set-cookie');
    const line = logged({
      req: { headers: { authorization: auth, cookie } },
      res: { headers: { 'set-cookie': setCookie } },
    });
    for (const value of [auth, cookie, setCookie]) expect(line).not.toContain(value);
  });

  it('keeps ordinary fields readable', () => {
    const guildId = marker('guild');
    expect(logged({ guildId })).toContain(guildId);
  });

  it('installs the same redaction on the http logger', () => {
    expect(buildPinoParams('warn').pinoHttp).toMatchObject({ level: 'warn', redact: REDACTION });
  });
});
