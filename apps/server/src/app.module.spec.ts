import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Injectable, Optional, type Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from './app.module.js';
import { IDENTITY_REST } from './discord/boot-guard.js';
import { DiscordReadyService } from './discord/discord-ready.service.js';
import { GuildAccessService } from './common/guild-access/guild-access.service.js';
import { ActivityService } from './modules/activity/activity.service.js';
import { AttendanceService } from './modules/attendance/attendance.service.js';
import { BirthdayCommands } from './modules/birthday/birthday.commands.js';
import { BirthdayCron } from './modules/birthday/birthday.cron.js';
import { BirthdayService } from './modules/birthday/birthday.service.js';
import { GuildConfigService } from './modules/guild-config/guild-config.service.js';
import { InfoService } from './modules/info/info.service.js';
import { MentionService } from './modules/mention/mention.service.js';
import { MessagingService } from './modules/messaging/messaging.service.js';
import { NoteService } from './modules/note/note.service.js';
import { PurgeService } from './modules/purge/purge.service.js';
import { AutoReactListener } from './modules/reactions/auto-react.listener.js';
import { RoleAssignService } from './modules/role-assign/role-assign.service.js';
import { ScheduleService } from './modules/schedule/schedule.service.js';
import { SystemService } from './modules/system/system.service.js';
import { PrivateThreadService } from './modules/thread/private-thread.service.js';
import { ThreadService } from './modules/thread/thread.service.js';
import { WordGameService } from './modules/word-game/word-game.service.js';
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
  MIGRATION_PENDING: '',
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

  it('loads the Discord feature modules', () => {
    for (const provider of [
      GuildConfigService,
      SystemService,
      GuildAccessService,
      BirthdayService,
      BirthdayCommands,
      BirthdayCron,
      NoteService,
      AutoReactListener,
      WordGameService,
      ScheduleService,
      MessagingService,
      MentionService,
      RoleAssignService,
      ThreadService,
      PrivateThreadService,
      PurgeService,
      ActivityService,
      AttendanceService,
      InfoService,
    ]) {
      expect(moduleRef.get(provider, { strict: false }), provider.name).toBeDefined();
    }
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

describe('AppModule while a migration is pending', () => {
  let moduleRef: TestingModule | undefined;

  afterAll(async () => {
    await moduleRef?.close();
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('leaves out every module that needs the Discord client', async () => {
    for (const [name, value] of Object.entries(testEnv)) vi.stubEnv(name, value);
    vi.stubEnv('MIGRATION_PENDING', 'true');
    // The module graph is fixed when the class is defined, so everything is
    // imported again under the pending environment; classes from the top-level
    // imports would be different identities and prove nothing.
    vi.resetModules();
    const [{ AppModule: PendingAppModule }, config, system, access, health, birthday, note, word] =
      await Promise.all([
        import('./app.module.js'),
        import('./modules/guild-config/guild-config.service.js'),
        import('./modules/system/system.service.js'),
        import('./common/guild-access/guild-access.service.js'),
        import('./health/health.controller.js'),
        import('./modules/birthday/birthday.service.js'),
        import('./modules/note/note.service.js'),
        import('./modules/word-game/word-game.service.js'),
      ]);
    moduleRef = await Test.createTestingModule({ imports: [PendingAppModule] }).compile();

    for (const provider of [
      config.GuildConfigService,
      system.SystemService,
      access.GuildAccessService,
      birthday.BirthdayService,
      note.NoteService,
      word.WordGameService,
    ]) {
      expect(() => moduleRef?.get(provider, { strict: false }), provider.name).toThrow();
    }
    expect(moduleRef.get(health.HealthController, { strict: false })).toBeDefined();
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
