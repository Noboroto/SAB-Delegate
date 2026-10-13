import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { PermissionFlagsBits } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppStateService } from '../app-state/app-state.service.js';
import type { DiscordEnv } from './boot-guard.js';
import { commandHash, commandsInSync, type CommandPayload } from './command-hash.js';
import { CommandRegistrar, toRestBody } from './command-registrar.js';

const APP_ID = '111111111111111111';
const OTHER_APP_ID = '999999999999999999';
const DEV_GUILD = '333333333333333333';

type Discovered = { toJSON(): unknown };

/** What a Necord discovery hands over: discord.js camelCase builder data. */
const pingCommand = (description = 'Check that the bot is alive'): Discovered => ({
  toJSON: () => ({
    name: 'ping',
    description,
    descriptionLocalizations: { vi: 'Kiểm tra bot', 'en-US': description },
    defaultMemberPermissions: PermissionFlagsBits.ManageMessages,
    options: [],
  }),
});
const setCommand = (): Discovered => ({
  toJSON: () => ({
    name: 'set',
    description: 'Set configurations for this server',
    options: [
      {
        type: 1,
        name: 'log-channel',
        description: 'Where logs go',
        options: [{ type: 7, name: 'channel', description: 'A channel', required: true }],
      },
    ],
  }),
});

/** The way Discord answers `GET /applications/{id}/commands`: our fields plus its own. */
function asDiscordAnswers(body: CommandPayload[]): unknown[] {
  return body.map((command, index) => ({
    ...command,
    id: `70000000000000000${index}`,
    application_id: APP_ID,
    version: '800000000000000000',
    dm_permission: true,
    contexts: 'contexts' in command ? command.contexts : [0, 1, 2],
    integration_types: [0],
    nsfw: false,
    name_localizations: null,
    description_localizations: command.description_localizations ?? null,
    default_member_permissions: command.default_member_permissions ?? null,
  }));
}

type Setup = {
  appEnv?: DiscordEnv['APP_ENV'];
  devGuild?: string;
  global?: Discovered[];
  guild?: Discovered[];
  store?: Map<string, string>;
  applicationId?: string;
  remote?: unknown;
  remoteFails?: boolean;
};

function setup(options: Setup = {}) {
  const store = options.store ?? new Map<string, string>();
  const rest = {
    get: vi.fn((_route: string) =>
      options.remoteFails === true
        ? Promise.reject(new Error('connect ECONNRESET'))
        : Promise.resolve(options.remote ?? []),
    ),
    put: vi.fn((_route: string, _init: { body: unknown }) => Promise.resolve([])),
  };
  const commands = {
    getGlobalCommands: vi.fn(() => options.global ?? [pingCommand()]),
    getGuildCommands: vi.fn(() => options.guild ?? options.global ?? [pingCommand()]),
  };
  const appState = {
    get: vi.fn((key: string) => Promise.resolve(store.get(key) ?? null)),
    set: vi.fn((key: string, value: string) => {
      store.set(key, value);
      return Promise.resolve();
    }),
  };
  const env = {
    APP_ENV: options.appEnv ?? 'production',
    DISCORD_DEV_GUILD_ID: options.devGuild,
  } as Pick<DiscordEnv, 'APP_ENV' | 'DISCORD_DEV_GUILD_ID'>;
  const sleep = vi.fn((_ms: number) => Promise.resolve());
  const registrar = new CommandRegistrar(
    { rest, application: { id: options.applicationId ?? APP_ID } },
    commands,
    appState as unknown as AppStateService,
    env,
  );
  registrar.backoff = { delaysMs: [1000, 2000, 4000], sleep };
  return { registrar, rest, commands, appState, store, sleep };
}

const bodyOf = (discovered: Discovered[]) => discovered.map((entry) => toRestBody(entry.toJSON()));
const GLOBAL_ROUTE = `/applications/${APP_ID}/commands`;
const GUILD_ROUTE = `/applications/${APP_ID}/guilds/${DEV_GUILD}/commands`;
const GLOBAL_KEY = `commands:${APP_ID}:global`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('toRestBody', () => {
  it('turns builder data into the REST body Discord expects', () => {
    expect(toRestBody(pingCommand().toJSON())).toMatchObject({
      name: 'ping',
      description: 'Check that the bot is alive',
      description_localizations: { vi: 'Kiểm tra bot' },
      default_member_permissions: PermissionFlagsBits.ManageMessages.toString(),
    });
  });
});

describe('CommandRegistrar.registerIfChanged', () => {
  it('registers on the first boot and records the hash under application and scope', async () => {
    const { registrar, rest, store } = setup();
    await expect(registrar.registerIfChanged()).resolves.toBe('registered');

    expect(rest.put).toHaveBeenCalledTimes(1);
    expect(rest.put).toHaveBeenCalledWith(GLOBAL_ROUTE, { body: bodyOf([pingCommand()]) });
    expect(store.get(GLOBAL_KEY)).toBe(commandHash(bodyOf([pingCommand()])));
  });

  it('does not write when the payload is unchanged and Discord already holds it', async () => {
    const body = bodyOf([pingCommand(), setCommand()]);
    const store = new Map([[GLOBAL_KEY, commandHash(body)]]);
    const { registrar, rest } = setup({
      global: [pingCommand(), setCommand()],
      store,
      // Discord's own defaults (contexts, integration types, nulls) must not look like a change.
      remote: asDiscordAnswers(body),
    });

    await expect(registrar.registerIfChanged()).resolves.toBe('unchanged');
    expect(rest.get).toHaveBeenCalledWith(GLOBAL_ROUTE);
    expect(rest.put).not.toHaveBeenCalled();
  });

  it('writes again when the hash matches but Discord is missing a command', async () => {
    const body = bodyOf([pingCommand(), setCommand()]);
    const { registrar, rest, store } = setup({
      global: [pingCommand(), setCommand()],
      store: new Map([[GLOBAL_KEY, commandHash(body)]]),
      remote: asDiscordAnswers(body.slice(0, 1)),
    });

    await expect(registrar.registerIfChanged()).resolves.toBe('registered');
    expect(rest.put).toHaveBeenCalledTimes(1);
    expect(store.get(GLOBAL_KEY)).toBe(commandHash(body));
  });

  it('writes again when Discord holds an extra command or a different description', async () => {
    const body = bodyOf([pingCommand()]);
    const stale = bodyOf([pingCommand('An older description')]);
    const extra = asDiscordAnswers([...body, ...bodyOf([setCommand()])]);

    for (const remote of [asDiscordAnswers(stale), extra]) {
      const { registrar, rest } = setup({
        store: new Map([[GLOBAL_KEY, commandHash(body)]]),
        remote,
      });
      await expect(registrar.registerIfChanged()).resolves.toBe('registered');
      expect(rest.put).toHaveBeenCalledTimes(1);
    }
  });

  it('writes and stores the new hash when the payload changed', async () => {
    const before = commandHash(bodyOf([pingCommand()]));
    const { registrar, rest, store } = setup({
      global: [pingCommand('A new description')],
      store: new Map([[GLOBAL_KEY, before]]),
      remote: asDiscordAnswers(bodyOf([pingCommand()])),
    });

    await expect(registrar.registerIfChanged()).resolves.toBe('registered');
    expect(rest.put).toHaveBeenCalledTimes(1);
    expect(store.get(GLOBAL_KEY)).not.toBe(before);
    expect(store.get(GLOBAL_KEY)).toBe(commandHash(bodyOf([pingCommand('A new description')])));
  });

  it('survives a failed write: no hash stored, no throw, only the error class logged', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registrar, rest, store } = setup();
    rest.put.mockRejectedValueOnce(
      Object.assign(new Error('Missing Access for secret-detail'), { name: 'DiscordAPIError' }),
    );

    await expect(registrar.registerIfChanged()).resolves.toBe('failed');
    expect(store.size).toBe(0);
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).toContain('DiscordAPIError');
    expect(logged).not.toContain('secret-detail');

    // The next boot tries again and succeeds.
    await expect(registrar.registerIfChanged()).resolves.toBe('registered');
    expect(store.get(GLOBAL_KEY)).toBeDefined();
  });

  it('does not use a hash recorded for another application', async () => {
    const body = bodyOf([pingCommand()]);
    const { registrar, rest } = setup({
      store: new Map([[`commands:${OTHER_APP_ID}:global`, commandHash(body)]]),
      remote: asDiscordAnswers(body),
    });

    await expect(registrar.registerIfChanged()).resolves.toBe('registered');
    expect(rest.put).toHaveBeenCalledTimes(1);
  });

  it('trusts the recorded hash when Discord cannot be asked', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const body = bodyOf([pingCommand()]);
    const { registrar, rest } = setup({
      store: new Map([[GLOBAL_KEY, commandHash(body)]]),
      remoteFails: true,
    });

    await expect(registrar.registerIfChanged()).resolves.toBe('unchanged');
    expect(rest.put).not.toHaveBeenCalled();
    expect(warn.mock.calls.flat().join(' ')).toContain('Error');
  });

  it('registers only in the dev guild in development and never reads global commands', async () => {
    const { registrar, rest, commands, store } = setup({
      appEnv: 'development',
      devGuild: DEV_GUILD,
    });

    await expect(registrar.registerIfChanged()).resolves.toBe('registered');
    expect(rest.put).toHaveBeenCalledTimes(1);
    expect(rest.put).toHaveBeenCalledWith(GUILD_ROUTE, expect.anything());
    expect(commands.getGlobalCommands).not.toHaveBeenCalled();
    expect(commands.getGuildCommands).toHaveBeenCalledWith(DEV_GUILD);
    expect([...store.keys()]).toEqual([`commands:${APP_ID}:guild:${DEV_GUILD}`]);
  });

  it('refuses to run in development without a dev guild instead of falling back to global', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registrar, rest } = setup({ appEnv: 'development' });
    await expect(registrar.registerIfChanged()).resolves.toBe('failed');
    expect(rest.put).not.toHaveBeenCalled();
  });

  it('registers production commands globally even if a dev guild id leaks into the environment', async () => {
    const { registrar, rest } = setup({ appEnv: 'production', devGuild: DEV_GUILD });
    await registrar.registerIfChanged();
    expect(rest.put).toHaveBeenCalledWith(GLOBAL_ROUTE, expect.anything());
  });

  it('never replaces the registered set with an empty one', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const { registrar, rest, store } = setup({ global: [] });
    await expect(registrar.registerIfChanged()).resolves.toBe('skipped');
    expect(rest.put).not.toHaveBeenCalled();
    expect(store.size).toBe(0);
  });
});

describe('CommandRegistrar.wipeAndRegister', () => {
  it('clears the dev guild and registers the full payload in the same call', async () => {
    const { registrar, rest, store } = setup({
      appEnv: 'development',
      devGuild: DEV_GUILD,
      guild: [pingCommand(), setCommand()],
    });

    await expect(registrar.wipeAndRegister({ kind: 'guild', guildId: DEV_GUILD })).resolves.toBe(
      'registered',
    );

    expect(
      rest.put.mock.calls.map(([route, init]) => [
        route,
        Array.isArray(init.body) ? init.body.length : -1,
      ]),
    ).toEqual([
      [GUILD_ROUTE, 0],
      [GUILD_ROUTE, 2],
    ]);
    expect(store.get(`commands:${APP_ID}:guild:${DEV_GUILD}`)).toBe(
      commandHash(bodyOf([pingCommand(), setCommand()])),
    );
  });

  it('wipes the global set in production and registers the new one right after', async () => {
    const { registrar, rest, store } = setup();
    await expect(registrar.wipeAndRegister({ kind: 'global' })).resolves.toBe('registered');
    expect(
      rest.put.mock.calls.map(([route, init]) => [route, (init.body as unknown[]).length]),
    ).toEqual([
      [GLOBAL_ROUTE, 0],
      [GLOBAL_ROUTE, 1],
    ]);
    expect(store.get(GLOBAL_KEY)).toBeDefined();
  });

  it('refuses a global wipe in development: the production bot serves those commands', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registrar, rest } = setup({ appEnv: 'development', devGuild: DEV_GUILD });
    await expect(registrar.wipeAndRegister({ kind: 'global' })).resolves.toBe('failed');
    expect(rest.put).not.toHaveBeenCalled();
  });

  it('refuses a guild wipe in production and a different guild in development', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const production = setup();
    await production.registrar.wipeAndRegister({ kind: 'guild', guildId: DEV_GUILD });
    const development = setup({ appEnv: 'development', devGuild: DEV_GUILD });
    await development.registrar.wipeAndRegister({ kind: 'guild', guildId: '444444444444444444' });
    expect(production.rest.put).not.toHaveBeenCalled();
    expect(development.rest.put).not.toHaveBeenCalled();
  });

  it('refuses a global wipe that would leave no commands at all', async () => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registrar, rest } = setup({ global: [] });
    await expect(registrar.wipeAndRegister({ kind: 'global' })).resolves.toBe('failed');
    expect(rest.put).not.toHaveBeenCalled();
  });

  it('allows an empty payload in the dev guild, which just clears it', async () => {
    const { registrar, rest } = setup({ appEnv: 'development', devGuild: DEV_GUILD, guild: [] });
    await expect(registrar.wipeAndRegister({ kind: 'guild', guildId: DEV_GUILD })).resolves.toBe(
      'registered',
    );
    expect(rest.put).toHaveBeenCalledTimes(2);
  });

  it('retries the registration after the wipe with a growing pause, then gives up and reports failure', async () => {
    const warn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const flaky = setup();
    flaky.rest.put
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'));
    await expect(flaky.registrar.wipeAndRegister({ kind: 'global' })).resolves.toBe('registered');
    expect(flaky.rest.put).toHaveBeenCalledTimes(4);
    expect(flaky.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000]);
    expect(error).not.toHaveBeenCalled();

    const broken = setup();
    broken.rest.put.mockResolvedValueOnce([]).mockRejectedValue(new Error('boom'));
    await expect(broken.registrar.wipeAndRegister({ kind: 'global' })).resolves.toBe('failed');
    // One wipe, the registration, and three retries after pauses of 1, 2 and 4 seconds.
    expect(broken.rest.put).toHaveBeenCalledTimes(5);
    expect(broken.sleep.mock.calls.map(([ms]) => ms)).toEqual([1000, 2000, 4000]);
    expect(broken.store.size).toBe(0);
    const logged = error.mock.calls.flat().join(' ');
    expect(logged).toContain('global');
    expect(logged).toContain('EMPTY');
    expect(warn).toHaveBeenCalled();
  });

  it('does not call the wipe a failure-after-wipe when the wipe itself is refused', async () => {
    const error = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const { registrar } = setup({ global: [] });
    await registrar.wipeAndRegister({ kind: 'global' });
    expect(error.mock.calls.flat().join(' ')).not.toContain('EMPTY');
  });
});

describe('command hash', () => {
  const payload = bodyOf([pingCommand(), setCommand()]);

  it('does not depend on the order of commands or of keys', () => {
    const reordered = [...payload]
      .reverse()
      .map((command) => Object.fromEntries(Object.entries(command).reverse())) as CommandPayload[];
    expect(commandHash(reordered)).toBe(commandHash(payload));
  });

  it('changes with a description, a permission or an option', () => {
    const base = commandHash(payload);
    expect(commandHash(bodyOf([pingCommand('Changed'), setCommand()]))).not.toBe(base);
    const permission = payload.map((command) => ({ ...command, default_member_permissions: '8' }));
    expect(commandHash(permission)).not.toBe(base);
    expect(commandHash(payload.slice(0, 1))).not.toBe(base);
  });

  it('treats an unset optional field as absent', () => {
    const withUndefined = payload.map((command) => ({ ...command, nsfw: undefined }));
    expect(commandHash(withUndefined)).toBe(commandHash(payload));
  });
});

describe('commandsInSync', () => {
  const payload = bodyOf([pingCommand(), setCommand()]);

  it('ignores what Discord adds on its own', () => {
    expect(commandsInSync(payload, asDiscordAnswers(payload))).toBe(true);
  });

  it('ignores order', () => {
    expect(commandsInSync(payload, asDiscordAnswers([...payload].reverse()))).toBe(true);
  });

  it('compares contexts only for a command that sets them', () => {
    const guildOnly = payload.map((command) => ({ ...command, contexts: [0] }));
    expect(commandsInSync(guildOnly, asDiscordAnswers(guildOnly))).toBe(true);
    const answers = asDiscordAnswers(guildOnly) as Array<Record<string, unknown>>;
    expect(
      commandsInSync(
        guildOnly,
        answers.map((a) => ({ ...a, contexts: [0, 1, 2] })),
      ),
    ).toBe(false);
  });

  it('notices a changed option, permission, localisation or choice', () => {
    const answers = asDiscordAnswers(payload) as Array<Record<string, unknown>>;
    expect(
      commandsInSync(
        payload,
        answers.map((a) => ({ ...a, default_member_permissions: '8' })),
      ),
    ).toBe(false);
    expect(
      commandsInSync(
        payload,
        answers.map((a) => ({ ...a, description_localizations: { vi: 'Khác' } })),
      ),
    ).toBe(false);
    expect(
      commandsInSync(
        payload,
        answers.map((a) => (a['name'] === 'set' ? { ...a, options: [] } : a)),
      ),
    ).toBe(false);
  });

  it('is false for an answer that is not a list of commands', () => {
    expect(commandsInSync(payload, null)).toBe(false);
    expect(commandsInSync(payload, { message: 'rate limited' })).toBe(false);
    expect(commandsInSync(payload, ['x'])).toBe(false);
  });
});
