import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { ApplicationCommandType } from 'discord.js';
import {
  AutocompleteInterceptor,
  CommandsService,
  ContextMenusModule,
  ModalsModule,
  ModalsService,
  SlashCommandsModule,
  type SlashCommandDiscovery,
} from 'necord';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppModule } from '../app.module.js';
import { IDENTITY_REST } from '../discord/boot-guard.js';
import { toRestBody } from '../discord/command-registrar.js';
import { isBudgetedAnswer } from '../discord/helpers/autocomplete-budget.js';
import { validateCommandMetadata } from '../discord/validate-command-metadata.js';
import { GuildLocaleService } from '../i18n/guild-locale.service.js';
import { DISCORD_FEATURE_MODULES } from './feature-modules.js';
import { MessagingService } from './messaging/messaging.service.js';

const marker = (label: string) => `marker-${label}-${randomBytes(6).toString('hex')}`;

const testEnv: Record<string, string> = {
  APP_ENV: 'production',
  DISCORD_TOKEN: marker('discord'),
  DISCORD_CLIENT_ID: '111111111111111111',
  DISCORD_ALLOWED_APP_IDS: '111111111111111111',
  DISCORD_DEV_GUILD_ID: '',
  ADMIN_GUILD_ID: '333333333333333333',
  POSTGRES_DB: 'sab',
  POSTGRES_USER: 'sab_app',
  POSTGRES_PASSWORD: marker('postgres'),
  LOG_LEVEL: 'silent',
  MIGRATION_PENDING: '',
};

/**
 * The root commands the previous bot registered, read from the `setName` of
 * each file in `root/src/commands`, without `shutdown`: the new bot does not
 * offer a way to stop itself from Discord (see the migration plan).
 */
const LEGACY_ROOT_COMMANDS = [
  'add-poll',
  'attendance-by-role',
  'birthday',
  'bot-message',
  'bulk-assign',
  'create-activity',
  'get',
  'mention',
  'note',
  'ping',
  'private-thread',
  'purge',
  'scheduler',
  'set',
  'thread',
  'word',
];

/** Root commands added after the previous bot: the channel games, scores, help and the chatbot. */
const ADDED_ROOT_COMMANDS = ['chat', 'chatbot', 'game', 'help', 'leaderboard'];

/** The four message context menus; Discord allows five, one slot stays free. */
const MESSAGE_CONTEXT_MENUS = [
  'Edit bot message',
  'Mention non-reactors',
  'Purge up to here',
  'Reply as bot',
];
const MESSAGE_MENU_LIMIT = 5;
const USER_MENU_LIMIT = 5;

const GUILD = '444444444444444441';
const CHANNEL = '444444444444444442';
const REPLY_MESSAGE = '444444444444444443';
const MEMBER = '444444444444444444';

type RestCommand = ReturnType<typeof toRestBody>;
type Leaf = { path: string; discovery: SlashCommandDiscovery };

/** Every command of a group down to the handlers, with the path a person types. */
function leavesOf(discovery: SlashCommandDiscovery, path: string): Leaf[] {
  const children = [...discovery.getSubcommands().values()];
  if (children.length === 0) return [{ path, discovery }];
  return children.flatMap((child) => leavesOf(child, `${path} ${child.getName()}`));
}

function providerClasses(module: Type): Type[] {
  return ((Reflect.getMetadata('providers', module) ?? []) as unknown[]).filter(
    (provider): provider is Type => typeof provider === 'function',
  );
}

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });
}

describe('all feature modules in one application', () => {
  const sendMessage = vi.fn().mockResolvedValue({});
  let moduleRef: TestingModule;
  let payload: RestCommand[];

  beforeAll(async () => {
    for (const [name, value] of Object.entries(testEnv)) vi.stubEnv(name, value);
    // The identity check is the one Discord call made while the container is
    // built; a real one here would send the marker token to the live API.
    moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(IDENTITY_REST)
      .useValue({ get: () => Promise.resolve({ id: testEnv['DISCORD_CLIENT_ID'] }) })
      .overrideProvider(GuildLocaleService)
      .useValue({ resolve: () => Promise.resolve('en') })
      .overrideProvider(MessagingService)
      .useValue({ sendMessage })
      .compile();

    // Necord fills its registries when the modules initialise, next to the
    // gateway login. Only the registry part runs here, so nothing logs in.
    for (const registry of [SlashCommandsModule, ContextMenusModule, ModalsModule]) {
      moduleRef.get(registry, { strict: false }).onModuleInit();
    }
    payload = moduleRef
      .get(CommandsService, { strict: false })
      .getGlobalCommands()
      .map((command) => toRestBody(command.toJSON()));
  });

  afterAll(async () => {
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  it('resolves every provider of every feature module through the container', () => {
    expect(DISCORD_FEATURE_MODULES.length).toBeGreaterThan(0);
    for (const module of DISCORD_FEATURE_MODULES) {
      for (const provider of providerClasses(module)) {
        expect(
          moduleRef.get(provider, { strict: false }),
          `${module.name} -> ${provider.name}`,
        ).toBeDefined();
      }
    }
  });

  it('registers metadata Discord accepts, for slash commands and context menus alike', () => {
    expect(payload.length).toBeGreaterThan(0);
    expect(validateCommandMetadata(payload)).toEqual([]);
  });

  it('keeps the 16 root commands of the previous bot, minus shutdown, plus the games, within the 100 limit', () => {
    const roots = payload
      .filter(
        (command) =>
          (command.type ?? ApplicationCommandType.ChatInput) === ApplicationCommandType.ChatInput,
      )
      .map((command) => command.name);
    expect(roots.length).toBeLessThanOrEqual(100);
    expect([...roots].sort()).toEqual([...LEGACY_ROOT_COMMANDS, ...ADDED_ROOT_COMMANDS].sort());
    expect(roots).not.toContain('shutdown');
  });

  it('offers exactly four message context menus and leaves a slot free', () => {
    const messageMenus = payload.filter(
      (command) => command.type === ApplicationCommandType.Message,
    );
    expect(messageMenus.map((command) => command.name).sort()).toEqual(MESSAGE_CONTEXT_MENUS);
    expect(messageMenus.length).toBeLessThan(MESSAGE_MENU_LIMIT);
    expect(
      payload.filter((command) => command.type === ApplicationCommandType.User).length,
    ).toBeLessThanOrEqual(USER_MENU_LIMIT);
  });

  it('gives every context menu a Vietnamese name', () => {
    for (const command of payload.filter(
      (entry) => entry.type === ApplicationCommandType.Message,
    )) {
      const localized = (command as { name_localizations?: Record<string, string> })
        .name_localizations;
      expect(localized?.['vi'], command.name).toBeTruthy();
    }
  });

  it('answers every autocomplete through withAutocompleteBudget', async () => {
    const roots = moduleRef
      .get(CommandsService, { strict: false })
      .getGlobalCommands()
      .filter((command): command is SlashCommandDiscovery => command.isSlashCommand());

    const withAutocomplete = roots
      .flatMap((root) => leavesOf(root, `/${root.getName()}`))
      .filter(({ discovery }) =>
        Object.values(discovery.getRawOptions()).some(
          (option) => (option as { autocomplete?: boolean }).autocomplete === true,
        ),
      );
    // Emoji, scheduler cancel, schedule time/date, note topics: the check below
    // would pass vacuously if none were found.
    expect(withAutocomplete.length).toBeGreaterThan(0);

    const interceptorClasses = new Set<Type>();
    for (const { path, discovery } of withAutocomplete) {
      const handler = discovery.getHandler();
      expect(handler, path).toBeDefined();
      const interceptors = (Reflect.getMetadata('__interceptors__', handler as object) ??
        []) as unknown[];
      const autocompleters = interceptors.filter(
        (interceptor): interceptor is Type =>
          typeof interceptor === 'function' &&
          (interceptor.prototype as unknown) instanceof AutocompleteInterceptor,
      );
      expect(autocompleters.length, `${path} has an autocomplete option but no interceptor`).toBe(
        1,
      );
      for (const interceptor of autocompleters) interceptorClasses.add(interceptor);
    }

    // And any autocomplete interceptor that is provided, used or not.
    for (const module of DISCORD_FEATURE_MODULES) {
      for (const provider of providerClasses(module)) {
        if (provider.prototype instanceof AutocompleteInterceptor) interceptorClasses.add(provider);
      }
    }

    for (const interceptor of interceptorClasses) {
      const instance = moduleRef.get<Type, AutocompleteInterceptor & Record<string, unknown>>(
        interceptor,
        { strict: false },
      );
      const entries = Object.entries(instance).filter(([, value]) => isBudgetedAnswer(value));
      expect(entries.length, `${interceptor.name} holds no withAutocompleteBudget answer`).toBe(1);
      const [name, original] = entries[0] ?? [];
      if (name === undefined) continue;

      // Not just present: the interceptor's entry point must go through it.
      const spy = vi.fn().mockResolvedValue(undefined);
      instance[name] = spy;
      try {
        const interaction = { options: { getFocused: () => '' } } as never;
        await instance.transformOptions(interaction);
        expect(spy, `${interceptor.name}.transformOptions`).toHaveBeenCalledWith(interaction);
      } finally {
        instance[name] = original;
      }
    }
  });

  it('has no handler that inspects the caller permissions', () => {
    const offenders = sourceFiles(join(__dirname))
      .filter((file) => readFileSync(file, 'utf8').includes('memberPermissions'))
      .map((file) => file.slice(__dirname.length + 1));
    expect(offenders).toEqual([]);
  });

  describe('modal routes with two parameters', () => {
    const modals = () => moduleRef.get(ModalsService, { strict: false });

    function submit(customId: string, content: string) {
      const calls: string[] = [];
      const interaction = {
        customId,
        guildId: GUILD,
        channelId: CHANNEL,
        locale: 'en-US',
        user: { id: MEMBER },
        replied: false,
        deferred: false,
        isModalSubmit: () => true,
        fields: { getTextInputValue: () => content },
        deferReply: vi.fn(() => {
          interaction.deferred = true;
          return Promise.resolve();
        }),
        editReply: vi.fn((options: { content: string }) => {
          calls.push(options.content);
          return Promise.resolve();
        }),
        followUp: vi.fn(() => Promise.resolve()),
        reply: vi.fn(() => Promise.resolve()),
      };
      return { interaction, calls };
    }

    it('matches bm-send/:channelId/:replyMessageId and splits both parameters', () => {
      const replyTo = modals().get(`bm-send/${CHANNEL}/${REPLY_MESSAGE}`);
      expect(replyTo).toBeDefined();
      expect(replyTo?.matcher(`bm-send/${CHANNEL}/${REPLY_MESSAGE}`)).toMatchObject({
        params: { channelId: CHANNEL, replyMessageId: REPLY_MESSAGE },
      });
      expect(replyTo?.matcher(`bm-send/${CHANNEL}/-`)).toMatchObject({
        params: { channelId: CHANNEL, replyMessageId: '-' },
      });
      expect(modals().get(`bm-edit/${CHANNEL}/${REPLY_MESSAGE}`)).toBeDefined();
      expect(modals().get(`bm-send/${CHANNEL}`)).toBeUndefined();
    });

    it('runs the handler with both parameters: a reply target when there is one', async () => {
      sendMessage.mockClear();
      const { interaction } = submit(`bm-send/${CHANNEL}/${REPLY_MESSAGE}`, 'Hello there');
      await modals()
        .get(interaction.customId)
        ?.execute(interaction as never);

      expect(interaction.deferReply).toHaveBeenCalledTimes(1);
      expect(sendMessage).toHaveBeenCalledWith(
        GUILD,
        {
          channelId: CHANNEL,
          content: 'Hello there',
          replyTo: { channelId: CHANNEL, messageId: REPLY_MESSAGE },
        },
        { source: 'DISCORD', userId: MEMBER },
      );
    });

    it('treats "-" as no reply target', async () => {
      sendMessage.mockClear();
      const { interaction } = submit(`bm-send/${CHANNEL}/-`, 'Plain');
      await modals()
        .get(interaction.customId)
        ?.execute(interaction as never);

      expect(sendMessage).toHaveBeenCalledWith(
        GUILD,
        { channelId: CHANNEL, content: 'Plain' },
        { source: 'DISCORD', userId: MEMBER },
      );
    });
  });
});
