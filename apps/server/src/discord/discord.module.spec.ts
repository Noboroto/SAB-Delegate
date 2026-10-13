import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Global, Logger, Module, UseInterceptors } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Client, GatewayIntentBits } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { BootGuardError, IDENTITY_REST, type DiscordEnv } from './boot-guard.js';
import { CommandRegistrar } from './command-registrar.js';
import { DiscordCommands } from './decorators/discord-commands.decorator.js';
import { DiscordLifecycleListener, DiscordModule } from './discord.module.js';
import { DiscordReadyService } from './discord-ready.service.js';
import { ErrorReporter } from './error-reporter.service.js';
import { DISCORD_INTENTS, buildNecordOptions } from './necord-options.js';
import { ReactionAutocompleteInterceptor } from './interceptors/reaction-autocomplete.interceptor.js';
import { ChannelAccessService } from './services/channel-access.service.js';
import { DiscordReactionService } from './services/discord-reaction.service.js';
import { MessageResolver } from './services/message-resolver.service.js';

const APP_ID = '111111111111111111';
const DEV_GUILD = '333333333333333333';
const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

const baseEnv = (): Record<string, string> => ({
  APP_ENV: 'production',
  DISCORD_TOKEN: marker('discord'),
  DISCORD_CLIENT_ID: APP_ID,
  DISCORD_ALLOWED_APP_IDS: APP_ID,
  DISCORD_DEV_GUILD_ID: '',
  ADMIN_GUILD_ID: '444444444444444444',
  MIGRATION_PENDING: '',
  COMMANDS_FORCE_RESET: '',
  POSTGRES_DB: 'sab',
  POSTGRES_USER: 'sab_app',
  POSTGRES_PASSWORD: marker('postgres'),
  LOG_LEVEL: 'silent',
});

/** The data layer is not under test: a global stand-in for the one provider the Discord modules read. */
@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: { guild: {}, appState: {} } }],
  exports: [PrismaService],
})
class PrismaStubModule {}

@DiscordCommands()
class ExampleCommands {
  @UseInterceptors(ReactionAutocompleteInterceptor)
  autocomplete(): void {}
}

const identityStub = (id: string) => ({ get: () => Promise.resolve({ id }) });

function stubEnv(overrides: Record<string, string> = {}): void {
  for (const [name, value] of Object.entries({ ...baseEnv(), ...overrides })) {
    vi.stubEnv(name, value);
  }
}

let login: MockInstance<Client['login']>;

beforeEach(() => {
  // Nothing here may ever reach Discord.
  login = vi.spyOn(Client.prototype, 'login').mockRejectedValue(new Error('login must not run'));
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('DiscordModule', () => {
  let moduleRef: TestingModule | undefined;

  afterEach(async () => {
    await moduleRef?.close();
    moduleRef = undefined;
  });

  async function compileFull(identityId = APP_ID): Promise<TestingModule> {
    stubEnv();
    moduleRef = await Test.createTestingModule({
      imports: [PrismaStubModule, DiscordModule.forRoot(process.env)],
      providers: [ExampleCommands],
    })
      .overrideProvider(IDENTITY_REST)
      .useValue(identityStub(identityId))
      .compile();
    return moduleRef;
  }

  it('resolves every provider and the filter and interceptor of a decorated class', async () => {
    const ref = await compileFull();
    expect(ref.get(Client, { strict: false })).toBeInstanceOf(Client);
    for (const provider of [
      CommandRegistrar,
      ErrorReporter,
      DiscordLifecycleListener,
      ChannelAccessService,
      DiscordReactionService,
      MessageResolver,
      DiscordReadyService,
      ExampleCommands,
    ]) {
      expect(ref.get(provider, { strict: false }), provider.name).toBeDefined();
    }
    expect(ref.get(DiscordReadyService, { strict: false }).isReady()).toBe(false);
  });

  it('verifies the token application before any gateway login', async () => {
    stubEnv();
    await expect(
      Test.createTestingModule({
        imports: [PrismaStubModule, DiscordModule.forRoot(process.env)],
      })
        .overrideProvider(IDENTITY_REST)
        .useValue(identityStub('999999999999999999'))
        .compile(),
    ).rejects.toBeInstanceOf(BootGuardError);
    expect(login).not.toHaveBeenCalled();
  });

  it('does not build a Discord client at all while migration is pending', async () => {
    stubEnv({ MIGRATION_PENDING: 'true' });
    moduleRef = await Test.createTestingModule({
      imports: [PrismaStubModule, DiscordModule.forRoot(process.env)],
    }).compile();
    await moduleRef.init();

    expect(login).not.toHaveBeenCalled();
    expect(() => moduleRef?.get(Client, { strict: false })).toThrow();
    expect(() => moduleRef?.get(CommandRegistrar, { strict: false })).toThrow();

    const ready = moduleRef.get(DiscordReadyService, { strict: false });
    expect(ready.migrationPending).toBe(true);
    const worker = vi.fn();
    ready.afterReady('worker', worker);
    await Promise.resolve();
    expect(ready.isReady()).toBe(false);
    expect(worker).not.toHaveBeenCalled();
  });
});

describe('DiscordReadyService', () => {
  it('runs queued tasks only after the gateway is ready, and late tasks at once', async () => {
    const ready = new DiscordReadyService(false);
    const order: string[] = [];
    ready.afterReady('worker', () => void order.push('worker'));
    ready.afterReady('cron', () => Promise.resolve(void order.push('cron')));
    expect(order).toEqual([]);

    ready.markReady();
    await vi.waitFor(() => expect(order).toEqual(['worker', 'cron']));

    ready.afterReady('late', () => void order.push('late'));
    await vi.waitFor(() => expect(order).toContain('late'));
    expect(ready.isReady()).toBe(true);
  });

  it('keeps running the other tasks when one fails, and logs only its label', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const ready = new DiscordReadyService(false);
    const second = vi.fn();
    ready.afterReady('broken', () => Promise.reject(new TypeError('secret detail')));
    ready.afterReady('fine', second);
    ready.markReady();
    await vi.waitFor(() => expect(second).toHaveBeenCalled());
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).toContain('broken');
    expect(logged).toContain('TypeError');
    expect(logged).not.toContain('secret detail');
  });

  it('marking ready twice does not run a task twice', async () => {
    const ready = new DiscordReadyService(false);
    const task = vi.fn();
    ready.afterReady('once', task);
    ready.markReady();
    ready.markReady();
    await vi.waitFor(() => expect(task).toHaveBeenCalledTimes(1));
  });
});

describe('DiscordLifecycleListener', () => {
  const clientReady = [{ user: { tag: 'Bot#0001' } }] as never;

  function build(forceReset: boolean) {
    const registrar = {
      registerIfChanged: vi.fn().mockResolvedValue('registered'),
      wipeAndRegister: vi.fn().mockResolvedValue('registered'),
      configuredScope: vi.fn().mockReturnValue({ kind: 'guild', guildId: DEV_GUILD }),
    };
    const ready = new DiscordReadyService(false);
    const listener = new DiscordLifecycleListener(registrar as unknown as CommandRegistrar, ready, {
      COMMANDS_FORCE_RESET: forceReset,
    });
    return { listener, registrar, ready };
  }

  beforeEach(() => {
    for (const method of ['log', 'warn', 'error'] as const) {
      vi.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
    }
  });

  it('registers the commands first, then opens the gate', async () => {
    const { listener, registrar, ready } = build(false);
    registrar.registerIfChanged.mockImplementation(() => {
      expect(ready.isReady()).toBe(false);
      return Promise.resolve('registered');
    });
    await listener.onClientReady(clientReady);
    expect(registrar.registerIfChanged).toHaveBeenCalledTimes(1);
    expect(registrar.wipeAndRegister).not.toHaveBeenCalled();
    expect(ready.isReady()).toBe(true);
  });

  it('wipes and registers when COMMANDS_FORCE_RESET is set, in the environment scope only', async () => {
    const { listener, registrar, ready } = build(true);
    await listener.onClientReady(clientReady);
    expect(registrar.wipeAndRegister).toHaveBeenCalledWith({ kind: 'guild', guildId: DEV_GUILD });
    expect(registrar.registerIfChanged).not.toHaveBeenCalled();
    expect(ready.isReady()).toBe(true);
  });

  it('opens the gate even if registration throws', async () => {
    const { listener, registrar, ready } = build(false);
    registrar.registerIfChanged.mockRejectedValue(new Error('boom'));
    await listener.onClientReady(clientReady);
    expect(ready.isReady()).toBe(true);
  });

  it('has an error listener so a gateway error cannot end the process', () => {
    const { listener } = build(false);
    expect(() => listener.onClientError([new Error('ws closed')] as never)).not.toThrow();
  });
});

describe('buildNecordOptions', () => {
  const env = (overrides: Partial<DiscordEnv>) =>
    ({
      APP_ENV: 'production',
      DISCORD_TOKEN: 'token-value',
      DISCORD_DEV_GUILD_ID: undefined,
      ...overrides,
    }) as DiscordEnv;

  it('registers nothing by itself and passes no guild override in production', () => {
    const options = buildNecordOptions(env({}));
    expect(options.skipRegistration).toBe(true);
    // Exactly `false`: a guild list would overwrite the guilds of every command.
    expect(options.development).toBe(false);
    expect(options.token).toBe('token-value');
  });

  it('scopes development to the dev guild', () => {
    const options = buildNecordOptions(
      env({ APP_ENV: 'development', DISCORD_DEV_GUILD_ID: DEV_GUILD }),
    );
    expect(options.development).toEqual([DEV_GUILD]);
  });

  it('refuses development without a dev guild', () => {
    expect(() => buildNecordOptions(env({ APP_ENV: 'development' }))).toThrow(RangeError);
  });

  it('requests exactly the intents the bot reads', () => {
    expect([...DISCORD_INTENTS].sort()).toEqual(
      [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildExpressions,
      ].sort(),
    );
    expect(DISCORD_INTENTS).not.toContain(GatewayIntentBits.GuildPresences);
    expect(DISCORD_INTENTS).not.toContain(GatewayIntentBits.GuildMessageTyping);
    expect(DISCORD_INTENTS).not.toContain(GatewayIntentBits.GuildModeration);
  });
});
