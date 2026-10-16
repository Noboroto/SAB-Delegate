import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Global, Logger, Module, UseInterceptors } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Client, GatewayIntentBits, MessagePayload, Status } from 'discord.js';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { PrismaService } from '../prisma/prisma.service.js';
import { BootGuardError, IDENTITY_REST, type DiscordEnv } from './boot-guard.js';
import { CommandRegistrar } from './command-registrar.js';
import { DiscordCommands } from './decorators/discord-commands.decorator.js';
import {
  DiscordClientShutdown,
  DiscordLifecycleListener,
  DiscordModule,
} from './discord.module.js';
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

  it('judges readiness by the real client: marked ready but never connected is not ready', async () => {
    const ref = await compileFull();
    const ready = ref.get(DiscordReadyService, { strict: false });
    ready.markReady();
    // The client in this module never logged in, so its gateway is idle. Had
    // the client not been injected the service would answer true here.
    expect(ref.get(Client, { strict: false }).ws.status).not.toBe(Status.Ready);
    expect(ready.isReady()).toBe(false);
  });

  it('registers the hook that closes the client before the database', async () => {
    const ref = await compileFull();
    expect(ref.get(DiscordClientShutdown, { strict: false })).toBeInstanceOf(DiscordClientShutdown);
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

  describe('gateway connection', () => {
    function gatewayOf(managerStatus: Status, shardStatuses: Status[]) {
      const shards = shardStatuses.map((status) => ({ status }));
      return {
        ws: {
          status: managerStatus,
          shards: {
            size: shards.length,
            every: (test: (s: { status: Status }) => boolean) => shards.every(test),
          },
        },
      };
    }

    it('is ready only while every shard is connected', () => {
      const connected = new DiscordReadyService(false, gatewayOf(Status.Ready, [Status.Ready]));
      connected.markReady();
      expect(connected.isReady()).toBe(true);
    });

    it('is not ready while a shard reconnects, although the manager still says Ready', () => {
      // discord.js sets the manager status once and never lowers it; a dropped
      // connection shows only in the shard.
      for (const shard of [Status.Connecting, Status.Resuming, Status.Disconnected]) {
        const dropped = new DiscordReadyService(
          false,
          gatewayOf(Status.Ready, [Status.Ready, shard]),
        );
        dropped.markReady();
        expect(dropped.isReady(), `shard ${shard}`).toBe(false);
      }
    });

    it('is not ready without shards or before the manager is ready', () => {
      const none = new DiscordReadyService(false, gatewayOf(Status.Ready, []));
      none.markReady();
      expect(none.isReady()).toBe(false);
      const idle = new DiscordReadyService(false, gatewayOf(Status.Idle, [Status.Ready]));
      idle.markReady();
      expect(idle.isReady()).toBe(false);
    });

    it('is not ready once shutdown began', () => {
      const ready = new DiscordReadyService(false, gatewayOf(Status.Ready, [Status.Ready]));
      ready.markReady();
      ready.onModuleDestroy();
      expect(ready.isStopping()).toBe(true);
      expect(ready.isReady()).toBe(false);
    });
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

describe('DiscordClientShutdown', () => {
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  it('destroys the client', async () => {
    const destroy = vi.fn().mockResolvedValue(undefined);
    await new DiscordClientShutdown({ destroy }).beforeApplicationShutdown();
    expect(destroy).toHaveBeenCalledTimes(1);
  });

  it('does not stop the shutdown when destroying fails', async () => {
    const destroy = vi.fn().mockRejectedValue(new Error('socket already closed'));
    await expect(
      new DiscordClientShutdown({ destroy }).beforeApplicationShutdown(),
    ).resolves.toBeUndefined();
  });

  it('can run before Necord destroys the same client again', async () => {
    // Necord calls `destroy()` in its own shutdown hook, after ours.
    const client = new Client({ intents: [GatewayIntentBits.Guilds] });
    await new DiscordClientShutdown(client).beforeApplicationShutdown();
    await expect(client.destroy()).resolves.toBeUndefined();
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

  it('warns at every boot while the one-shot reset flag is set, and only then', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn');
    for (let boot = 0; boot < 2; boot += 1) {
      await build(true).listener.onClientReady(clientReady);
    }
    const resetWarnings = warn.mock.calls.filter(([message]) =>
      String(message).includes('COMMANDS_FORCE_RESET'),
    );
    expect(resetWarnings).toHaveLength(2);
    expect(String(resetWarnings[0]?.[0])).toContain('unset it');

    warn.mockClear();
    await build(false).listener.onClientReady(clientReady);
    expect(warn.mock.calls.flat().join(' ')).not.toContain('COMMANDS_FORCE_RESET');
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

  it('mentions nobody unless a message names who', () => {
    expect(buildNecordOptions(env({})).allowedMentions).toEqual({ parse: [] });
  });

  it('gives the REST client the request function that repeats unsent calls', () => {
    const { rest } = buildNecordOptions(env({}));
    const client = new Client({ intents: [], rest });
    expect(typeof rest?.makeRequest).toBe('function');
    // The same function object reached the client, so it replaced the default.
    expect(client.rest.options).toMatchObject(rest ?? { missing: true });
  });

  describe('as discord.js applies it to an outgoing message', () => {
    const body = (options: Parameters<typeof MessagePayload.create>[1]) => {
      const client = new Client({
        intents: [],
        allowedMentions: buildNecordOptions(env({})).allowedMentions,
      });
      const target = { client } as unknown as Parameters<typeof MessagePayload.create>[0];
      return MessagePayload.create(target, options).resolveBody().body;
    };

    it('lets pasted text such as a note or a role name ping nobody', () => {
      expect(body({ content: '@everyone <@&123> <@456>' })).toMatchObject({
        allowed_mentions: { parse: [] },
      });
    });

    it('still pings exactly the user a message names, as the birthday wish does', () => {
      const celebrant = '444444444444444444';
      expect(
        body({ content: `<@${celebrant}>`, allowedMentions: { users: [celebrant] } }),
      ).toMatchObject({ allowed_mentions: { users: [celebrant] } });
    });
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
