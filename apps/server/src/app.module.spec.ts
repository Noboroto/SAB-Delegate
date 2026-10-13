import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Injectable, Optional, type Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { IDENTITY_REST } from './discord/boot-guard.js';
import { DiscordReadyService } from './discord/discord-ready.service.js';
import { HealthController } from './health/health.controller.js';

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
    // The identity check is the one Discord call made while the container is
    // built; a real one here would send the marker token to the live API.
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_REST)
      .useValue({ get: () => Promise.resolve({ id: testEnv['DISCORD_CLIENT_ID'] }) })
      .compile();
  });

  afterAll(async () => {
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  it('compiles and resolves its controller through the container', () => {
    expect(moduleRef.get(HealthController)).toBeInstanceOf(HealthController);
  });

  it('holds the Discord gate closed until the gateway reports ready', () => {
    expect(moduleRef.get(DiscordReadyService).isReady()).toBe(false);
  });

  it('gives every controller and provider constructor dependency a resolvable type', () => {
    // Walk the module graph from AppModule's own metadata, so a module added
    // later is checked without editing this list.
    const seen = new Set<Type>();
    const visit = (module: Type): void => {
      if (seen.has(module)) return;
      seen.add(module);
      for (const imported of (Reflect.getMetadata('imports', module) ?? []) as unknown[]) {
        const target = (imported as { module?: Type }).module ?? imported;
        if (typeof target === 'function') visit(target as Type);
      }
    };
    visit(AppModule);

    const declared = [...seen].flatMap((module) => [
      ...((Reflect.getMetadata('controllers', module) ?? []) as Type[]),
      ...((Reflect.getMetadata('providers', module) ?? []) as unknown[]).filter(
        (provider): provider is Type => typeof provider === 'function',
      ),
    ]);
    expect(declared.length).toBeGreaterThan(0);
    for (const target of declared) {
      expect(unresolvableParameters(target), `${target.name} constructor`).toEqual([]);
    }
  });

  it('refuses to compile when the environment is invalid, naming the variable only', async () => {
    vi.stubEnv('DISCORD_TOKEN', '');
    try {
      const attempt = Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(IDENTITY_REST)
        .useValue({ get: () => Promise.resolve({ id: testEnv['DISCORD_CLIENT_ID'] }) })
        .compile();
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
