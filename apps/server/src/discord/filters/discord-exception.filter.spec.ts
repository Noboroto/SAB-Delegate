import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { EXCEPTION_FILTERS_METADATA } from '@nestjs/common/constants';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { DiscordCommands } from '../decorators/discord-commands.decorator.js';
import { BOT_LOG_CHANNEL_NAME, ErrorReporter } from '../error-reporter.service.js';
import { ServiceError } from '../../common/errors/service-error.js';
import { DiscordExceptionFilter } from './discord-exception.filter.js';

const ADMIN_GUILD = '333333333333333333';
const token = `marker-${randomBytes(8).toString('hex')}`;
// Characters that a database URL escapes, so the encoded form differs from the raw one.
const databasePassword = `p@ss/${randomBytes(8).toString('hex')}:w?rd`;

afterEach(() => {
  vi.restoreAllMocks();
});

function silenceLogs() {
  for (const method of ['error', 'warn', 'log'] as const) {
    vi.spyOn(Logger.prototype, method).mockImplementation(() => undefined);
  }
}

describe('ErrorReporter', () => {
  function build(options: {
    channelName?: string;
    guildId?: string;
    send?: ReturnType<typeof vi.fn>;
    textBased?: boolean;
  }) {
    const send = options.send ?? vi.fn().mockResolvedValue(undefined);
    const channel = {
      name: options.channelName ?? BOT_LOG_CHANNEL_NAME,
      isTextBased: () => options.textBased ?? true,
      send,
    };
    const client = {
      guilds: {
        cache: {
          get: (id: string) =>
            id === (options.guildId ?? ADMIN_GUILD)
              ? {
                  channels: {
                    cache: {
                      find: (predicate: (c: typeof channel) => boolean) =>
                        [channel].find(predicate),
                    },
                  },
                }
              : undefined,
        },
      },
    };
    const reporter = new ErrorReporter(client, {
      ADMIN_GUILD_ID: ADMIN_GUILD,
      DISCORD_TOKEN: token,
      POSTGRES_PASSWORD: databasePassword,
    });
    return { reporter, send };
  }

  it('posts the title, then the stack in a code fence cut to 1900 characters', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    const error = new Error('boom');
    error.stack = `Error: boom\n${'    at somewhere (file.ts:1:1)\n'.repeat(500)}`;

    await reporter.report('Error in SetCommands.logChannel', error);

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toEqual({
      content: 'Error in SetCommands.logChannel',
      allowedMentions: { parse: [] },
    });
    const detail = (send.mock.calls[1]?.[0] as { content: string }).content;
    expect(detail.startsWith('```\nError: boom')).toBe(true);
    expect(detail.endsWith('\n```')).toBe(true);
    expect(detail.length).toBeLessThanOrEqual(1900 + '```\n'.length + '\n```'.length);
    expect(detail.length).toBeLessThanOrEqual(2000);
  });

  it('keeps a very long title within the message limit', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    await reporter.report('t'.repeat(5000), new Error('x'));
    expect((send.mock.calls[0]?.[0] as { content: string }).content.length).toBeLessThanOrEqual(
      2000,
    );
  });

  it('does nothing and does not throw when there is no bot-log channel', async () => {
    silenceLogs();
    const { reporter, send } = build({ channelName: 'general' });
    await expect(reporter.report('title', new Error('x'))).resolves.toBeUndefined();
    expect(send).not.toHaveBeenCalled();
  });

  it('looks only in the admin guild', async () => {
    silenceLogs();
    const { reporter, send } = build({ guildId: '444444444444444444' });
    await reporter.report('title', new Error('x'));
    expect(send).not.toHaveBeenCalled();
  });

  it('does not throw when the post itself fails', async () => {
    silenceLogs();
    const { reporter } = build({ send: vi.fn().mockRejectedValue(new Error('Missing Access')) });
    await expect(reporter.report('title', new Error('x'))).resolves.toBeUndefined();
  });

  it('reports a thrown non-Error value', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    await reporter.report('title', { reason: 'plain object' });
    expect((send.mock.calls[1]?.[0] as { content: string }).content).toContain('plain object');
  });

  it('keeps the bot token out of the channel', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    await reporter.report('title', new Error(`request failed with ${token}`));
    const posted = send.mock.calls
      .map(([message]) => (message as { content: string }).content)
      .join('\n');
    expect(posted).not.toContain(token);
    expect(posted).toContain('[redacted]');
  });

  it('keeps the database password out of the channel, raw and URL-encoded', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    const url = `postgresql://sab_app:${encodeURIComponent(databasePassword)}@db/sab`;
    await reporter.report('title', new Error(`connect failed ${databasePassword} via ${url}`));
    const posted = send.mock.calls
      .map(([message]) => (message as { content: string }).content)
      .join('\n');
    expect(posted).not.toContain(databasePassword);
    expect(posted).not.toContain(encodeURIComponent(databasePassword));
    expect(posted).toContain('[redacted]');
  });

  it('keeps the login secrets out of the channel', async () => {
    silenceLogs();
    const clientSecret = `cs-${randomBytes(8).toString('hex')}`;
    const authSecret = randomBytes(24).toString('base64');
    const send = vi.fn().mockResolvedValue(undefined);
    const channel = { name: BOT_LOG_CHANNEL_NAME, isTextBased: () => true, send };
    const guild = { channels: { cache: { find: () => channel } } };
    const reporter = new ErrorReporter(
      { guilds: { cache: { get: () => guild } } },
      {
        ADMIN_GUILD_ID: ADMIN_GUILD,
        DISCORD_TOKEN: token,
        DISCORD_CLIENT_SECRET: clientSecret,
        BETTER_AUTH_SECRET: authSecret,
        POSTGRES_PASSWORD: databasePassword,
      },
    );
    await reporter.report('title', new Error(`oauth said ${clientSecret} and ${authSecret}`));
    const posted = send.mock.calls
      .map(([message]) => (message as { content: string }).content)
      .join('\n');
    expect(posted).not.toContain(clientSecret);
    expect(posted).not.toContain(authSecret);
    expect(posted).toContain('[redacted]');
  });

  it('sends no mention to anyone', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    await reporter.report('title @everyone', new Error('<@123456789012345678> @here'));
    expect(send).toHaveBeenCalledTimes(2);
    for (const [message] of send.mock.calls) {
      expect((message as { allowedMentions: unknown }).allowedMentions).toEqual({ parse: [] });
    }
  });

  it('cannot be made to close its own code fence', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    await reporter.report('title', new Error('x ```\n@everyone ````` y'));
    const detail = (send.mock.calls[1]?.[0] as { content: string }).content;
    const inner = detail.slice('```\n'.length, -'\n```'.length);
    expect(inner).not.toContain('```');
    expect(inner).toContain('@everyone');
    expect(detail.length).toBeLessThanOrEqual(2000);
  });

  it('only logs once the process is shutting down', async () => {
    silenceLogs();
    const { reporter, send } = build({});
    reporter.onModuleDestroy();
    await reporter.report('title', new Error('x'));
    expect(send).not.toHaveBeenCalled();
  });
});

describe('DiscordExceptionFilter', () => {
  const secret = 'internal detail that must never reach the user';

  type FakeInteraction = ReturnType<typeof interactionOf>;
  function interactionOf(state: {
    replied?: boolean;
    deferred?: boolean;
    ephemeral?: boolean;
    repliable?: boolean;
    autocomplete?: boolean;
    commandName?: string;
    group?: string | null;
    subcommand?: string | null;
  }) {
    return {
      commandName: state.commandName,
      options: {
        getSubcommandGroup: () => state.group ?? null,
        getSubcommand: () => state.subcommand ?? null,
      },
      guildId: ADMIN_GUILD,
      locale: 'en-US',
      replied: state.replied ?? false,
      deferred: state.deferred ?? false,
      ephemeral: state.deferred === true ? (state.ephemeral ?? false) : null,
      isRepliable: () => state.repliable ?? true,
      isAutocomplete: () => state.autocomplete ?? false,
      reply: vi.fn().mockResolvedValue(undefined),
      editReply: vi.fn().mockResolvedValue(undefined),
      deleteReply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
      respond: vi.fn().mockResolvedValue(undefined),
    };
  }

  function build(locale = 'en') {
    const report = vi.fn().mockResolvedValue(undefined);
    const resolve = vi.fn().mockResolvedValue(locale);
    const filter = new DiscordExceptionFilter(
      { report } as unknown as ErrorReporter,
      { resolve } as unknown as GuildLocaleService,
    );
    return { filter, report, resolve };
  }

  function hostOf(context: unknown) {
    class SetCommands {}
    const host = new ExecutionContextHost([[context], {}], SetCommands, function logChannel() {});
    host.setType('necord');
    return host;
  }

  const sent = (interaction: FakeInteraction) =>
    JSON.stringify([
      interaction.reply.mock.calls,
      interaction.editReply.mock.calls,
      interaction.followUp.mock.calls,
    ]);

  it('replies ephemerally with a generic sentence when nothing was sent yet', async () => {
    silenceLogs();
    const { filter, report } = build();
    const interaction = interactionOf({});

    await filter.catch(new Error(secret), hostOf(interaction));

    expect(interaction.reply).toHaveBeenCalledWith({
      content: MESSAGES.en.common.commandFailed,
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
    expect(sent(interaction)).not.toContain(secret);
    expect(report).toHaveBeenCalledWith('Error in SetCommands.logChannel', expect.any(Error));
  });

  it('answers the user before the report goes out, and does not wait for the report', async () => {
    silenceLogs();
    const { filter, report } = build();
    const interaction = interactionOf({});
    const order: string[] = [];
    interaction.reply.mockImplementation(() => {
      order.push('reply');
      return Promise.resolve();
    });
    // A report that never finishes (a stalled or rate-limited channel).
    report.mockImplementation(() => {
      order.push('report');
      return new Promise(() => undefined);
    });

    await filter.catch(new Error(secret), hostOf(interaction));

    expect(order).toEqual(['reply', 'report']);
  });

  it('still reports when answering fails, and a failing report cannot escape', async () => {
    silenceLogs();
    const { filter, report } = build();
    const interaction = interactionOf({});
    interaction.reply.mockRejectedValue(new Error('Missing Access'));
    report.mockRejectedValue(new Error('reporter bug'));
    await expect(filter.catch(new Error(secret), hostOf(interaction))).resolves.toBeUndefined();
    await vi.waitFor(() => expect(report).toHaveBeenCalledTimes(1));
  });

  it('names the command, with its group and subcommand, in the report title', async () => {
    silenceLogs();
    const cases = [
      [{ commandName: 'set', subcommand: 'log-channel' }, '/set log-channel'],
      [{ commandName: 'note', group: 'tag', subcommand: 'add' }, '/note tag add'],
      [{ commandName: 'ping' }, '/ping'],
    ] as const;
    for (const [state, expected] of cases) {
      const { filter, report } = build();
      await filter.catch(new Error(secret), hostOf(interactionOf(state)));
      expect(report).toHaveBeenCalledWith(
        `Error in SetCommands.logChannel (${expected})`,
        expect.any(Error),
      );
    }
  });

  it('edits the placeholder of an ephemeral deferred reply', async () => {
    silenceLogs();
    const { filter } = build();
    const interaction = interactionOf({ deferred: true, ephemeral: true });
    await filter.catch(new Error(secret), hostOf(interaction));
    expect(interaction.editReply).toHaveBeenCalledWith({
      content: MESSAGES.en.common.commandFailed,
    });
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    expect(interaction.reply).not.toHaveBeenCalled();
    expect(interaction.followUp).not.toHaveBeenCalled();
  });

  it('removes a public placeholder and sends the error privately', async () => {
    silenceLogs();
    const { filter } = build();
    const interaction = interactionOf({ deferred: true, ephemeral: false });
    const order: string[] = [];
    interaction.deleteReply.mockImplementation(() => {
      order.push('delete');
      return Promise.resolve();
    });
    interaction.followUp.mockImplementation(() => {
      order.push('followUp');
      return Promise.resolve();
    });
    await filter.catch(new Error(secret), hostOf(interaction));
    expect(order).toEqual(['delete', 'followUp']);
    expect(interaction.followUp).toHaveBeenCalledWith({
      content: MESSAGES.en.common.commandFailed,
      flags: MessageFlags.Ephemeral,
    });
    expect(interaction.editReply).not.toHaveBeenCalled();
  });

  it.each([10008, 10062])(
    'still sends the private error when the placeholder is already gone (%i)',
    async (code) => {
      silenceLogs();
      const { filter } = build();
      const interaction = interactionOf({ deferred: true });
      interaction.deleteReply.mockRejectedValue(Object.assign(new Error('gone'), { code }));
      await filter.catch(new Error(secret), hostOf(interaction));
      expect(interaction.followUp).toHaveBeenCalledTimes(1);
    },
  );

  it('follows up when a reply was already sent, also after a deferred one', async () => {
    silenceLogs();
    const { filter } = build();
    for (const state of [{ replied: true }, { replied: true, deferred: true }]) {
      const interaction = interactionOf(state);
      await filter.catch(new Error(secret), hostOf(interaction));
      expect(interaction.followUp).toHaveBeenCalledWith({
        content: MESSAGES.en.common.commandFailed,
        flags: MessageFlags.Ephemeral,
      });
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    }
  });

  it('answers in the language of the guild', async () => {
    silenceLogs();
    const { filter, resolve } = build('vi');
    const interaction = interactionOf({});
    await filter.catch(new Error(secret), hostOf(interaction));
    expect(resolve).toHaveBeenCalledWith(ADMIN_GUILD, interaction);
    expect(interaction.reply).toHaveBeenCalledWith(
      expect.objectContaining({ content: MESSAGES.vi.common.commandFailed }),
    );
  });

  it('only reports when the interaction cannot be replied to', async () => {
    silenceLogs();
    const { filter, report } = build();
    const interaction = interactionOf({ repliable: false });
    await filter.catch(new Error(secret), hostOf(interaction));
    expect(sent(interaction)).toBe('[[],[],[]]');
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('reports a listener error that has no interaction at all', async () => {
    silenceLogs();
    const { filter, report } = build();
    await expect(
      filter.catch(new Error(secret), hostOf({ content: 'a message' })),
    ).resolves.toBeUndefined();
    expect(report).toHaveBeenCalledTimes(1);
  });

  it('answers a failed autocomplete with an empty list', async () => {
    silenceLogs();
    const { filter } = build();
    const interaction = interactionOf({ autocomplete: true, repliable: false });
    await filter.catch(new Error(secret), hostOf(interaction));
    expect(interaction.respond).toHaveBeenCalledWith([]);
  });

  it('tells the user what is wrong with a ServiceError and does not report it', async () => {
    silenceLogs();
    const { filter, report } = build();
    const interaction = interactionOf({});
    await filter.catch(new ServiceError(ErrorCode.VALIDATION_FAILED), hostOf(interaction));
    expect(interaction.reply).toHaveBeenCalledWith({
      content: MESSAGES.en.errors.VALIDATION_FAILED,
      flags: MessageFlags.Ephemeral,
    });
    expect(report).not.toHaveBeenCalled();
  });

  it.each([10062, 40060])(
    'only logs a dead interaction (%i): no reply, no report',
    async (code) => {
      silenceLogs();
      const { filter, report } = build();
      const interaction = interactionOf({});
      await filter.catch(
        Object.assign(new Error('Unknown interaction'), { code }),
        hostOf(interaction),
      );
      expect(sent(interaction)).toBe('[[],[],[]]');
      expect(report).not.toHaveBeenCalled();
    },
  );

  it('never throws, even when answering or the language lookup fails', async () => {
    silenceLogs();
    const failing = interactionOf({});
    failing.reply.mockRejectedValue(
      Object.assign(new Error('already acknowledged'), { code: 40060 }),
    );
    await expect(build().filter.catch(new Error(secret), hostOf(failing))).resolves.toBeUndefined();

    const broken = build();
    broken.resolve.mockRejectedValue(new Error('db down'));
    await expect(
      broken.filter.catch(new Error(secret), hostOf(interactionOf({}))),
    ).resolves.toBeUndefined();
  });
});

describe('DiscordCommands', () => {
  it('attaches the exception filter to the class', () => {
    @DiscordCommands()
    class Commands {}
    expect(Reflect.getMetadata(EXCEPTION_FILTERS_METADATA, Commands)).toEqual([
      DiscordExceptionFilter,
    ]);
  });
});
